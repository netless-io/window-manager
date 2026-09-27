import { AppAttributes, AppStatus, Events, INIT_DIR, MagixEventName, ROOT_DIR } from "./constants";
import { AppCreateQueue } from "./Utils/AppCreateQueue";
import { SetupQueue } from "./Utils/SetupQueue";
import { LatestTaskQueue } from "./Utils/LatestTaskQueue";
import { AppListeners } from "./AppListener";
import { AppProxy } from "./App";
import type { AppBoxSizeSyncOptions } from "./App/AppBoxSizeSynchronizer";
import { appRegister } from "./Register";
import { autorun, isPlayer, isRoom, ScenePathType, UpdateEventKind } from "white-web-sdk";

/**
 * Default `maxCachedAppsInMaximizedMode` while lazy setup is enabled.
 * Keep in sync with the option docs in index.ts.
 */
export const DEFAULT_MAX_CACHED_APPS_IN_MAXIMIZED_MODE = 4;
import { boxEmitter } from "./BoxEmitter";
import { calculateNextIndex } from "./Page";
import { callbacks } from "./callback";
import { debounce, get, isInteger, orderBy } from "lodash";
import { internalEmitter } from "./InternalEmitter";
import { createAttributesDelegate, Fields } from "./AttributesDelegate";
import type { AttributesDelegate } from "./AttributesDelegate";
import { log } from "./Utils/log";
import { MainViewProxy } from "./View/MainView";
import { safeListenPropsUpdated } from "./Utils/Reactive";
import { reconnectRefresher, WindowManager } from "./index";
import { RedoUndo } from "./RedoUndo";
import { SideEffectManager } from "side-effect-manager";
import { ViewManager } from "./View/ViewManager";
import type { SyncRegisterAppPayload } from "./Register";
import type { RemoveSceneParams } from "./InternalEmitter";
import {
    entireScenes,
    genAppId,
    isRootDirPage,
    makeValidScenePath,
    parseSceneDir,
    removeScenes,
    setScenePath,
    setViewFocusScenePath,
} from "./Utils/Common";
import type { ReconnectRefresher } from "./ReconnectRefresher";
import type { BoxManager } from "./BoxManager";
import type {
    Displayer,
    Room,
    ScenesCallbacksNode,
    SceneState,
    RoomState,
    MemberState,
} from "white-web-sdk";
import type { AddAppParams, BaseInsertParams, TeleBoxRect } from "./index";
import type {
    BoxBlurredPayload,
    BoxClosePayload,
    BoxFocusEventPayload,
    BoxMovePayload,
    BoxResizePayload,
    BoxStateChangePayload,
} from "./BoxEmitter";
import { getExtendClass } from "./Utils/extendClass";
import type { TeleBoxState } from "@netless/telebox-insider";

type LazyFocusIntent = {
    previous?: string;
    /** undefined targets mainView; absence of an intent means no pending work. */
    focused: string | undefined;
    generation: number;
    commitAfterSetup?: boolean;
    fallback?: boolean;
    /** Read-only initialization can activate a Box without writing room focus. */
    localOnly?: boolean;
    /** Only the initiating client publishes its committed Box layer. */
    publishZIndex?: boolean;
};

export class LazySetupWaitError extends Error {
    constructor(public readonly reason: "superseded" | "timeout" | "destroyed" | "failed", appId: string) {
        super(`[WindowManager]: lazy app setup wait ${reason}, appId: ${appId}`);
        this.name = "LazySetupWaitError";
    }
}

export class AppManager {
    static readonly kind = "AppManager";
    public displayer: Displayer;
    public viewManager: ViewManager;
    public appProxies: Map<string, AppProxy> = new Map();
    public appStatus: Map<string, AppStatus> = new Map();
    public store!: AttributesDelegate;
    public mainViewProxy: MainViewProxy;
    public refresher: ReconnectRefresher;
    public isReplay = this.windowManger.isReplay;
    public mainViewScenesLength = 0;

    private appListeners: AppListeners;
    public boxManager?: BoxManager;

    private _prevSceneIndex: number | undefined;
    private _prevFocused: string | undefined;
    private callbacksNode: ScenesCallbacksNode | null = null;
    private appCreateQueue = new AppCreateQueue();

    private _focusAppCreatedResolve?: (appProxy?: AppProxy) => void;
    private _focusAppId: string | undefined;
    private _resolveTimer: number | undefined;
    private lazyFocusGeneration = 0;
    private activeLazyAppId?: string;
    private lazyFocusQueue: Promise<void> = Promise.resolve();
    private lazyScheduler?: LatestTaskQueue<LazyFocusIntent>;
    private desiredLazyFocus?: LazyFocusIntent;
    private localFocusFeedback?: string;
    private failedSetupFocusAppId?: string;
    private initialFocusRecoveryPending = false;
    private initialFocusRecoveryAppIds = new Set<string>();
    private initialFocusRecoverySource?: string;
    private preparingLazyFocusAppId?: string;
    private pendingLazyZIndex?: { appId: string; base: number };
    private setupStartedAt = new Map<string, number>();
    public activityRevision = 0;
    private minimizedRevision = 0;
    private suppressLazyBlur = false;
    private minimizedCleanup?: Promise<void>;
    private runtimeCleanups = new Map<string, Promise<void>>();
    private reportedBoxStatusConflicts = new Set<string>();
    // Pending focusApp() commit wait (promise-based focus API). Under rapid
    // switching the newest request replaces the previous unprocessed one: the
    // replaced promise resolves `false` immediately instead of lingering.
    private pendingFocusCommit?: {
        appId: string;
        resolve: (committed: boolean) => void;
        timer: ReturnType<typeof setTimeout>;
        generation?: number;
        deadline?: number;
    };
    private pendingAddSetupWaiter?: {
        appId: string;
        resolve: () => void;
        reject: (error: unknown) => void;
        timer: ReturnType<typeof setTimeout>;
    };
    public addSetupWaitTimeout = 20_000;
    /** Watchdog so a focusApp() promise never dangles when the lazy focus queue cannot commit. */
    public focusCommitWatchdogTimeout = 30_000;
    private destroyed = false;
    // Serial queue for real app.setup() execution. AppCreateQueue only serializes
    // AppProxy/Box creation; this queue waits until each setup actually finishes.
    private setupTaskQueue = new SetupQueue();
    // LRU cache of set-up app runtimes (lazy mode only). Slide may retain its
    // initialized runtime outside this map and owns freeze/release via focus.
    // Apps without teardown stay in this map as non-evictable entries, so the
    // configured capacity becomes a truthful soft limit instead of forgetting
    // live runtimes. Insertion order is irrelevant; `lastUsed` drives eviction.
    // It is a monotonic access
    // counter (not wall-clock): two touches within the same millisecond
    // would otherwise tie and degrade eviction to Map insertion order.
    private runtimeCache = new Map<
        string,
        {
            lastUsed: number;
            state: "setting-up" | "ready" | "tearing-down" | "pinned";
        }
    >();
    private lruClock = 0;
    private nextLru(): number {
        return ++this.lruClock;
    }
    // In-flight (or queued) setup tasks per app. Duplicate requests reuse the
    // same Promise so an app is never set up twice concurrently.
    private settingUpApps = new Map<string, Promise<void>>();
    private closingAppPromises = new Map<string, Promise<void>>();
    private closingAppOperations = new Map<string, Promise<void>>();
    // Mark apps as soon as their creation task is queued. appStatus is set only
    // when the queue starts a task, which is too late to prevent duplicate tasks
    // during slow module loading.
    private pendingAppIds = new Set<string>();
    // Keep the shared focus on the previous ready App while a local lazy focus is preparing.
    private pendingLazyBlurredAppId?: string;
    // The App whose TeleBox focus is currently being committed. Delayed blur
    // events from the previous App must not clear the shared focus while this
    // target is still in flight.
    private pendingLazyFocusAppId?: string;

    private sideEffectManager = new SideEffectManager();

    public sceneState: SceneState | null = null;

    public rootDirRemoving = false;

    public get lazySetupEnabled(): boolean {
        return Boolean(this.windowManger?.lazySetupInMaximizedMode);
    }

    public canRunLazyTarget(appId?: string): boolean {
        const boxMinimized =
            appId !== undefined && this.attributes.boxesStatus?.[appId] === "minimized";
        if (appId !== undefined) {
            const reported = (this.reportedBoxStatusConflicts ??= new Set());
            if (this.lazySetupEnabled && !this.useBoxesStatus && boxMinimized) {
                if (!reported.has(appId)) {
                    reported.add(appId);
                    this.Logger?.error(
                        `[WindowManager] conflicting boxesStatus: appId: ${appId}, status: minimized, useBoxesStatus: false; lazy target remains blocked, attributes unchanged`
                    );
                }
            } else {
                reported.delete(appId);
            }
        }
        return (
            !this.destroyed &&
            !this.attributes.minimized &&
            (!this.lazySetupEnabled || this.boxManager?.minimized !== true) &&
            (typeof document === "undefined" || document.visibilityState !== "hidden") &&
            !boxMinimized
        );
    }

    private canRunLazyIntent(intent: LazyFocusIntent): boolean {
        // undefined is the real mainView target, not an empty queue. It does
        // not start/unfreeze an App, so suspension only gates string targets.
        return (
            !this.destroyed &&
            this.lazySetupEnabled &&
            (intent.focused === undefined || this.canRunLazyTarget(intent.focused))
        );
    }

    public isCommittedLazyFocus(appId: string): boolean {
        return (
            this.activeLazyAppId === appId &&
            this.store.focus === appId &&
            this.appProxies.get(appId)?.isSetup === true &&
            this.canRunLazyTarget(appId)
        );
    }

    public requestFocusFromTeleBox(appId: string): void {
        if (
            this.lazySetupEnabled &&
            this.isCommittedLazyFocus(appId) &&
            this.pendingLazyFocusAppId === undefined &&
            this.boxManager?.boxIsFocus(appId) === true
        ) return;
        this.requestFocus(appId);
    }

    /** The selected target may initialize resources before its room focus is committed. */
    public isPreparingLazyFocus(appId: string): boolean {
        return (
            this.lazySetupEnabled &&
            this.desiredLazyFocus?.focused === appId &&
            this.preparingLazyFocusAppId === appId &&
            this.canRunLazyTarget(appId)
        );
    }

    public isLazyFocusCommitted(appId: string): boolean {
        return this.lazySetupEnabled && this.activeLazyAppId === appId;
    }

    public isLazyResourceFocused(appId: string): boolean {
        return this.isPreparingLazyFocus(appId) ||
            (this.appProxies.get(appId)?.isSetup === true &&
                this.isLazyFocusCommitted(appId) &&
                (!this.desiredLazyFocus || this.desiredLazyFocus.focused === appId));
    }

    public shouldDeferLazyZIndex(appId: string): boolean {
        const desired = this.desiredLazyFocus?.focused;
        return (
            this.lazySetupEnabled &&
            (this.pendingLazyZIndex !== undefined ||
                (desired !== undefined && this.activeLazyAppId !== desired) ||
                (this.activeLazyAppId !== undefined && this.activeLazyAppId !== appId))
        );
    }

    private reserveLazyZIndex(appId: string | undefined): void {
        const pending = this.pendingLazyZIndex;
        if (pending?.appId === appId) return;
        this.pendingLazyZIndex = undefined;
        if (!this.lazySetupEnabled || !appId || appId === this.activeLazyAppId) return;
        const box = this.boxManager?.getBox?.(appId);
        if (!box) return;
        const visibleAppId = this.activeLazyAppId ?? this.store.focus;
        const otherTop = Math.max(
            visibleAppId && visibleAppId !== appId
                ? this.boxManager?.getBox?.(visibleAppId)?.zIndex ?? 0
                : 0,
            this.boxManager?.getTopBox?.(appId)?.zIndex ?? 0
        );
        const base = pending?.base ?? (otherTop > 0 ? otherTop : Math.max(0, box.zIndex - 1));
        this.pendingLazyZIndex = { appId, base };
    }

    private getLazyScheduler(): LatestTaskQueue<LazyFocusIntent> {
        this.setupTaskQueue.onChange = () => this.lazyScheduler?.wake();
        return (this.lazyScheduler ??= new LatestTaskQueue({
            timeout: 10_000,
            runnable: intent => this.canRunLazyIntent(intent),
            blocker: next => {
                const running = this.setupTaskQueue.current;
                if (!running) return undefined;
                return {
                    startedAt: running.startedAt,
                    canYield:
                        running.id.startsWith("setup:") &&
                        (next.focused === undefined || running.id !== `setup:${next.focused}`),
                    yield: () => {
                        this.Logger?.warn(
                            `[WindowManager] setup yielded; background work may continue, task: ${running.id}, pendingAppId: ${next.focused}, generation: ${next.generation}`
                        );
                        this.setupTaskQueue.yieldSetup();
                    },
                };
            },
            // Physical setup/cleanup was already arbitrated by blocker above.
            canYield: (current, next) => current.focused !== next.focused,
            startedAt: current =>
                current.focused ? this.setupStartedAt?.get(current.focused) : undefined,
            yield: (current, next) => {
                this.Logger?.warn(
                    `[WindowManager] lazy focus wait yielded, appId: ${current.focused}, pendingAppId: ${next.focused}, generation: ${next.generation}`
                );
            },
            error: error => this.Logger?.warn(`[WindowManager] lazy focus queue failed: ${error}`),
        }));
    }

    /** Activity changes never erase the latest focus intent. */
    public refreshLazyActivity(): void {
        this.activityRevision = (this.activityRevision ?? 0) + 1;
        for (const proxy of this.appProxies?.values() ?? []) {
            void proxy.emitAppActivityEvent?.();
        }
        if (!this.lazySetupEnabled) {
            this.reserveLazyZIndex(undefined);
            this.setupTaskQueue.resume();
            return;
        }
        const pending = this.pendingFocusCommit;
        if (pending && !this.canRunLazyTarget(pending.appId)) {
            this.settlePendingFocusCommit(pending.appId, false);
        }
        const desired = this.desiredLazyFocus;
        const focused = desired ? desired.focused : this.store.focus;
        if (
            focused && focused === this.failedSetupFocusAppId &&
            this.activeLazyAppId === focused && !this.appProxies.get(focused)?.isSetup
        ) {
            this.setupTaskQueue.resume();
            return;
        }
        const intent = { ...desired, focused, generation: ++this.lazyFocusGeneration };
        this.scheduleLazyIntent(intent);
        this.setupTaskQueue.resume();
    }

    private scheduleLazyIntent(intent: LazyFocusIntent): void {
        if (this.preparingLazyFocusAppId !== intent.focused) {
            this.preparingLazyFocusAppId =
                intent.focused && this.setupStartedAt?.has(intent.focused)
                    ? intent.focused
                    : undefined;
        }
        const waiter = this.pendingAddSetupWaiter;
        if (waiter && waiter.appId !== intent.focused) {
            this.rejectAddSetupWaiter(waiter, new LazySetupWaitError("superseded", waiter.appId));
        }
        const previous = this.desiredLazyFocus;
        if (previous?.focused && previous.focused !== intent.focused) {
            this.cancelQueuedSetup(previous.focused);
        }
        for (const appId of this.settingUpApps?.keys() ?? []) {
            if (appId !== intent.focused) this.cancelQueuedSetup(appId);
        }
        this.desiredLazyFocus = intent;
        this.pendingLazyFocusAppId = intent.focused;
        this.reserveLazyZIndex(intent.focused);
        if (
            previous?.focused &&
            previous.focused !== intent.focused &&
            previous.focused !== this.store.focus
        ) {
            // A superseded target may already have finished setup while still
            // waiting for room focus. Release its provisional resource focus.
            void this.appProxies.get(previous.focused)?.emitAppFocusEvent?.(false);
        }
        if (this.pendingFocusCommit && this.pendingFocusCommit.appId === intent.focused) {
            this.pendingFocusCommit.generation = intent.generation;
        }
        this.lazyFocusQueue = this.getLazyScheduler().push(intent, () =>
            this.runLazyIntent(intent)
        );
    }

    private rejectAddSetupWaiter(
        waiter: NonNullable<AppManager["pendingAddSetupWaiter"]>,
        error: unknown
    ): void {
        if (this.pendingAddSetupWaiter !== waiter) return;
        this.pendingAddSetupWaiter = undefined;
        clearTimeout(waiter.timer);
        waiter.reject(error);
    }

    /** Waits for the latest added App to complete its lazy room and Box focus commit. */
    public waitForLazyAddedAppSetup(
        appId: string,
        app: AppProxy,
        timeoutMs = this.addSetupWaitTimeout
    ): Promise<void> {
        if (this.isAddedAppFocusCommitted(appId)) return Promise.resolve();
        const previous = this.pendingAddSetupWaiter;
        if (previous) {
            this.rejectAddSetupWaiter(
                previous,
                new LazySetupWaitError("superseded", previous.appId)
            );
        }
        if (
            !this.attributes.minimized &&
            !this.boxManager?.minimized &&
            this.store.focus !== appId &&
            this.desiredLazyFocus?.focused !== appId
        ) {
            return Promise.reject(new LazySetupWaitError("superseded", appId));
        }
        return new Promise<void>((resolve, reject) => {
            const startedAt = Date.now();
            const timer = setTimeout(() => {
                if (this.pendingAddSetupWaiter !== waiter) return;
                this.Logger?.error(
                    `[WindowManager] lazy add setup wait timeout, kind: ${
                        app.kind
                    }, appId: ${appId}, elapsedMs: ${Date.now() - startedAt}, focused: ${
                        this.store.focus
                    }, minimized: ${Boolean(this.attributes.minimized)}`
                );
                this.rejectAddSetupWaiter(waiter, new LazySetupWaitError("timeout", appId));
            }, Math.max(0, timeoutMs));
            const waiter = { appId, resolve, reject, timer };
            this.pendingAddSetupWaiter = waiter;
        });
    }

    private isAddedAppFocusCommitted(appId: string): boolean {
        return this.store.focus === appId && this.activeLazyAppId === appId &&
            this.boxManager?.boxIsFocus?.(appId) === true;
    }

    private get maxCachedApps(): number {
        return (
            this.windowManger?.maxCachedAppsInMaximizedMode ??
            DEFAULT_MAX_CACHED_APPS_IN_MAXIMIZED_MODE
        );
    }

    /**
     * Enqueue a real app setup into the serial setup queue. The queued task
     * normally waits until `app.setup()` finishes before the next task starts.
     * A superseded lazy setup may yield its scheduling lease after 10 seconds.
     * Duplicate requests for the same app reuse the same Promise.
     */
    public enqueueAppSetup(appId: string, priority?: () => number): Promise<void> {
        const existing = this.settingUpApps.get(appId);
        if (existing) {
            return existing;
        }
        const promise = this.setupTaskQueue.push(
            `setup:${appId}`,
            priority ?? (() => this.computeSetupPriority(appId)),
            async () => {
                const appProxy = this.appProxies.get(appId);
                if (!appProxy || appProxy.isDestroyed) {
                    return;
                }
                if (appProxy.isSetup) {
                    // A live runtime may temporarily lack lazy bookkeeping
                    // (for example after lazy -> eager -> lazy). Re-register
                    // it, but never invoke app.setup() a second time.
                    this.touchRuntime(appId);
                    return;
                }
                if (this.lazySetupEnabled) {
                    const entry = this.runtimeCache.get(appId);
                    if (entry && entry.state !== "tearing-down") {
                        entry.state = "setting-up";
                    } else {
                        this.runtimeCache.set(appId, {
                            lastUsed: this.nextLru(),
                            state: "setting-up",
                        });
                    }
                }
                // Log physical work separately from the scheduling lease:
                // after a timeout yield, old third-party work may still run.
                const startedAt = Date.now();
                (this.setupStartedAt ??= new Map()).set(appId, startedAt);
                if (this.lazySetupEnabled && this.desiredLazyFocus?.focused === appId) {
                    this.preparingLazyFocusAppId = appId;
                    this.reserveLazyZIndex(appId);
                }
                this.Logger?.info(`[WindowManager] app setup start, appId: ${appId}`);
                try {
                    await appProxy.ensureSetup();
                    if (appProxy.isDestroyed || this.appProxies.get(appId) !== appProxy) return;
                    this.Logger?.info(
                        `[WindowManager] app setup done, appId: ${appId}, duration: ${
                            Date.now() - startedAt
                        }ms`
                    );
                    if (this.lazySetupEnabled) {
                        // A re-setup after eviction/teardown has no cache
                        // entry yet: recreate it, otherwise the app would
                        // only re-enter the cache on a SECOND focus.
                        if (!this.runtimeCache.has(appId)) {
                            if (appProxy.isSetup && !appProxy.isDestroyed) {
                                this.runtimeCache.set(appId, {
                                    lastUsed: this.nextLru(),
                                    state: "ready",
                                });
                            }
                        } else {
                            const entry = this.runtimeCache.get(appId);
                            if (entry && entry.state !== "tearing-down") {
                                entry.state = "ready";
                                entry.lastUsed = this.nextLru();
                            }
                        }
                        if (this.attributes.minimized) {
                            // A setup started before minimize may finish afterwards;
                            // release it to keep minimized free of runtimes.
                            // Fire-and-forget: queue rejection (destroy clear)
                            // must not become an unhandled rejection.
                            this.teardownRuntime(appId).catch(() => undefined);
                        }
                    }
                } catch (error) {
                    if (this.preparingLazyFocusAppId === appId)
                        this.preparingLazyFocusAppId = undefined;
                    if (this.lazySetupEnabled && this.appProxies.get(appId) === appProxy) {
                        // A failed setup does not occupy a cache slot.
                        this.runtimeCache.delete(appId);
                    }
                    throw error;
                } finally {
                    if (this.appProxies.get(appId) === appProxy) {
                        this.settingUpApps.delete(appId);
                    }
                    if (this.setupStartedAt?.get(appId) === startedAt) {
                        this.setupStartedAt?.delete(appId);
                    }
                    this.lazyScheduler?.wake();
                }
            },
            () => !this.lazySetupEnabled || this.canRunLazyTarget(appId)
        );
        this.settingUpApps.set(appId, promise);
        promise.catch(() => undefined);
        return promise;
    }

    /**
     * Schedule the eager setup of a freshly created AppProxy. Replaces the
     * unmanaged `setTimeout` hand-off so initial setups are serialized and
     * ordered focused-app-first. Failures are already logged inside AppProxy
     * (setup/abort/descriptor paths); the catch here only keeps the queue
     * hand-off from rejecting into the void.
     */
    public enqueueEagerSetup(appId: string): void {
        this.enqueueAppSetup(appId).catch(() => undefined);
    }

    /**
     * Batch ordering key for pending setup tasks: in independent-box mode,
     * forceTop apps come first; global/lazy mode ignores forceTop. The
     * remaining order is focused app, zIndex descending, then creation order
     * (design §7.3 / test §19.34).
     */
    private computeSetupPriority(appId: string): number {
        const appAttrs = this.attributes.apps?.[appId];
        if (this.useBoxesStatus && appAttrs?.forceTop) {
            return 0;
        }
        if (this.store.focus === appId) {
            return 1;
        }
        const zIndex = appAttrs?.state?.zIndex ?? 0;
        return 100 - Math.min(zIndex, 99);
    }

    private touchRuntime(appId: string): void {
        if (!this.lazySetupEnabled) return;
        const entry = this.runtimeCache.get(appId);
        if (entry) {
            entry.lastUsed = this.nextLru();
        } else if (this.appProxies.get(appId)?.isSetup) {
            this.runtimeCache.set(appId, { lastUsed: this.nextLru(), state: "ready" });
        }
    }

    private runtimeCacheSize(): number {
        let size = 0;
        this.runtimeCache.forEach(entry => {
            if (entry.state !== "tearing-down") size += 1;
        });
        return size;
    }

    private retainsRuntimeAfterEviction(appId: string): boolean {
        const proxy = this.appProxies.get(appId);
        return proxy?.kind === "Slide" && proxy.isSetup && !proxy.isDestroyed;
    }

    private pickRuntimeEvictionCandidate(exclude: Set<string>): string | undefined {
        let candidate: string | undefined;
        let oldest = Infinity;
        this.runtimeCache.forEach((entry, id) => {
            // Apps without a teardown implementation keep both their runtime
            // and cache entry. Excluding them from eviction makes cache size a
            // soft limit while keeping every live runtime accounted for.
            if (entry.state !== "ready" || exclude.has(id)) return;
            if (!this.retainsRuntimeAfterEviction(id) && !this.appProxies.get(id)?.canTeardown)
                return;
            if (entry.lastUsed < oldest) {
                oldest = entry.lastUsed;
                candidate = id;
            }
        });
        return candidate;
    }

    /**
     * Tear down LRU cached runtimes until there is room for `appId`.
     * The currently visible app is never evicted here; the cache=1 hand-off
     * tears it down after the new app is ready (see `evictAfterFocusCommit`).
     */
    private async evictBeforeSetup(appId: string): Promise<void> {
        if (!this.lazySetupEnabled) return;
        const exclude = new Set<string>(
            [appId, this.store.focus].filter((id): id is string => Boolean(id))
        );
        while (this.runtimeCacheSize() >= this.maxCachedApps) {
            const candidate = this.pickRuntimeEvictionCandidate(exclude);
            if (!candidate) {
                // Only no-teardown/pinned runtimes remain: they cannot be
                // suspended (design §13), so the cache softly overflows by
                // their count. The overflow is intentional and counted.
                this.Logger?.warn(
                    `[WindowManager] no evictable runtime available; cache exceeds maxCachedAppsInMaximizedMode (${this.maxCachedApps})`
                );
                break;
            }
            if (candidate === this.activeLazyAppId) break;
            await this.teardownRuntime(candidate);
        }
    }

    /** Evict LRU runtimes overflowing the cache once a new app became active. */
    private async evictAfterFocusCommit(appId: string): Promise<void> {
        if (!this.lazySetupEnabled) return;
        const exclude = new Set<string>(
            [appId, this.store.focus].filter((id): id is string => Boolean(id))
        );
        while (this.runtimeCacheSize() > this.maxCachedApps) {
            const candidate = this.pickRuntimeEvictionCandidate(exclude);
            if (!candidate) break;
            if (candidate === this.activeLazyAppId) break;
            await this.teardownRuntime(candidate);
        }
    }

    /** Tear down one cached runtime through the serial queue. */
    private async teardownRuntime(appId: string): Promise<void> {
        const entry = this.runtimeCache.get(appId);
        if (!entry || entry.state !== "ready") return;
        const proxy = this.appProxies.get(appId);
        if (proxy && !proxy.canTeardown && !this.retainsRuntimeAfterEviction(appId)) {
            // No teardown implementation: the runtime would stay alive while
            // the cache bookkeeping forgets it. Keep the entry so capacity
            // accounting stays truthful (design §13).
            this.Logger?.warn(
                `[WindowManager] app ${appId} has no teardown; keeping runtime and cache slot`
            );
            return;
        }
        entry.state = "tearing-down";
        const cleanup = this.setupTaskQueue.push(
            `teardown:${appId}`,
            () => -1,
            async () => {
                // Lazy mode may have been disabled while this task was
                // queued (forceMaximized cleared): eager mode keeps runtimes
                // alive, so drop only the bookkeeping - already cleared by
                // the transition - and skip the teardown.
                if (!this.lazySetupEnabled) return;
                const appProxy = this.appProxies.get(appId);
                try {
                    // Slide already freezes on blur. Keep its setup scope,
                    // DOM and listeners until the proxy is actually destroyed.
                    if (!this.retainsRuntimeAfterEviction(appId)) {
                        await appProxy?.teardown();
                    }
                } catch (error) {
                    // Partial teardown: the runtime may still be alive. Keep
                    // the bookkeeping under a pinned state - the app stays
                    // counted against capacity and is excluded from further
                    // eviction until proven disposable again.
                    this.Logger?.error(
                        `[WindowManager] runtime teardown failed for ${appId}, pinning cache slot: ${error}`
                    );
                    const failed = this.runtimeCache.get(appId);
                    if (failed) {
                        failed.state = "pinned";
                        failed.lastUsed = this.nextLru();
                    }
                    this.settingUpApps.delete(appId);
                    return;
                }
                this.runtimeCache.delete(appId);
                this.settingUpApps.delete(appId);
            }
        );
        (this.runtimeCleanups ??= new Map()).set(appId, cleanup);
        try {
            await cleanup;
        } finally {
            if (this.runtimeCleanups.get(appId) === cleanup) this.runtimeCleanups.delete(appId);
        }
    }

    /** Drop lazy cache bookkeeping on the lazy -> eager transition. Eager
     * mode never consults the cache; if lazy is re-enabled, ready apps
     * re-enter the cache via touchRuntime on their next focus.
     * `settingUpApps` is intentionally KEPT: in-flight or queued setups
     * stay deduplicated, and after the transition they simply complete as
     * eager setups. Queued lazy TEARDOWN tasks self-cancel at run time
     * (they check lazySetupEnabled), so a pending eviction cannot tear
     * down a runtime that eager mode now keeps alive. */
    public clearLazyBookkeeping(): void {
        this.reserveLazyZIndex(undefined);
        this.failedSetupFocusAppId = undefined;
        this.lazyScheduler?.dispose();
        this.lazyScheduler = undefined;
        this.desiredLazyFocus = undefined;
        this.preparingLazyFocusAppId = undefined;
        this.runtimeCache.clear();
        this.activeLazyAppId = undefined;
        this.pendingLazyFocusAppId = undefined;
        this.pendingLazyBlurredAppId = undefined;
        // Invalidate every lazy transition that has not reached its commit
        // point. The promise chain itself is intentionally left intact so a
        // running task can settle, but its continuation must become a no-op.
        this.lazyFocusGeneration += 1;
        this.activityRevision = (this.activityRevision ?? 0) + 1;
        for (const proxy of this.appProxies?.values() ?? []) void proxy.emitAppActivityEvent?.();
        this.setupTaskQueue.resume();
    }

    /** Drop cache bookkeeping for an app whose proxy was destroyed. */
    public notifyAppDestroyed(appId: string): void {
        if (this.failedSetupFocusAppId === appId) this.failedSetupFocusAppId = undefined;
        if (this.preparingLazyFocusAppId === appId) this.preparingLazyFocusAppId = undefined;
        if (this.pendingLazyZIndex?.appId === appId) this.pendingLazyZIndex = undefined;
        if (this.lazySetupEnabled) {
            const waiter = this.pendingAddSetupWaiter;
            if (waiter?.appId === appId) {
                this.rejectAddSetupWaiter(waiter, new LazySetupWaitError("destroyed", appId));
            }
            if (this.pendingFocusCommit?.appId === appId) {
                this.settlePendingFocusCommit(appId, false);
            }
            if (this.desiredLazyFocus?.focused === appId) {
                this.lazyFocusGeneration += 1;
                this.desiredLazyFocus = undefined;
                if (this.pendingLazyFocusAppId === appId) this.pendingLazyFocusAppId = undefined;
                this.lazyScheduler?.cancelPending(intent => intent.focused === appId);
            }
            this.cancelQueuedSetup(appId);
        }
        this.runtimeCache.delete(appId);
        this.settingUpApps.delete(appId);
        if (this.activeLazyAppId === appId) {
            this.activeLazyAppId = undefined;
        }
    }

    public trackAppClose(appId: string, close: Promise<void>): void {
        (this.closingAppPromises ??= new Map()).set(appId, close);
        const clear = () => {
            if (this.closingAppPromises.get(appId) === close)
                this.closingAppPromises.delete(appId);
        };
        void close.then(clear, clear);
    }

    public captureAppClose(appId: string) {
        return {
            wasFocused: this.store.focus === appId,
            wasPending: this.desiredLazyFocus?.focused === appId,
            generation: this.lazyFocusGeneration,
        };
    }

    public getCloseSuccessor(closingId: string): string | undefined {
        const apps = this.attributes.apps ?? {};
        return Object.keys(apps)
            .filter(id => id !== closingId && !this.appProxies.get(id)?.isDestroyed)
            .sort((a, b) => {
                const aZ = this.boxManager?.getBox(a)?.zIndex ?? apps[a]?.state?.zIndex ?? 0;
                const bZ = this.boxManager?.getBox(b)?.zIndex ?? apps[b]?.state?.zIndex ?? 0;
                return bZ - aZ || (apps[b]?.createdAt ?? 0) - (apps[a]?.createdAt ?? 0);
            })[0];
    }

    public finishAppClose(
        closingId: string,
        close: ReturnType<AppManager["captureAppClose"]>
    ): Promise<void> {
        if (!this.windowManger.canOperate || (!close.wasFocused && !close.wasPending))
            return Promise.resolve();
        const current = this.store.focus;
        const currentIsValid = Boolean(
            current && this.attributes.apps?.[current] &&
            !this.appProxies.get(current)?.isDestroyed
        );
        if (current !== closingId && currentIsValid) return Promise.resolve();
        const successor = this.getCloseSuccessor(closingId);
        if (!successor) {
            if (Object.keys(this.attributes.apps ?? {}).length === 0 && this.store.focus !== undefined)
                this.store.cleanFocus();
            return Promise.resolve();
        }
        const newerIntent = this.desiredLazyFocus;
        if (
            this.lazySetupEnabled && this.lazyFocusGeneration > close.generation &&
            newerIntent &&
            (newerIntent.focused === undefined ||
                (newerIntent.focused !== closingId &&
                    this.attributes.apps?.[newerIntent.focused] &&
                    !this.appProxies.get(newerIntent.focused)?.isDestroyed))
        ) return Promise.resolve();
        if (this.lazySetupEnabled && this.isCommittedLazyFocus(successor) &&
            this.boxManager?.boxIsFocus(successor)) return Promise.resolve();
        const focus = this.lazySetupEnabled
            ? this.requestFocusAndWait(successor)
            : this.windowManger.focusApp(successor);
        return focus.then(() => undefined);
    }

    /** Drop the minimized cache, retaining initialized Slide runtimes. */
    private teardownAllRuntimeCaches(): Promise<void> {
        const revision = this.minimizedRevision;
        const ids = Array.from(this.runtimeCache.keys()).filter(id => {
            return this.runtimeCache.get(id)?.state === "ready";
        });
        return this.setupTaskQueue.push(
            `teardown-all:${ids.length}`,
            () => -1,
            async () => {
                // Lazy mode may have been disabled while this batch was
                // queued (forceMaximized cleared): eager keeps runtimes
                // alive, so the whole batch becomes a no-op (bookkeeping
                // was already dropped by the transition).
                if (
                    !this.lazySetupEnabled ||
                    !this.attributes.minimized ||
                    revision !== this.minimizedRevision
                )
                    return;
                for (const id of ids) {
                    if (!this.attributes.minimized || revision !== this.minimizedRevision) return;
                    const entry = this.runtimeCache.get(id);
                    if (!entry || entry.state !== "ready") continue;
                    if (
                        !this.retainsRuntimeAfterEviction(id) &&
                        !this.appProxies.get(id)?.canTeardown
                    ) {
                        continue;
                    }
                    entry.state = "tearing-down";
                    const appProxy = this.appProxies.get(id);
                    try {
                        if (!this.retainsRuntimeAfterEviction(id)) {
                            await appProxy?.teardown();
                        }
                    } catch (error) {
                        // Same contract as the single teardown: a failing
                        // teardown pins the slot instead of forgetting a
                        // possibly-alive runtime.
                        this.Logger?.error(
                            `[WindowManager] runtime teardown failed for ${id}, pinning cache slot: ${error}`
                        );
                        const failed = this.runtimeCache.get(id);
                        if (failed) {
                            failed.state = "pinned";
                            failed.lastUsed = this.nextLru();
                        }
                        this.settingUpApps.delete(id);
                        continue;
                    }
                    this.runtimeCache.delete(id);
                    this.settingUpApps.delete(id);
                    if (revision !== this.minimizedRevision || !this.attributes.minimized) return;
                }
                this.activeLazyAppId = undefined;
            }
        );
    }

    private _useBoxesStatus = false;

    public get useBoxesStatus() {
        return this._useBoxesStatus;
    }

    public set useBoxesStatus(value: boolean) {
        this._useBoxesStatus = value;
    }

    constructor(public windowManger: WindowManager) {
        this.displayer = windowManger.displayer;
        this.store = createAttributesDelegate(WindowManager.extendClass, {
            getAttributes: () => this.attributes,
            safeSetAttributes: attributes => this.safeSetAttributes(attributes),
            safeUpdateAttributes: (keys, val) => this.safeUpdateAttributes(keys, val),
        });

        this.mainViewProxy = new MainViewProxy(this);
        this.viewManager = new ViewManager(this.displayer);
        this.appListeners = new AppListeners(this);
        this.displayer.callbacks.on(this.eventName, this.displayerStateListener);
        this.appListeners.addListeners();

        this.refresher = reconnectRefresher;
        this.refresher.setRoom(this.room);
        this.refresher.setContext({ emitter: internalEmitter });

        this.sideEffectManager.addDisposer(() => {
            this.appCreateQueue.destroy();
            this.mainViewProxy.destroy();
            this.refresher.destroy();
            this.viewManager.destroy();
            this.boxManager?.destroy();
            this.callbacksNode?.dispose();
        });

        internalEmitter.once("onCreated").then(() => this.onCreated());
        internalEmitter.on("onReconnected", () => this.onReconnected());

        if (isPlayer(this.displayer)) {
            internalEmitter.on("seekStart", this.onPlayerSeekStart);
            internalEmitter.on("seek", this.onPlayerSeekDone);
        }

        internalEmitter.on("removeScenes", this.onRemoveScenes);
        internalEmitter.on("setReadonly", this.onReadonlyChanged);
        if (typeof document !== "undefined") {
            const refresh = () => this.refreshLazyActivity();
            document.addEventListener("visibilitychange", refresh);
            window.addEventListener("pageshow", refresh);
            this.sideEffectManager.addDisposer(() => {
                document.removeEventListener("visibilitychange", refresh);
                window.removeEventListener("pageshow", refresh);
            });
        }

        this.createRootDirScenesCallback();

        appRegister.setSyncRegisterApp(payload => {
            this.safeUpdateAttributes([Fields.Registered, payload.kind], payload);
        });
    }

    public getMemberState(): MemberState {
        return this.room?.state.memberState || ({ strokeColor: [0, 0, 0] } as MemberState);
    }

    private onRemoveScenes = async (params: RemoveSceneParams) => {
        const { scenePath } = params;
        // 如果移除根目录就把 scenePath 设置为初始值
        if (scenePath === ROOT_DIR) {
            console.log("[window-manager] onRemoveScenes ROOT_DIR");
            await this.onRootDirRemoved();
            this.dispatchInternalEvent(Events.RootDirRemoved);
            return;
        }
        if (isRootDirPage(scenePath)) {
            let nextIndex = this.mainView.focusSceneIndex || 0;
            let sceneName = this.callbacksNode?.scenes[nextIndex];
            if (!sceneName) {
                nextIndex = 0;
                sceneName = this.callbacksNode?.scenes[nextIndex];
            }
            if (sceneName) {
                console.log(
                    `[window-manager] onRemoveScenes  setMainViewScenePath ${ROOT_DIR}${sceneName}`
                );
                this.setMainViewScenePath(`${ROOT_DIR}${sceneName}`);
            }
            await this.setMainViewSceneIndex(nextIndex);
        } else {
            this.appProxies.forEach(app => {
                app.onRemoveScene(scenePath);
            });
        }
    };

    /**
     * 根目录被删除时所有的 scene 都会被删除.
     * 所以需要关掉所有开启了 view 的 app
     */
    public async onRootDirRemoved(needClose = true) {
        this.setMainViewScenePath(INIT_DIR);
        this.createRootDirScenesCallback();

        for (const [id, appProxy] of this.appProxies.entries()) {
            if (appProxy.view) {
                await this.closeApp(id, needClose);
            }
        }
        // 删除了根目录的 scenes 之后 mainview 需要重新绑定, 否则主白板会不能渲染
        this.mainViewProxy.rebind();
        internalEmitter.emit("rootDirRemoved");
        this.updateRootDirRemoving(false);
    }

    private onReadonlyChanged = () => {
        this.appProxies.forEach(appProxy => {
            appProxy.emitAppIsWritableChange();
        });
    };

    private onPlayerSeekStart = async () => {
        await this.closeAll();
    };

    private onPlayerSeekDone = async (time: number) => {
        await this._attributesUpdateCallback(this.attributes.apps);
        this.appProxies.forEach(appProxy => {
            appProxy.onSeek(time);
        });
    };

    public createRootDirScenesCallback = () => {
        let isRecreate = false;
        if (this.callbacksNode) {
            this.callbacksNode.dispose();
            isRecreate = true;
        }
        this.callbacksNode = this.displayer.createScenesCallback(ROOT_DIR, {
            onAddScene: this.onSceneChange,
            onRemoveScene: async (node, name) => {
                await this.onSceneChange(node);
                internalEmitter.emit("rootDirSceneRemoved", name);
            },
        });
        if (this.callbacksNode) {
            this.updateSceneState(this.callbacksNode);
            this.mainViewScenesLength = this.callbacksNode.scenes.length;
            if (isRecreate) {
                this.emitMainViewScenesChange(this.callbacksNode.scenes.length);
            }
        }
    };

    public removeSceneByIndex = async (index: number) => {
        const nextIndex = calculateNextIndex(index, this.windowManger.pageState);
        this.setSceneIndexWithoutSync(nextIndex);
        this.dispatchInternalEvent(Events.SetAppFocusIndex, { type: "main", index: nextIndex });
        const scene = this.callbacksNode?.scenes[index];
        setTimeout(() => {
            if (scene) {
                removeScenes(this.room, `${ROOT_DIR}${scene}`, index);
            }
        }, 100);
        return new Promise<boolean>((resolve, reject) => {
            internalEmitter
                .once("rootDirSceneRemoved")
                .then(name => {
                    if (name === scene) {
                        resolve(true);
                    }
                })
                .catch(e => {
                    console.log(`[WindowManager]: removePage error: ${e}`);
                    reject(false);
                });
        });
    };

    public setSceneIndexWithoutSync = (index: number) => {
        const sceneName = this.callbacksNode?.scenes[index];
        if (sceneName) {
            this.mainViewProxy.setFocusScenePath(`${ROOT_DIR}${sceneName}`);
        }
    };

    private onSceneChange = (node: ScenesCallbacksNode) => {
        this.mainViewScenesLength = node.scenes.length;
        this.updateSceneState(node);
        return this.emitMainViewScenesChange(this.mainViewScenesLength);
    };

    private emitMainViewScenesChange = (length: number) => {
        return Promise.all([
            callbacks.emit("mainViewScenesLengthChange", length),
            internalEmitter.emit("changePageState"),
        ]);
    };

    private updateSceneState = (node: ScenesCallbacksNode) => {
        const currentIndex = this.store.getMainViewSceneIndex() || 0;
        let sceneName = node.scenes[currentIndex];
        if (!sceneName) {
            sceneName = node.scenes[this.mainView.focusSceneIndex || 0];
        }
        this.sceneState = {
            scenePath: `${ROOT_DIR}${sceneName}`,
            contextPath: node.path,
            index: currentIndex,
            scenes: node.scenes.map(scene => {
                return {
                    name: scene,
                };
            }),
            sceneName: sceneName,
        };
        callbacks.emit("sceneStateChange", this.sceneState);
    };

    private get eventName() {
        return isRoom(this.displayer) ? "onRoomStateChanged" : "onPlayerStateChanged";
    }

    public get attributes() {
        return this.windowManger.attributes;
    }

    public get canOperate() {
        return this.windowManger.canOperate;
    }

    public get room() {
        return isRoom(this.displayer) ? (this.displayer as Room) : undefined;
    }

    public get mainView() {
        return this.mainViewProxy.view;
    }

    public get polling() {
        return this.mainViewProxy.polling;
    }

    public set polling(b: boolean) {
        this.mainViewProxy.polling = b;
    }

    public get focusApp() {
        if (this.store.focus) {
            return this.appProxies.get(this.store.focus);
        }
    }

    public get uid() {
        return this.room?.uid || "";
    }

    public get Logger() {
        return this.windowManger.Logger;
    }

    public getMainViewSceneDir() {
        const scenePath = this.store.getMainViewScenePath();
        if (scenePath) {
            return parseSceneDir(scenePath);
        } else {
            throw new Error("[WindowManager]: mainViewSceneDir not found");
        }
    }

    private async onCreated() {
        const initialAppIds = Object.keys(this.attributes.apps || {});
        const initialFocus = this.store.focus;
        this.initialFocusRecoveryAppIds = new Set(initialAppIds);
        this.initialFocusRecoverySource = initialFocus;
        this.initialFocusRecoveryPending = initialAppIds.length > 0 &&
            (!initialFocus || !this.initialFocusRecoveryAppIds.has(initialFocus));
        if (initialAppIds.length && initialFocus && !this.initialFocusRecoveryPending) {
            this._focusAppId = initialFocus;
            await new Promise<AppProxy | undefined>(resolve => {
                this._focusAppCreatedResolve = resolve;
                this._resolveTimer = setTimeout(() => {
                    resolve(this.appProxies.get(this._focusAppId || ""));
                }, 500);
            }).then(() => {
                this._resolveTimer = undefined;
                this._focusAppCreatedResolve = undefined;
                this.focusByAttributes(this.attributes.apps);
            });
        }
        await this._attributesUpdateCallback(this.attributes.apps);
        internalEmitter.emit("updateManagerRect");
        boxEmitter.on("move", this.onBoxMove);
        boxEmitter.on("resize", this.onBoxResize);
        boxEmitter.on("focus", this.onBoxFocus);
        boxEmitter.on("close", this.onBoxClose);
        boxEmitter.on("boxStateChange", this.onBoxStateChange);
        boxEmitter.on("blurred", this.onBoxBlurred);

        this.addAppsChangeListener();
        this.addAppCloseListener();
        this.addBoxesStatusChangeListener();
        this.refresher.add("maximized", () => {
            return autorun(() => {
                const maximized = this.attributes.maximized;
                if (!maximized && this.windowManger.forceMaximized) {
                    this.Logger?.warn(
                        "[WindowManager] ignored remote normal state while forceMaximized is enabled"
                    );
                    if (this.windowManger.canOperate) {
                        this.windowManger.safeSetAttributes({ maximized: true });
                    }
                    this.boxManager?.setMaximized(true);
                    return;
                }
                this.boxManager?.setMaximized(Boolean(maximized));
                this.refreshLazyActivity();
            });
        });
        this.refresher.add("minimized", () => {
            return autorun(() => {
                const minimized = this.attributes.minimized;
                this.onMinimized(minimized);
            });
        });
        this.refresher.add("mainViewIndex", () => {
            return autorun(() => {
                const mainSceneIndex = get(this.attributes, "_mainSceneIndex");
                this.onMainViewIndexChange(mainSceneIndex);
            });
        });
        this.refresher.add("focusedChange", () => {
            return autorun(() => {
                const focused = this.store.focus;
                this.onFocusChange(focused);
            });
        });
        this.refresher.add("forceMaximized", () => {
            return autorun(() => {
                this.windowManger.applyForceMaximized(this.attributes.forceMaximized === true);
            });
        });
        this.refresher.add("registeredChange", () => {
            return autorun(() => {
                const registered = get(this.attributes, Fields.Registered);
                this.onRegisteredChange(registered);
            });
        });
        if (!this.attributes.apps || Object.keys(this.attributes.apps).length === 0) {
            const mainScenePath = this.store.getMainViewScenePath();
            if (!mainScenePath) return;
            this.resetScenePath(mainScenePath);
        }
        this.displayerWritableListener(!this.room?.isWritable);
        this.displayer.callbacks.on("onEnableWriteNowChanged", this.displayerWritableListener);
        this.focusByAttributes(this.attributes.apps);
        this._prevFocused = this.store.focus;

        if (!WindowManager.supportAppliancePlugin) {
            this.sideEffectManager.add(() => {
                const redoUndo = new RedoUndo({
                    mainView: () => this.mainViewProxy.view,
                    focus: () => this.attributes.focus,
                    getAppProxy: id => this.appProxies.get(id),
                });
                return () => redoUndo.destroy();
            });
        }
    }

    private onBoxMove = (payload: BoxMovePayload) => {
        this.dispatchInternalEvent(Events.AppMove, payload);
        this.store.updateAppState(payload.appId, AppAttributes.Position, {
            x: payload.x,
            y: payload.y,
        });
        callbacks.emit("onBoxMove", payload);
    };

    private onBoxResize = (payload: BoxResizePayload) => {
        if (payload.width && payload.height) {
            this.dispatchInternalEvent(Events.AppResize, payload);
            this.store.updateAppState(payload.appId, AppAttributes.Size, {
                width: payload.width,
                height: payload.height,
            });
            callbacks.emit("onBoxResize", payload);
        }
        this.scheduleAppBoxSizeSync(payload.appId);
    };

    public scheduleAppBoxSizeSync = (appId?: string, options?: AppBoxSizeSyncOptions): void => {
        if (appId) {
            this.appProxies.get(appId)?.scheduleBoxSizeSync(options);
        } else {
            this.appProxies.forEach(appProxy => appProxy.scheduleBoxSizeSync(options));
        }
    };

    private onBoxFocus = (payload: BoxFocusEventPayload) => {
        this.handleBoxFocus(payload);
    };

    private handleBoxFocus(payload: BoxFocusEventPayload): void {
        if (
            this.lazySetupEnabled &&
            payload.source === "programmatic" &&
            this.store.focus === payload.appId &&
            this.appProxies.get(payload.appId)?.isSetup
        )
            return;
        const allowSetupFailureFallback =
            payload.source === "telebox" && this.windowManger.canOperate;
        if (this.lazySetupEnabled) {
            // TeleBox has already focused the target before emitting this event.
            // The authoritative focus still identifies the previous app.
            const pendingBlurredAppId = this.store.focus;
            this.pendingLazyBlurredAppId = pendingBlurredAppId;
            const pending = this.pendingFocusCommit;
            if (pending && pending.appId !== payload.appId)
                this.settlePendingFocusCommit(pending.appId, false);
            this.scheduleLazyIntent({
                previous: pendingBlurredAppId,
                focused: payload.appId,
                generation: ++this.lazyFocusGeneration,
                commitAfterSetup: true,
                fallback: allowSetupFailureFallback,
            });
            if (!this.appProxies.get(payload.appId)?.isSetup) {
                this.suppressLazyBlur = true;
                try {
                    this.boxManager?.blurAllBox();
                } finally {
                    this.suppressLazyBlur = false;
                }
            }
            return;
        }
        this.windowManger.safeSetAttributes({ focus: payload.appId });
        callbacks.emit("onBoxFocus", { appId: payload.appId });
        if (this.pendingLazyFocusAppId === payload.appId) {
            this.pendingLazyFocusAppId = undefined;
        }
    }

    private onBoxBlurred = (payload: BoxBlurredPayload) => {
        this.handleBoxBlurred(payload);
    };

    private handleBoxBlurred(payload: BoxBlurredPayload): void {
        if (this.lazySetupEnabled) {
            // Ignore the synthetic blur synchronously, before it can be queued.
            if (this.suppressLazyBlur || !this.canRunLazyTarget(payload.appId)) return;
            if (this.pendingLazyBlurredAppId === payload.appId) {
                this.pendingLazyBlurredAppId = undefined;
                return;
            }
            this.queueLazyBoxBlurred(payload);
            return;
        }
        const focus = this.attributes.focus;
        if (focus === payload.appId) {
            if (this.pendingLazyBlurredAppId === payload.appId) {
                this.pendingLazyBlurredAppId = undefined;
                return;
            }
            this.windowManger.safeSetAttributes({ focus: undefined });
            callbacks.emit("onBoxBlurred", payload);
        }
    }

    private queueLazyBoxBlurred(payload: BoxBlurredPayload): void {
        this.lazyFocusQueue = this.lazyFocusQueue
            .catch(() => undefined)
            .then(() => {
                if (this.lazySetupEnabled && !this.canRunLazyTarget(payload.appId)) return;
                // If the mode changed while this blur was queued, apply the
                // eager semantics to the real event instead of retaining a
                // lazy marker that no longer has an owner.
                if (!this.lazySetupEnabled) {
                    if (this.attributes.focus === payload.appId) {
                        this.windowManger.safeSetAttributes({ focus: undefined });
                        callbacks.emit("onBoxBlurred", payload);
                    }
                    return;
                }
                // A stale blur from the previous box must not win over the
                // newer target that is still being setup/focused.
                if (this.pendingLazyBlurredAppId === payload.appId) {
                    this.pendingLazyBlurredAppId = undefined;
                    return;
                }
                if (this.pendingLazyFocusAppId) {
                    return;
                }
                const focus = this.attributes.focus;
                if (focus !== payload.appId) return;
                this.windowManger.safeSetAttributes({ focus: undefined });
                callbacks.emit("onBoxBlurred", payload);
            })
            .catch(error => {
                this.Logger?.warn(`[WindowManager] lazy blur queue failed: ${error}`);
            });
    }

    private onBoxClose = (payload: BoxClosePayload) => {
        if (!this.closingAppPromises?.has(payload.appId))
            void this.closeApp(payload.appId, true, true);
        callbacks.emit("onBoxClose", payload);
    };

    private onBoxStateChange = (payload: BoxStateChangePayload) => {
        this.dispatchInternalEvent(Events.AppBoxStateChange, payload);
        callbacks.emit("onBoxStateChange", payload);
    };

    private notifyBoxesStatusChange = debounce(() => {
        this.boxManager?.setBoxesStatus(this.attributes.boxesStatus);
        const entries = Object.entries(this.attributes.boxesStatus);
        if (entries.length > 0) {
            entries.forEach(([appId, status]) => {
                const appProxy = this.appProxies.get(appId);
                if (appProxy) {
                    appProxy.notifyBoxStatusChange(status as TeleBoxState);
                }
            });
        }
        this.refreshLazyActivity();
    }, 100);

    public addBoxesStatusChangeListener = () => {
        this.refresher.add("boxesStatus", () => {
            return safeListenPropsUpdated(
                () => this.attributes.boxesStatus,
                () => {
                    this.notifyBoxesStatusChange();
                }
            );
        });
        this.refresher.add("lastNotMinimizedBoxesStatus", () => {
            return safeListenPropsUpdated(
                () => this.attributes.lastNotMinimizedBoxesStatus,
                () => {
                    this.boxManager?.setLastNotMinimizedBoxesStatus(
                        this.attributes.lastNotMinimizedBoxesStatus
                    );
                }
            );
        });
    };
    public addAppsChangeListener = () => {
        this.refresher.add("apps", () => {
            return safeListenPropsUpdated(
                () => this.attributes.apps,
                () => {
                    this.attributesUpdateCallback(this.attributes.apps);
                }
            );
        });
    };

    public addAppCloseListener = () => {
        // this.refresher.add("appsClose", () => {
        //     return onObjectRemoved(this.attributes.apps, () => {
        //         this.onAppDelete(this.attributes.apps);
        //     });
        // });
        this.refresher.add("appsClose", () => {
            return safeListenPropsUpdated(
                () => this.attributes.apps,
                events => {
                    if (events.some(e => e.kind === UpdateEventKind.Removed)) {
                        this.onAppDelete(this.attributes.apps);
                    }
                }
            );
        });
    };

    private onMainViewIndexChange = (index: number) => {
        if (index !== undefined && this._prevSceneIndex !== index) {
            callbacks.emit("mainViewSceneIndexChange", index);
            internalEmitter.emit("changePageState");
            if (this.callbacksNode) {
                this.updateSceneState(this.callbacksNode);
            }
            this._prevSceneIndex = index;
        }
    };

    private onFocusChange = (focused: string | undefined) => {
        this.handleFocusChange(focused);
    };

    private handleFocusChange(focused: string | undefined): void {
        if (this.destroyed) return;
        const localFeedback = this.localFocusFeedback === focused && focused !== undefined;
        this.localFocusFeedback = undefined;
        if (this.failedSetupFocusAppId && this.failedSetupFocusAppId !== focused)
            this.failedSetupFocusAppId = undefined;
        const pending = this.pendingFocusCommit;
        if (pending && pending.appId !== focused && !localFeedback) {
            // The authoritative Attribute moved elsewhere (for example a
            // remote teacher superseded this local focusApp request). End the
            // waiter immediately instead of holding Native callers until the
            // 10-second watchdog.
            this.settlePendingFocusCommit(pending.appId, false);
        }
        if (this._prevFocused !== focused) {
            const previous = this._prevFocused;
            if (this.lazySetupEnabled) {
                // Attributes changes are also a focus request source
                // (manager.focusApp(), remote sync, reconnect). Record the
                // desired target before any queued blur can run, regardless
                // of whether TeleBox emits blur before or after focus.
                this.pendingLazyFocusAppId = focused;
                // Blur belongs to the authoritative state change, not to a
                // pending setup that may be replaced before it runs. In
                // particular A's in-flight release must be followed by freeze
                // even when B/C are skipped and the final intent only knows D.
                if (previous && !localFeedback)
                    void this.appProxies.get(previous)?.emitAppFocusEvent(false);
            }
            callbacks.emit("focusedChange", focused);
            internalEmitter.emit("focusedChange", { focused, prev: previous });
            this._prevFocused = focused;
            if (this.lazySetupEnabled) {
                const generation = ++this.lazyFocusGeneration;
                this.scheduleLazyIntent({ previous: localFeedback ? undefined : previous, focused, generation,
                    publishZIndex: localFeedback });
            } else if (!this.lazySetupEnabled && focused !== undefined) {
                void this.emitFocusedAppEvent(previous, focused);
                this.boxManager?.focusBox({ appId: focused });
                // 确保 focus 修改的时候, appProxy 已经创建
                setTimeout(() => {
                    const appProxy = this.appProxies.get(focused);
                    if (appProxy) {
                        appRegister.notifyApp(appProxy.kind, "focus", { appId: focused });
                    }
                }, 0);
            } else if (!this.lazySetupEnabled) {
                void this.emitFocusedAppEvent(previous, focused);
            }
        }
    }

    /**
     * Last-resort recovery scoped to one user-initiated TeleBox handoff. The
     * old box can emit `blurred` before the new box emits `focused`; if that
     * ordering leaves shared focus empty, or the target setup fails, recover
     * only after the lazy task settles. No other focus source may call this.
     */
    private restoreFocusAfterTeleBoxHandoff(failedAppId?: string): void {
        if (
            this.destroyed ||
            !this.lazySetupEnabled ||
            !this.windowManger.canOperate ||
            this.useBoxesStatus ||
            this.attributes.minimized ||
            this.boxManager?.maximized !== true ||
            this.pendingLazyFocusAppId !== undefined
        ) {
            return;
        }
        const currentFocus = this.store.focus;
        if (failedAppId && currentFocus && currentFocus !== failedAppId) {
            // Setup failed before the TeleBox handoff committed. The shared
            // Attribute still points at a valid app, so only realign the local
            // box; this is not a fallback and does not write shared state.
            void this.appProxies.get(currentFocus)?.emitAppFocusEvent?.(true);
            this.restoreLazyBoxFocus(currentFocus);
            return;
        }
        if (!failedAppId && currentFocus !== undefined) return;

        const topBox = this.boxManager.getTopBox(failedAppId);
        if (!topBox) return;
        this.Logger?.warn(
            `[WindowManager] TeleBox focus handoff ended without a usable target; restoring top app ${topBox.id}`
        );
        this.requestFocus(topBox.id);
    }

    private restoreLazyBoxFocus(appId: string): void {
        this.boxManager?.focusBox({ appId });
    }

    /**
     * Drop a not-yet-started queued setup of a superseded focus target.
     * State-based apps (Slide) catch up on demand when actually focused, so
     * the queued work is pure waste under rapid switching. The runner never
     * runs for a canceled task - its settingUpApps entry must be cleaned here,
     * otherwise the app could never be enqueued again.
     */
    private cancelQueuedSetup(appId: string): void {
        if (this.setupTaskQueue?.cancel(`setup:${appId}`)) {
            this.settingUpApps.delete(appId);
        }
    }

    private queueLazyFocusTransition(
        previous: string | undefined,
        focused: string | undefined,
        generation: number
    ): void {
        this.scheduleLazyIntent({ previous, focused, generation });
    }

    /** Internal TeleBox mainView request; the public focusApp API still requires a string. */
    public requestMainViewFocus(): void {
        this.initialFocusRecoveryPending = false;
        this.failedSetupFocusAppId = undefined;
        this.store.cleanFocus();
        // If mainView was already authoritative, there may be no Attribute
        // change callback to supersede a still-uncommitted TeleBox intent.
        if (
            this.lazySetupEnabled &&
            this.store.focus === undefined &&
            this.desiredLazyFocus?.focused !== undefined
        ) {
            this.queueLazyFocusTransition(undefined, undefined, ++this.lazyFocusGeneration);
        }
    }

    private reportLazySetupFailure(appId: string, error: unknown): void {
        const message = `[WindowManager] lazy setup failed for ${appId}: ${error}`;
        if (error instanceof Error && error.name === "AppSetupTimeoutError") {
            this.Logger?.warn(message);
        } else {
            this.Logger?.error(message);
        }
    }

    private async runLazyIntent(intent: LazyFocusIntent): Promise<void> {
        if (intent.focused && this.closingAppPromises?.size) {
            await Promise.all(
                Array.from(this.closingAppPromises.values(), close => close.catch(() => undefined))
            );
        }
        const { previous, focused, generation } = intent;
        const activity = this.activityRevision;
        const valid = () =>
            !this.destroyed &&
            this.lazySetupEnabled &&
            generation === this.lazyFocusGeneration &&
            activity === this.activityRevision &&
            this.canRunLazyIntent(intent);
        let failed = false;
        let failedFocusCommitted = false;
        try {
            if (previous && previous !== focused && (valid() || this.store.focus !== previous)) {
                await this.appProxies.get(previous)?.emitAppFocusEvent?.(false);
            }
            if (!valid()) {
                if (focused && focused !== this.store.focus) this.cancelQueuedSetup(focused);
                return;
            }
            if (focused === undefined) {
                if (this.store.focus !== undefined) return;
                // Attribute focus/blur has already made the mainView authoritative.
                // Complete the same pending flow without setting up a fake App.
                this.activeLazyAppId = undefined;
                this.suppressLazyBlur = true;
                try {
                    this.boxManager?.blurAllBox();
                } finally {
                    this.suppressLazyBlur = false;
                }
                return;
            }
            if (intent.localOnly) {
                if (this.store.focus !== intent.previous) return;
                failed = (await this.ensureLazyFocus(focused, generation, true, intent.previous)) === false;
                return;
            }
            if (intent.commitAfterSetup) {
                await this.minimizedCleanup;
                await this.runtimeCleanups?.get(focused);
                if (!valid()) return;
                const proxy = this.appProxies.get(focused);
                const targetAlive = () =>
                    this.appProxies.get(focused) === proxy &&
                    !proxy?.isDestroyed &&
                    Boolean(this.attributes.apps?.[focused]);
                if (!proxy || !targetAlive()) {
                    failed = true;
                    return;
                }
                await this.evictBeforeSetup(focused);
                if (!valid() || !targetAlive()) return;
                if (!proxy.isSetup) {
                    try {
                        await this.enqueueAppSetup(focused, () => -1);
                    } catch (error) {
                        if (!valid() || !targetAlive()) return;
                        this.reportLazySetupFailure(focused, error);
                        this.failedSetupFocusAppId = focused;
                    }
                }
                if (!valid() || !targetAlive()) return;
                if (this.store.focus !== focused) {
                    if (!this.windowManger.canOperate || !targetAlive()) return;
                    this.localFocusFeedback = focused;
                    try {
                        this.windowManger.safeSetAttributes({ focus: focused });
                    } catch (error) {
                        this.localFocusFeedback = undefined;
                        throw error;
                    }
                    callbacks.emit("onBoxFocus", { appId: focused });
                    // The Attribute feedback owns the commit on this client.
                    return;
                }
            }
            if (this.store.focus !== focused) return;
            failed = (await this.ensureLazyFocus(focused, generation, false, undefined,
                Boolean(intent.commitAfterSetup || intent.publishZIndex))) === false;
        } catch (error) {
            failed = true;
            this.Logger?.error(`[WindowManager] lazy focus failed for ${focused}: ${error}`);
        } finally {
            if (valid()) {
                this.pendingLazyFocusAppId = undefined;
                this.pendingLazyBlurredAppId = undefined;
                if (
                    failed && focused && !failedFocusCommitted &&
                    (intent.localOnly ? this.store.focus === intent.previous : this.store.focus === focused)
                ) {
                    const proxy = this.appProxies.get(focused);
                    if (proxy && !proxy.isDestroyed && this.attributes.apps?.[focused] &&
                        this.boxManager?.getBox(focused)) {
                        this.commitLazyBoxFocus(focused, proxy, Boolean(intent.commitAfterSetup));
                        this.failedSetupFocusAppId = focused;
                        this.settlePendingFocusCommit(focused, this.store.focus === focused, generation);
                        if (!intent.localOnly && this.desiredLazyFocus?.generation === generation)
                            this.desiredLazyFocus = undefined;
                        failedFocusCommitted = true;
                    }
                }
                if (failed && focused && !failedFocusCommitted) {
                    this.restoreFocusAfterLazySetupFailure(
                        focused,
                        previous,
                        generation,
                        intent.fallback
                    );
                    this.settlePendingFocusCommit(focused, false, generation);
                }
                if (intent.fallback && !failedFocusCommitted)
                    this.restoreFocusAfterTeleBoxHandoff(failed ? focused : undefined);
            }
        }
    }

    /**
     * Authoritative per-app `focus` boolean, driven by the attributes.focus
     * autorun. Unlike the telebox Focused/Blurred chain this works for
     * programmatic/remote focus changes and on readonly clients and Players.
     */
    private async emitFocusedAppEvent(
        prev: string | undefined,
        next: string | undefined
    ): Promise<void> {
        if (prev === next) return;
        if (prev) {
            await this.appProxies.get(prev)?.emitAppFocusEvent(false);
        }
        if (next) {
            await this.appProxies.get(next)?.emitAppFocusEvent(true);
        }
    }

    private async ensureLazyFocus(
        focused: string,
        generation: number,
        localOnly = false,
        localFocusSource?: string,
        publishZIndex = false
    ): Promise<boolean> {
        const activity = this.activityRevision;
        const valid = () =>
            !this.destroyed &&
            this.lazySetupEnabled &&
            this.canRunLazyTarget(focused) &&
            activity === this.activityRevision &&
            generation === this.lazyFocusGeneration &&
            (this.store.focus === focused || (localOnly && this.store.focus === localFocusSource));
        if (!valid()) return false;
        await this.minimizedCleanup;
        await this.runtimeCleanups?.get(focused);
        if (!valid()) return false;
        if (generation !== this.lazyFocusGeneration ||
            (this.store.focus !== focused && (!localOnly || this.store.focus !== localFocusSource)))
            return false;
        let appProxy = this.appProxies.get(focused);
        for (let i = 0; !appProxy && i < 100; i += 1) {
            await new Promise(resolve => setTimeout(resolve, 20));
            if (!valid()) return false;
            appProxy = this.appProxies.get(focused);
        }
        if (!appProxy) {
            this.Logger?.warn(
                `[WindowManager] lazy focus app proxy unavailable after 2000ms, appId: ${focused}`
            );
            return false;
        }
        // Cache hit = the focused app has a READY runtime in the LRU cache
        // (not "it was the previously active app": with cacheMax > 1 any
        // cached app must re-focus without re-setup).
        const cachedEntry = this.runtimeCache.get(focused);
        const isCacheHit =
            !!cachedEntry && cachedEntry.state === "ready" && this.appProxies.get(focused)?.isSetup;
        let setupFailed = this.failedSetupFocusAppId === focused && !appProxy.isSetup;
        if (!isCacheHit && !setupFailed) {
            // Cache miss: make room first (the visible app is never evicted
            // here; cache=1 defers its teardown until after focus commit),
            // then initialize only if needed. A Slide evicted from the LRU
            // still has a valid runtime and only needs cache registration.
            await this.evictBeforeSetup(focused);
            if (!valid() || this.appProxies.get(focused) !== appProxy) return false;
            if (appProxy.isSetup) {
                this.touchRuntime(focused);
            } else {
                try {
                    await this.enqueueAppSetup(focused, () => -1);
                } catch (error) {
                    if (!valid() || this.appProxies.get(focused) !== appProxy) return false;
                    this.reportLazySetupFailure(focused, error);
                    this.failedSetupFocusAppId = focused;
                    setupFailed = true;
                }
            }
        } else {
            if (isCacheHit) this.touchRuntime(focused);
        }
        if (!valid() || appProxy.isDestroyed || this.appProxies.get(focused) !== appProxy) {
            // Stale focus result, or the room entered minimized while the
            // setup was queued (teardown-all owns the runtimes then): keep
            // any valid runtime cached and skip the focus commit.
            return false;
        }
        if (!setupFailed) {
            const activitySucceeded = await appProxy.emitAppActivityEvent?.();
            if (activitySucceeded === false && valid())
                this.Logger?.error(`[WindowManager] app activity notification failed, appId: ${focused}`);
            if (!valid()) return false;
            const focusEventSucceeded = await appProxy.emitAppFocusEvent(true);
            if (!focusEventSucceeded && valid())
                this.Logger?.error(`[WindowManager] app focus notification failed, appId: ${focused}`);
            if (!valid() || appProxy.isDestroyed || this.appProxies.get(focused) !== appProxy)
                return false;
            // setup/release may have advanced the Slide page while this target
            // was pending. Publish only the final target's per-App scene to Room.
            appProxy.setViewFocusScenePath?.();
            if (this.windowManger.canOperate) appProxy.setScenePath?.();
        }
        if (!valid()) return false;
        this.commitLazyBoxFocus(focused, appProxy, publishZIndex);
        if (!setupFailed) this.touchRuntime(focused);
        this.settlePendingFocusCommit(focused, this.store.focus === focused, generation);
        if (setupFailed) return true;
        await appRegister.notifyApp(appProxy.kind, "focus", { appId: focused });
        if (!valid()) return false;
        await this.evictAfterFocusCommit(focused);
        return true;
    }

    private commitLazyBoxFocus(focused: string, appProxy: AppProxy, publishZIndex = false): void {
        const reservedZIndex =
            this.pendingLazyZIndex?.appId === focused ? this.pendingLazyZIndex.base + 1 : undefined;
        const box = this.boxManager?.getBox(focused);
        const otherTopZIndex = this.boxManager?.getTopBox?.(focused)?.zIndex ?? 0;
        const commitZIndex =
            reservedZIndex === undefined
                ? undefined
                : Math.max(reservedZIndex, box?.zIndex ?? 0, otherTopZIndex + 1);
        appProxy.flushPendingZIndex?.(commitZIndex);
        if (box && commitZIndex !== undefined && box.zIndex < commitZIndex) {
            this.boxManager?.setZIndex(focused, commitZIndex);
        }
        if (box) (this.boxManager?.teleBoxManager as any).makeBoxTop(box, true);
        this.boxManager?.focusBox({ appId: focused });
        if (box && publishZIndex && this.windowManger.canOperate &&
            this.attributes.apps?.[focused]?.state?.zIndex !== box.zIndex) {
            this.store.updateAppState(focused, AppAttributes.ZIndex, box.zIndex);
        }
        this.activeLazyAppId = focused;
        if (this.pendingLazyZIndex?.appId === focused) this.pendingLazyZIndex = undefined;
        if (this.preparingLazyFocusAppId === focused) this.preparingLazyFocusAppId = undefined;
    }

    private restoreFocusAfterLazySetupFailure(
        failedAppId: string,
        previous: string | undefined,
        generation: number,
        allowFallback = false
    ): void {
        if (this.preparingLazyFocusAppId === failedAppId) this.preparingLazyFocusAppId = undefined;
        const currentFocus = this.store.focus;
        if (
            this.destroyed ||
            !this.lazySetupEnabled ||
            this.attributes.minimized ||
            generation !== this.lazyFocusGeneration ||
            (!allowFallback && currentFocus !== failedAppId && currentFocus !== previous)
        ) {
            return;
        }
        if (this.pendingLazyFocusAppId === failedAppId) {
            this.pendingLazyFocusAppId = undefined;
        }
        if (this.desiredLazyFocus?.focused === failedAppId) {
            this.desiredLazyFocus = undefined;
        }
        if (this.pendingLazyZIndex?.appId === failedAppId) this.reserveLazyZIndex(undefined);
        this.settlePendingFocusCommit(failedAppId, false);
        // A user-initiated TeleBox handoff owns its recovery in the enclosing
        // task's finally block. Deferring here guarantees that fallback runs
        // only after setup and all queued blur/focus work have settled.
        if (allowFallback && this.windowManger.canOperate) return;
        // Attribute-driven setup must never rewrite the authoritative focus,
        // even on a writable client. Local TeleBox state follows the current
        // Attribute without choosing a replacement target.
        if (currentFocus !== undefined) {
            // `skipUpdate=true` prevents this programmatic focus from
            // re-entering the active Box-focus request path and accidentally
            // gaining fallback authority.
            if (currentFocus === previous && currentFocus !== failedAppId) {
                void this.appProxies.get(currentFocus)?.emitAppFocusEvent?.(true);
            }
            this.restoreLazyBoxFocus(currentFocus);
        } else {
            this.boxManager?.blurAllBox();
        }
    }

    public async setupAllApps(): Promise<void> {
        const appIds = Array.from(this.appProxies.keys());
        // Setup failures are already logged inside AppProxy; the per-app
        // catch only keeps one failed app from failing the batch wait.
        await Promise.all(appIds.map(appId => this.enqueueAppSetup(appId).catch(() => undefined)));
    }

    public requestFocus(appId: string): void {
        if (this.lazySetupEnabled) {
            if (this.activeLazyAppId === appId && this.store.focus === appId &&
                !this.pendingLazyFocusAppId) return;
            if (this.failedSetupFocusAppId === appId) this.failedSetupFocusAppId = undefined;
            if (
                this.desiredLazyFocus?.focused === appId &&
                this.pendingLazyFocusAppId === appId
            ) return;
            this.scheduleLazyIntent({
                previous: this.store.focus,
                focused: appId,
                generation: ++this.lazyFocusGeneration,
                commitAfterSetup: true,
            });
            return;
        }
        // Capture before setAppFocus: the attributes autorun may run
        // synchronously on the write, flipping _prevFocused to appId. Using
        // the captured value keeps the steady-state re-focus branch from
        // misfiring on a real focus switch, where it would enqueue a
        // prev=undefined transition whose newer generation supersedes the
        // autorun's transition and drops the previous app's blur event.
        const prevBeforeWrite = this._prevFocused;
        if (this.lazySetupEnabled) {
            this.pendingLazyFocusAppId = appId;
        }
        this.store.setAppFocus(appId, true);
        if (this.lazySetupEnabled && prevBeforeWrite === appId) {
            const generation = ++this.lazyFocusGeneration;
            this.queueLazyFocusTransition(undefined, appId, generation);
        }
    }

    /** Resolves true when room focus and the local Box/zIndex commit, regardless of setup outcome. */
    public requestFocusAndWait(appId: string): Promise<boolean> {
        if (this.lazySetupEnabled && this.activeLazyAppId === appId &&
            this.store.focus === appId && !this.pendingLazyFocusAppId)
            return Promise.resolve(true);
        const previous = this.pendingFocusCommit;
        if (previous) {
            this.pendingFocusCommit = undefined;
            clearTimeout(previous.timer);
            previous.resolve(false);
        }
        return new Promise<boolean>(resolve => {
            const deadline = Date.now() + this.focusCommitWatchdogTimeout;
            const timer = setTimeout(() => {
                if (this.pendingFocusCommit === request) {
                    this.pendingFocusCommit = undefined;
                    this.Logger?.warn(
                        `[WindowManager] focus commit timeout, appId: ${appId}, generation: ${request.generation}`
                    );
                    resolve(false);
                }
            }, this.focusCommitWatchdogTimeout);
            const request = {
                appId,
                resolve,
                timer,
                deadline,
                generation: undefined as number | undefined,
            };
            this.pendingFocusCommit = request;
            this.requestFocus(appId);
            if (this.pendingFocusCommit === request) request.generation = this.lazyFocusGeneration;
            if (!this.canRunLazyTarget(appId)) this.settlePendingFocusCommit(appId, false);
        });
    }

    private settlePendingFocusCommit(appId: string, committed: boolean, generation?: number): void {
        const addedApp = this.pendingAddSetupWaiter;
        if (addedApp?.appId === appId) {
            if (committed && this.isAddedAppFocusCommitted(appId)) {
                this.pendingAddSetupWaiter = undefined;
                clearTimeout(addedApp.timer);
                addedApp.resolve();
            } else if (!committed) {
                this.rejectAddSetupWaiter(addedApp, new LazySetupWaitError("failed", appId));
            }
        }
        const pending = this.pendingFocusCommit;
        if (!pending || pending.appId !== appId) return;
        if (
            generation !== undefined &&
            pending.generation !== undefined &&
            pending.generation !== generation
        )
            return;
        this.pendingFocusCommit = undefined;
        clearTimeout(pending.timer);
        pending.resolve(
            committed && (pending.deadline === undefined || Date.now() < pending.deadline)
        );
    }

    public attributesUpdateCallback = debounce(
        (apps: any) => this._attributesUpdateCallback(apps),
        100
    );

    private _appIds: string[] = [];
    public notifyAppsChange(appIds: string[]): void {
        if (
            this._appIds.length !== appIds.length ||
            !this._appIds.every(id => appIds.includes(id))
        ) {
            this._appIds = appIds;
            callbacks.emit("appsChange", appIds);
        }
    }

    /**
     * 插件更新 attributes 时的回调
     *
     * @param {*} attributes
     * @memberof WindowManager
     */
    public async _attributesUpdateCallback(apps: any) {
        if (apps && WindowManager.container) {
            const appIds = Object.keys(apps);
            if (appIds.length === 0) {
                this.appCreateQueue.emitReady();
            }
            const appsWithCreatedAt = orderBy(
                appIds.map(appId => {
                    return {
                        id: appId,
                        createdAt: apps[appId].createdAt,
                    };
                }),
                "createdAt",
                "asc"
            );
            const orderedAppIds = appsWithCreatedAt.map(({ id }) => id);
            const focusedAppId = this.store.focus;
            const shouldPrioritizeFocusedApp =
                !this.useBoxesStatus &&
                this.attributes.maximized === true &&
                focusedAppId !== undefined &&
                orderedAppIds.includes(focusedAppId);
            const creationOrder = shouldPrioritizeFocusedApp
                ? [focusedAppId, ...orderedAppIds.filter(id => id !== focusedAppId)]
                : orderedAppIds;
            this.notifyAppsChange(orderedAppIds);
            const pendingAppIds = this.pendingAppIds || new Set<string>();
            for (const id of creationOrder) {
                if (!this.appProxies.has(id) && !this.appStatus.has(id) && !pendingAppIds.has(id)) {
                    const app = apps[id];
                    try {
                        pendingAppIds.add(id);
                        const appAttributes = this.attributes[id];
                        if (!appAttributes) {
                            this.Logger &&
                                this.Logger.error(
                                    `[WindowManager]: appAttributes is undefined, appId: ${id}`
                                );
                            throw new Error("appAttributes is undefined");
                        }

                        this.appCreateQueue.push<AppProxy>(async () => {
                            // closeApp can cancel a descriptor before its Proxy exists.
                            // Remote deletion also invalidates queued creation.
                            if (
                                !pendingAppIds.delete(id) ||
                                this.destroyed ||
                                !this.attributes.apps?.[id]
                            ) {
                                return;
                            }
                            this.appStatus.set(id, AppStatus.StartCreate);
                            const appProxy = await this.baseInsertApp(
                                {
                                    kind: app.kind,
                                    options: app.options,
                                    isDynamicPPT: app.isDynamicPPT,
                                    forceNormal: app.forceNormal,
                                    forceTop: app.forceTop,
                                    isDragContent: app.isDragContent,
                                    lazySetup: this.lazySetupEnabled,
                                },
                                id,
                                false
                            );
                            if (
                                appProxy &&
                                this._focusAppId === id &&
                                this._focusAppCreatedResolve
                            ) {
                                if (this._resolveTimer) {
                                    clearTimeout(this._resolveTimer);
                                }
                                this._focusAppCreatedResolve(appProxy);
                            }
                            return appProxy;
                        });
                        this.focusByAttributes(apps);
                    } catch (error) {
                        pendingAppIds.delete(id);
                        console.warn(`[WindowManager]: Insert App Error`, error);
                    }
                }
            }
            if (this.lazySetupEnabled) {
                setTimeout(() => this.focusByAttributes(this.attributes.apps), 100);
            }
        }
    }

    private onRegisteredChange = (registered: Record<string, SyncRegisterAppPayload>) => {
        if (!registered) return;
        Object.entries(registered).forEach(([kind, payload]) => {
            if (!appRegister.appClasses.has(kind)) {
                appRegister.register({
                    kind,
                    src: payload.src,
                    name: payload.name,
                });
            }
        });
    };

    private onMinimized = (minimized: boolean | undefined) => {
        this.minimizedRevision = (this.minimizedRevision ?? 0) + 1;
        if (!minimized && this.windowManger.forceMaximized && !this.attributes.maximized) {
            this.Logger?.warn(
                "[WindowManager] ignored remote unminimize to normal while forceMaximized is enabled"
            );
            this.refreshLazyActivity();
            return;
        }
        if (minimized === true && this.lazySetupEnabled) {
            // Drop the cache through the serial queue. Slide keeps its runtime
            // and handles freezing through its existing lifecycle listeners.
            // Fire-and-forget: queue rejection (destroy clear) must not
            // become an unhandled rejection.
            this.minimizedCleanup = this.teardownAllRuntimeCaches().catch(error => {
                this.Logger?.warn(`[WindowManager] minimized cleanup failed: ${error}`);
            });
        }
        if (this.boxManager?.minimized !== minimized) {
            if (minimized === true) {
                this.suppressLazyBlur = true;
                try {
                    this.boxManager?.blurAllBox();
                } finally {
                    this.suppressLazyBlur = false;
                }
            }
            if (this.lazySetupEnabled) {
                // Apps must observe the restored local box state before their
                // completion is accepted as successful resource activation.
                this.boxManager?.setMinimized(Boolean(minimized));
            } else {
                setTimeout(() => {
                    this.boxManager?.setMinimized(Boolean(minimized));
                }, 0);
            }
        }
        this.refreshLazyActivity();
    };

    public refresh() {
        this.attributesUpdateCallback(this.attributes.apps);
    }

    public setBoxManager(boxManager: BoxManager) {
        this.boxManager = boxManager;
    }

    public resetMaximized() {
        this.boxManager?.setMaximized(Boolean(this.store.getMaximized()));
    }

    public resetMinimized() {
        this.boxManager?.setMinimized(Boolean(this.store.getMinimized()));
    }

    private onAppDelete = async (apps: any) => {
        const ids = Object.keys(apps);
        for (const [id, appProxy] of this.appProxies.entries()) {
            if (!ids.includes(id)) {
                await appProxy.destroy(true, false, true);
            }
        }
    };

    private closeAll = async () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for (const [_, appProxy] of this.appProxies.entries()) {
            await appProxy.destroy(true, false, true);
        }
    };

    public bindMainView(divElement: HTMLDivElement, disableCameraTransform: boolean) {
        const mainView = this.mainViewProxy.view;
        mainView.disableCameraTransform = disableCameraTransform;
        mainView.divElement = divElement;
        if (!mainView.focusScenePath) {
            this.setMainViewFocusPath();
        }
        internalEmitter.emit("mainViewMounted");
        callbacks.emit("onMainViewMounted", mainView);
        const hasRoot = this.hasRoot(mainView.divElement);
        const rect = this.getRectByDivElement(mainView.divElement);
        let log = `[window-manager] bindMainView hasRoot:${hasRoot}, rect:${JSON.stringify(
            rect
        )}, outerHeight:${window.outerHeight}, outerWidth:${window.outerWidth}`;
        const visualViewport = window.visualViewport;
        if (visualViewport) {
            log += `, visualViewportWidth:${visualViewport.width}, visualViewportHeight:${visualViewport.height}, visualViewportOffsetLeft:${visualViewport.offsetLeft}, visualViewportOffsetTop:${visualViewport.offsetTop}`;
        }
        console.log(log);
    }

    private hasRoot(divElement: HTMLDivElement) {
        let current = divElement;
        while (current) {
            if (current.parentElement === document.body) {
                return true;
            }
            current = current.parentElement as HTMLDivElement;
        }
        return false;
    }

    private getRectByDivElement(divElement: HTMLDivElement) {
        // 获取当前divElement的矩形区域
        const rect = divElement.getBoundingClientRect();
        return rect;
    }

    public setMainViewFocusPath(scenePath?: string) {
        const focusScenePath = scenePath || this.store.getMainViewScenePath();
        if (focusScenePath) {
            try {
                setViewFocusScenePath(this.mainView, focusScenePath);
                return this.mainView?.focusScenePath === focusScenePath;
            } catch (error) {
                const cause = error instanceof Error ? error : new Error(String(error));
                this.Logger?.error(
                    `[WindowManager]: set main view focus scene path failed, ` +
                        `focusScenePath: ${focusScenePath}, ` +
                        `didRelease: ${Boolean((this.mainView as any).didRelease)}, ` +
                        `error: ${cause.message}, stack: ${cause.stack || ""}`
                );
                return false;
            }
        }
    }

    private resetScenePath(scenePath: string) {
        const sceneState = this.displayer.state.sceneState;
        if (sceneState.scenePath !== scenePath) {
            setScenePath(this.room, scenePath);
        }
    }

    public async addApp(params: AddAppParams, isDynamicPPT: boolean): Promise<string | undefined> {
        log("addApp", params);
        this.windowManger.Logger?.info(
            `[WindowManager]: addApp ${params.kind}, isDynamicPPT: ${isDynamicPPT}`
        );
        const { appId, needFocus } = await this.beforeAddApp(params, isDynamicPPT);
        // Attribute/focus observers can close the app before its Proxy exists.
        if (this.destroyed || !this.attributes.apps?.[appId]) {
            this.appStatus.delete(appId);
            return;
        }
        const appProxy = await this.baseInsertApp(
            { ...params, lazySetup: this.lazySetupEnabled },
            appId,
            true,
            needFocus
        );
        if (!appProxy) {
            this.windowManger.Logger?.warn(
                `[WindowManager]: addApp returned no app for ${params.kind}, appId: ${appId}`
            );
        }
        this.afterAddApp(appProxy);
        if (appProxy && needFocus && this.lazySetupEnabled) {
            this.requestFocus(appProxy.id);
            try {
                await this.waitForLazyAddedAppSetup(appProxy.id, appProxy);
            } catch (error) {
                if (error instanceof LazySetupWaitError && error.reason === "superseded")
                    return appProxy.id;
                this.Logger?.error(`[WindowManager] addApp focus not committed, appId: ${appProxy.id}, error: ${error}`);
                return;
            }
        }
        return appProxy?.id;
    }

    private resolveEffectiveAppWindowFlags<T extends BaseInsertParams>(params: T): T {
        return this.useBoxesStatus
            ? params
            : ({ ...params, forceTop: undefined, forceNormal: undefined } as T);
    }

    private async beforeAddApp(params: AddAppParams, isDynamicPPT: boolean) {
        const appId = await genAppId(params.kind);
        this.appStatus.set(appId, AppStatus.StartCreate);
        const attrs = params.attributes ?? {};
        this.safeUpdateAttributes([appId], attrs);
        this.store.setupAppAttributes(params, appId, isDynamicPPT);
        const needFocus = !this.attributes.minimized && !this.boxManager?.minimized;
        if (needFocus && !this.lazySetupEnabled) {
            this.store.setAppFocus(appId, true);
        }
        return { appId, needFocus };
    }

    private afterAddApp(appProxy: AppProxy | undefined) {
        if (appProxy && appProxy.box) {
            const box = appProxy.box;
            boxEmitter.emit("move", {
                appId: appProxy.id,
                x: box?.intrinsicX,
                y: box?.intrinsicY,
            });
            this.store.updateAppState(appProxy.id, AppAttributes.ZIndex, box.zIndex);
        }
        if (this.boxManager?.minimized && !this.lazySetupEnabled) {
            this.boxManager?.setMinimized(false, false);
        }
    }

    public closeApp(appId: string, needClose = true, boxAlreadyRemoved = false): Promise<void> {
        const operations = this.closingAppOperations ??= new Map();
        const existing = operations.get(appId);
        if (existing) return existing;
        const closing = this.finishCloseApp(appId, needClose, boxAlreadyRemoved);
        operations.set(appId, closing);
        void closing.then(
            () => { if (operations.get(appId) === closing) operations.delete(appId); },
            () => { if (operations.get(appId) === closing) operations.delete(appId); }
        );
        return closing;
    }

    private async finishCloseApp(appId: string, needClose: boolean, boxAlreadyRemoved: boolean) {
        this.pendingAppIds.delete(appId);
        const appProxy = this.appProxies.get(appId);
        const close = needClose && this.attributes.apps?.[appId]
            ? this.captureAppClose(appId)
            : undefined;
        if (appProxy) {
            await appProxy.destroy(!boxAlreadyRemoved, needClose, boxAlreadyRemoved);
        } else {
            // Lazy descriptors already exist in room attributes even if their
            // creation task has not run. Closing them must still synchronize.
            const app = this.attributes.apps?.[appId];
            if (needClose && app) {
                this.notifyAppDestroyed(appId);
                const successor = close?.wasFocused ? this.getCloseSuccessor(appId) : undefined;
                this.store.cleanAppAttributes(appId, Boolean(successor));
                if (app.options?.scenePath) {
                    removeScenes(this.room, app.options.scenePath);
                }
            }
            this.appStatus.delete(appId);
        }
        if (close) await this.finishAppClose(appId, close);
    }

    private async baseInsertApp(
        params: BaseInsertParams,
        appId: string,
        isAddApp: boolean,
        focus?: boolean
    ) {
        const effectiveParams = this.resolveEffectiveAppWindowFlags(params);
        if (this.appProxies.has(appId)) {
            this.windowManger.Logger?.warn(
                `[WindowManager]: app duplicate exists and cannot be created again, appId: ${appId}`
            );
            return;
        }
        const AppProxyClass = getExtendClass(AppProxy, WindowManager.extendClass);
        const appProxy = new AppProxyClass(effectiveParams, this, appId, isAddApp);
        if (appProxy) {
            try {
                await appProxy.baseInsertApp(focus);
                this.appStatus.delete(appId);
                return appProxy;
            } catch (error) {
                this.appStatus.delete(appId);
                if (this.appProxies.get(appId) === appProxy) {
                    await appProxy.destroy(
                        true,
                        false,
                        true,
                        error instanceof Error ? error : new Error(String(error))
                    );
                }
                throw error;
            }
        } else {
            this.appStatus.delete(appId);
            this.Logger &&
                this.Logger.error(`[WindowManager]: initialize AppProxy failed, appId: ${appId}`);
            throw new Error("[WindowManger]: initialize AppProxy failed");
        }
    }

    private displayerStateListener = (state: Partial<RoomState>) => {
        this.appProxies.forEach(appProxy => {
            appProxy.appEmitter.emit("roomStateChange", state);
        });
        internalEmitter.emit("observerIdChange", this.displayer.observerId);
    };

    public displayerWritableListener = (isReadonly: boolean) => {
        const isWritable = !isReadonly;
        const isManualWritable =
            this.windowManger.readonly === undefined || this.windowManger.readonly === false;
        if (this.windowManger.readonly === undefined) {
            this.boxManager?.setReadonly(isReadonly);
        } else {
            this.boxManager?.setReadonly(!(isWritable && isManualWritable));
        }
        this.appProxies.forEach(appProxy => {
            appProxy.emitAppIsWritableChange();
        });
        internalEmitter.emit("writableChange", isWritable);
    };

    public safeSetAttributes(attributes: any) {
        this.windowManger.safeSetAttributes(attributes);
    }

    public safeUpdateAttributes(keys: string[], value: any) {
        this.windowManger.safeUpdateAttributes(keys, value);
    }

    public async setMainViewScenePath(scenePath: string) {
        if (this.room) {
            const scenePathType = this.displayer.scenePathType(scenePath);
            const sceneDir = parseSceneDir(scenePath);
            if (sceneDir !== ROOT_DIR) {
                this.Logger &&
                    this.Logger.error(`[WindowManager]: main view scenePath must in root dir "/"`);
                throw new Error(`[WindowManager]: main view scenePath must in root dir "/"`);
            }
            if (scenePathType === ScenePathType.None) {
                this.Logger && this.Logger.error(`[WindowManager]: ${scenePath} not valid scene`);
                throw new Error(`[WindowManager]: ${scenePath} not valid scene`);
            } else if (scenePathType === ScenePathType.Page) {
                await this._setMainViewScenePath(scenePath);
            } else if (scenePathType === ScenePathType.Dir) {
                const validScenePath = makeValidScenePath(this.displayer, scenePath);
                if (validScenePath) {
                    await this._setMainViewScenePath(validScenePath);
                }
            }
        }
    }

    private async _setMainViewScenePath(scenePath: string) {
        const success = this.setMainViewFocusPath(scenePath);
        if (success) {
            this.safeSetAttributes({ _mainScenePath: scenePath });
            this.store.setMainViewFocusPath(this.mainView);
            this.updateSceneIndex();
            this.dispatchSetMainViewScenePath(scenePath);
        }
    }

    private updateSceneIndex = () => {
        const scenePath = this.store.getMainViewScenePath() as string;
        const sceneDir = parseSceneDir(scenePath);
        const scenes = entireScenes(this.displayer)[sceneDir];
        if (scenes.length) {
            // "/ppt3/1" -> "1"
            const pageName = scenePath.replace(sceneDir, "").replace("/", "");
            const index = scenes.findIndex(scene => scene.name === pageName);
            if (isInteger(index) && index >= 0) {
                this.safeSetAttributes({ _mainSceneIndex: index });
            }
        }
    };

    public async setMainViewSceneIndex(index: number) {
        if (this.room) {
            if (this.store.getMainViewSceneIndex() === index) return;
            const sceneName = this.callbacksNode?.scenes[index];
            const scenePath = `${ROOT_DIR}${sceneName}`;
            if (sceneName) {
                const success = this.setMainViewFocusPath(scenePath);
                if (success) {
                    this.store.setMainViewScenePath(scenePath);
                    this.store.setMainViewSceneIndex(index);
                    this.dispatchSetMainViewScenePath(scenePath);
                }
            } else {
                this.Logger && this.Logger.error(`[WindowManager]: ${index} not valid index`);
                throw new Error(`[WindowManager]: ${index} not valid index`);
            }
        }
    }

    private dispatchSetMainViewScenePath(scenePath: string): void {
        this.dispatchInternalEvent(Events.SetMainViewScenePath, { nextScenePath: scenePath });
        callbacks.emit("mainViewScenePathChange", scenePath);
        // 兼容 15 的 SDK, 需要 room 的当前 ScenePath
        setScenePath(this.room, scenePath);
    }

    public getAppInitPath(appId: string): string | undefined {
        const attrs = this.store.getAppAttributes(appId);
        if (attrs) {
            return attrs?.options?.scenePath;
        }
    }

    public safeDispatchMagixEvent(event: string, payload: any) {
        if (this.canOperate) {
            (this.displayer as Room).dispatchMagixEvent(event, payload);
        }
    }

    public focusByAttributes(apps: any) {
        if (apps && Object.keys(apps).length === this.boxManager?.boxSize) {
            const focusAppId = this.store.focus;
            if (focusAppId && apps[focusAppId]) {
                this.initialFocusRecoveryPending = false;
                if (this.lazySetupEnabled && !this.attributes.minimized) {
                    if (
                        this.activeLazyAppId === focusAppId &&
                        !this.appProxies.get(focusAppId)?.isSetup
                    ) return;
                    // App creation can reconcile the unchanged room focus while
                    // a local addApp/focusApp target is still preparing.
                    if (
                        this.desiredLazyFocus?.commitAfterSetup &&
                        this.desiredLazyFocus.focused !== focusAppId
                    ) {
                        return;
                    }
                    const generation = ++this.lazyFocusGeneration;
                    const previous =
                        this._prevFocused === focusAppId ? undefined : this._prevFocused;
                    this.queueLazyFocusTransition(previous, focusAppId, generation);
                } else if (!this.lazySetupEnabled) {
                    this.boxManager.focusBox({ appId: focusAppId });
                }
            } else if (
                this.initialFocusRecoveryPending &&
                this.lazySetupEnabled &&
                !this.attributes.minimized &&
                (this.attributes.forceMaximized === true || this.windowManger.forceMaximized) &&
                Object.keys(apps).length === this.initialFocusRecoveryAppIds.size &&
                Object.keys(apps).every(id => this.initialFocusRecoveryAppIds.has(id)) &&
                focusAppId === this.initialFocusRecoverySource &&
                !this.desiredLazyFocus?.focused
            ) {
                const target = Object.keys(apps).sort((a, b) => {
                    const left = Number(apps[a]?.state?.zIndex) || 0;
                    const right = Number(apps[b]?.state?.zIndex) || 0;
                    return right - left || (a < b ? -1 : a > b ? 1 : 0);
                })[0];
                if (!target || !this.boxManager?.getBox(target)) return;
                this.initialFocusRecoveryPending = false;
                if (this.windowManger.canOperate) {
                    this.requestFocus(target);
                } else {
                    this.scheduleLazyIntent({
                        previous: focusAppId,
                        focused: target,
                        generation: ++this.lazyFocusGeneration,
                        localOnly: true,
                    });
                }
            }
        }
    }

    public async onReconnected() {
        this.failedSetupFocusAppId = undefined;
        await this._attributesUpdateCallback(this.attributes.apps);
        const appProxies = Array.from(this.appProxies.values());
        this.mainViewProxy.onReconnect();
        // Rebuild (and, in eager mode, re-setup) apps strictly one by one.
        // The setup part is additionally serialized by the setup queue.
        for (const appProxy of appProxies) {
            try {
                await this.setupTaskQueue.push(
                    `reconnect:${appProxy.id}`,
                    () => this.computeSetupPriority(appProxy.id),
                    () => appProxy.onReconnected()
                );
            } catch (error) {
                this.Logger?.warn(`[WindowManager] reconnect failed for ${appProxy.id}: ${error}`);
            }
        }
        if (this.callbacksNode) {
            this.onSceneChange(this.callbacksNode);
        }
        if (this.lazySetupEnabled) {
            const focused = this.store.focus;
            if (focused && this.appProxies.has(focused) && !this.attributes.minimized) {
                const generation = ++this.lazyFocusGeneration;
                const previous = this._prevFocused === focused ? undefined : this._prevFocused;
                this.queueLazyFocusTransition(previous, focused, generation);
                await this.lazyFocusQueue;
            }
        } else {
            // Eager reconnect: onReconnected() hands real setups off through
            // a delayed enqueue; await the queue so this Promise resolves
            // only when every app actually finished app.setup().
            await this.setupAllApps();
        }
    }

    public notifyContainerRectUpdate(rect: TeleBoxRect) {
        this.appProxies.forEach(appProxy => {
            appProxy.appEmitter.emit("containerRectUpdate", rect);
        });
    }

    public updateRootDirRemoving = (removing: boolean) => {
        this.rootDirRemoving = removing;
    };

    public dispatchInternalEvent(event: Events, payload?: any) {
        this.safeDispatchMagixEvent(MagixEventName, {
            eventName: event,
            payload: payload,
        });
    }

    public destroy() {
        this.destroyed = true;
        if (this.pendingAddSetupWaiter) {
            const waiter = this.pendingAddSetupWaiter;
            this.rejectAddSetupWaiter(waiter, new LazySetupWaitError("destroyed", waiter.appId));
        }
        this.lazyScheduler?.dispose();
        this.desiredLazyFocus = undefined;
        this.preparingLazyFocusAppId = undefined;
        this.lazyFocusGeneration += 1;
        this.pendingLazyFocusAppId = undefined;
        this.pendingLazyBlurredAppId = undefined;
        if (this.pendingFocusCommit) {
            this.settlePendingFocusCommit(this.pendingFocusCommit.appId, false);
        }
        this.displayer.callbacks.off(this.eventName, this.displayerStateListener);
        this.displayer.callbacks.off("onEnableWriteNowChanged", this.displayerWritableListener);
        this.appListeners.removeListeners();
        boxEmitter.clearListeners();
        internalEmitter.clearListeners();
        this.settingUpApps.clear();
        this.runtimeCache.clear();
        this.activeLazyAppId = undefined;
        // Drop pending setup/teardown tasks; a running task finishes on its
        // own and its per-proxy guards (isDestroyed/aborted generation) keep
        // it from touching destroyed proxies.
        this.setupTaskQueue.clear();
        if (this.appProxies.size) {
            this.appProxies.forEach(appProxy => {
                appProxy.destroy(true, false, true);
            });
        }
        callbacks.clearListeners();
        this.sideEffectManager.flushAll();
        this._prevFocused = undefined;
        this._prevSceneIndex = undefined;
        if (this._resolveTimer) {
            clearTimeout(this._resolveTimer);
        }
        this._focusAppCreatedResolve = undefined;
        this._resolveTimer = undefined;
    }
}
