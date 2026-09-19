import { AppAttributes, AppStatus, Events, INIT_DIR, MagixEventName, ROOT_DIR } from "./constants";
import { AppCreateQueue } from "./Utils/AppCreateQueue";
import { SetupQueue } from "./Utils/SetupQueue";
import { AppListeners } from "./AppListener";
import { AppProxy } from "./App";
import type { AppBoxSizeSyncOptions } from "./App/AppBoxSizeSynchronizer";
import { appRegister } from "./Register";
import { autorun, isPlayer, isRoom, ScenePathType, UpdateEventKind } from "white-web-sdk";
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
    BoxFocusPayload,
    BoxMovePayload,
    BoxResizePayload,
    BoxStateChangePayload,
} from "./BoxEmitter";
import { getExtendClass } from "./Utils/extendClass";
import type { TeleBoxState } from "@netless/telebox-insider";

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
    // Serial queue for real app.setup() execution. AppCreateQueue only serializes
    // AppProxy/Box creation; this queue waits until each setup actually finishes.
    private setupTaskQueue = new SetupQueue();
    // LRU cache of set-up app runtimes (lazy mode only). Insertion order is
    // irrelevant; `lastUsed` drives eviction. It is a monotonic access
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
    // Mark apps as soon as their creation task is queued. appStatus is set only
    // when the queue starts a task, which is too late to prevent duplicate tasks
    // during slow module loading.
    private pendingAppIds = new Set<string>();
    // Keep the shared focus on the previous ready App while a local lazy focus is preparing.
    private pendingLazyBlurredAppId?: string;

    private sideEffectManager = new SideEffectManager();

    public sceneState: SceneState | null = null;

    public rootDirRemoving = false;

    private get lazySetupEnabled(): boolean {
        return Boolean(this.windowManger?.lazySetupInMaximizedMode);
    }

    private get maxCachedApps(): number {
        return this.windowManger?.maxCachedAppsInMaximizedMode ?? 1;
    }

    /**
     * Enqueue a real app setup into the serial setup queue. The queued task
     * waits until `app.setup()` finishes before the next task starts.
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
                // Observability for the serial-setup contract (design §19
                // case 13): started tasks never overlap, and the log makes
                // each app's setup window explicit.
                const startedAt = Date.now();
                this.Logger?.info(`[WindowManager] app setup start, appId: ${appId}`);
                try {
                    await appProxy.ensureSetup();
                    this.Logger?.info(
                        `[WindowManager] app setup done, appId: ${appId}, duration: ${
                            Date.now() - startedAt
                        }ms`
                    );
                    if (this.lazySetupEnabled) {
                        const entry = this.runtimeCache.get(appId);
                        if (entry && entry.state !== "tearing-down") {
                            entry.state = "ready";
                            entry.lastUsed = this.nextLru();
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
                    if (this.lazySetupEnabled) {
                        // A failed setup does not occupy a cache slot.
                        this.runtimeCache.delete(appId);
                    }
                    throw error;
                } finally {
                    this.settingUpApps.delete(appId);
                }
            }
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
     * Batch ordering key for pending setup tasks: forceTop apps first
     * (they are the visible top in a maximized workspace, design §7.3 /
     * test §19.32), then the focused app, then by zIndex descending, then
     * creation order.
     */
    private computeSetupPriority(appId: string): number {
        const appAttrs = this.attributes.apps?.[appId];
        if (appAttrs?.forceTop) {
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

    private pickRuntimeEvictionCandidate(exclude: Set<string>): string | undefined {
        let candidate: string | undefined;
        let oldest = Infinity;
        this.runtimeCache.forEach((entry, id) => {
            // Apps without a teardown implementation keep their runtime alive
            // even when "evicted" (design §13): excluding them here prevents
            // zombie runtimes from accumulating beyond the cache capacity.
            if (entry.state !== "ready" || exclude.has(id)) return;
            if (!this.appProxies.get(id)?.canTeardown) return;
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
        if (proxy && !proxy.canTeardown) {
            // No teardown implementation: the runtime would stay alive while
            // the cache bookkeeping forgets it. Keep the entry so capacity
            // accounting stays truthful (design §13).
            this.Logger?.warn(
                `[WindowManager] app ${appId} has no teardown; keeping runtime and cache slot`
            );
            return;
        }
        entry.state = "tearing-down";
        await this.setupTaskQueue.push(
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
                    await appProxy?.teardown();
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
        this.runtimeCache.clear();
        this.activeLazyAppId = undefined;
    }

    /** Drop cache bookkeeping for an app whose proxy was destroyed. */
    public notifyAppDestroyed(appId: string): void {
        this.runtimeCache.delete(appId);
        this.settingUpApps.delete(appId);
        if (this.activeLazyAppId === appId) {
            this.activeLazyAppId = undefined;
        }
    }

    /** Tear down every cached runtime (entering minimized). */
    private teardownAllRuntimeCaches(): Promise<void> {
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
                if (!this.lazySetupEnabled) return;
                for (const id of ids) {
                    const entry = this.runtimeCache.get(id);
                    if (!entry || entry.state !== "ready") continue;
                    if (!this.appProxies.get(id)?.canTeardown) continue;
                    entry.state = "tearing-down";
                    const appProxy = this.appProxies.get(id);
                    try {
                        await appProxy?.teardown();
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
        if (Object.keys(this.attributes.apps).length && this.store.focus) {
            this._focusAppId = this.store.focus;
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
                if (!maximized && this.attributes.forceMaximized === true) {
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
                const focused = get(this.attributes, "focus");
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
        this._prevFocused = this.attributes.focus;

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

    private onBoxFocus = (payload: BoxFocusPayload) => {
        if (this.lazySetupEnabled && !this.appProxies.get(payload.appId)?.isSetup) {
            this.pendingLazyBlurredAppId = this.attributes.focus;
            this.boxManager?.blurAllBox();
            const generation = ++this.lazyFocusGeneration;
            this.lazyFocusQueue = this.lazyFocusQueue
                .catch(() => undefined)
                .then(async () => {
                    try {
                        const appProxy = this.appProxies.get(payload.appId);
                        if (!appProxy) return;
                        try {
                            await this.enqueueAppSetup(payload.appId, () => -1);
                        } catch (error) {
                            this.Logger?.warn(
                                `[WindowManager] lazy setup failed for ${payload.appId}: ${error}`
                            );
                            return;
                        }
                        if (generation !== this.lazyFocusGeneration) return;
                        this.windowManger.safeSetAttributes({ focus: payload.appId });
                        callbacks.emit("onBoxFocus", payload);
                        // The focused attributes autorun re-enters
                        // `ensureLazyFocus`, which touches the runtime cache and
                        // evicts LRU runtimes beyond the configured capacity.
                    } finally {
                        if (generation === this.lazyFocusGeneration) {
                            this.pendingLazyBlurredAppId = undefined;
                        }
                    }
                });
            return;
        }
        this.windowManger.safeSetAttributes({ focus: payload.appId });
        callbacks.emit("onBoxFocus", payload);
    };

    private onBoxBlurred = (payload: BoxBlurredPayload) => {
        const focus = this.attributes.focus;
        if (focus === payload.appId) {
            if (this.pendingLazyBlurredAppId === payload.appId) {
                this.pendingLazyBlurredAppId = undefined;
                return;
            }
            this.windowManger.safeSetAttributes({ focus: undefined });
            callbacks.emit("onBoxBlurred", payload);
        }
    };

    private onBoxClose = (payload: BoxClosePayload) => {
        const appProxy = this.appProxies.get(payload.appId);
        if (appProxy) {
            appProxy.destroy(false, true, true, payload.error);
        }
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
        if (this._prevFocused !== focused) {
            this.pendingLazyBlurredAppId = undefined;
            callbacks.emit("focusedChange", focused);
            internalEmitter.emit("focusedChange", { focused, prev: this._prevFocused });
            this.emitFocusedAppEvent(this._prevFocused, focused);
            this._prevFocused = focused;
            if (focused !== undefined && this.lazySetupEnabled && !this.attributes.minimized) {
                const generation = ++this.lazyFocusGeneration;
                this.lazyFocusQueue = this.lazyFocusQueue
                    .catch(() => undefined)
                    .then(() => this.ensureLazyFocus(focused, generation));
            } else if (focused !== undefined) {
                this.boxManager?.focusBox({ appId: focused });
                // 确保 focus 修改的时候, appProxy 已经创建
                setTimeout(() => {
                    const appProxy = this.appProxies.get(focused);
                    if (appProxy) {
                        appRegister.notifyApp(appProxy.kind, "focus", { appId: focused });
                    }
                }, 0);
            }
        }
    };

    /**
     * Authoritative per-app `focus` boolean, driven by the attributes.focus
     * autorun. Unlike the telebox Focused/Blurred chain this works for
     * programmatic/remote focus changes and on readonly clients and Players.
     */
    private emitFocusedAppEvent(prev: string | undefined, next: string | undefined): void {
        if (prev === next) return;
        if (prev) {
            this.appProxies.get(prev)?.emitAppFocusEvent(false);
        }
        if (next) {
            this.appProxies.get(next)?.emitAppFocusEvent(true);
        }
    }

    private async ensureLazyFocus(focused: string, generation: number): Promise<void> {
        if (this.attributes.minimized) return;
        let appProxy = this.appProxies.get(focused);
        for (let i = 0; !appProxy && i < 100; i += 1) {
            await new Promise(resolve => setTimeout(resolve, 20));
            appProxy = this.appProxies.get(focused);
        }
        if (!appProxy) {
            this.Logger?.warn(
                `[WindowManager] lazy focus app proxy unavailable after 2000ms, appId: ${focused}`
            );
            return;
        }
        // Cache hit = the focused app has a READY runtime in the LRU cache
        // (not "it was the previously active app": with cacheMax > 1 any
        // cached app must re-focus without re-setup).
        const cachedEntry = this.runtimeCache.get(focused);
        const isCacheHit =
            !!cachedEntry && cachedEntry.state === "ready" && this.appProxies.get(focused)?.isSetup;
        if (!isCacheHit) {
            // Cache miss: make room first (the visible app is never evicted
            // here; cache=1 defers its teardown until after focus commit),
            // then run the real setup inside the serial setup queue.
            try {
                await this.evictBeforeSetup(focused);
                await this.enqueueAppSetup(focused, () => -1);
            } catch (error) {
                this.Logger?.warn(`[WindowManager] lazy setup failed for ${focused}: ${error}`);
                return;
            }
        } else {
            this.touchRuntime(focused);
        }
        if (
            this.attributes.minimized ||
            generation !== this.lazyFocusGeneration ||
            this.store.focus !== focused
        ) {
            // Stale focus result, or the room entered minimized while the
            // setup was queued (teardown-all owns the runtimes then): keep
            // any valid runtime cached and skip the focus commit.
            return;
        }
        const box = this.boxManager?.getBox(focused);
        if (box) {
            (this.boxManager?.teleBoxManager as any).makeBoxTop(box, false);
        }
        this.boxManager?.focusBox({ appId: focused }, false);
        this.activeLazyAppId = focused;
        this.touchRuntime(focused);
        await appRegister.notifyApp(appProxy.kind, "focus", { appId: focused });
        await this.evictAfterFocusCommit(focused);
    }

    public async setupAllApps(): Promise<void> {
        const appIds = Array.from(this.appProxies.keys());
        // Setup failures are already logged inside AppProxy; the per-app
        // catch only keeps one failed app from failing the batch wait.
        await Promise.all(appIds.map(appId => this.enqueueAppSetup(appId).catch(() => undefined)));
    }

    public requestFocus(appId: string): void {
        this.store.setAppFocus(appId, true);
        if (this.lazySetupEnabled && this._prevFocused === appId) {
            const generation = ++this.lazyFocusGeneration;
            this.lazyFocusQueue = this.lazyFocusQueue
                .catch(() => undefined)
                .then(() => this.ensureLazyFocus(appId, generation));
        }
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
                            pendingAppIds.delete(id);
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
        if (!minimized && this.attributes.forceMaximized === true && !this.attributes.maximized) {
            this.Logger?.warn(
                "[WindowManager] ignored remote unminimize to normal while forceMaximized is enabled"
            );
            return;
        }
        if (minimized === true && this.lazySetupEnabled) {
            // Minimized keeps no heavy runtimes: release the whole cache
            // through the serial queue. Shells and LRU order are preserved.
            // Fire-and-forget: queue rejection (destroy clear) must not
            // become an unhandled rejection.
            this.teardownAllRuntimeCaches().catch(() => undefined);
        }
        if (this.boxManager?.minimized !== minimized) {
            if (minimized === true) {
                this.boxManager?.blurAllBox();
            }
            setTimeout(() => {
                this.boxManager?.setMinimized(Boolean(minimized));
            }, 0);
        }
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
        return appProxy?.id;
    }

    private async beforeAddApp(params: AddAppParams, isDynamicPPT: boolean) {
        const appId = await genAppId(params.kind);
        this.appStatus.set(appId, AppStatus.StartCreate);
        const attrs = params.attributes ?? {};
        this.safeUpdateAttributes([appId], attrs);
        this.store.setupAppAttributes(params, appId, isDynamicPPT);
        const needFocus = !this.boxManager?.minimized;
        if (needFocus) {
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

    public async closeApp(appId: string, needClose = true) {
        const appProxy = this.appProxies.get(appId);
        if (appProxy) {
            await appProxy.destroy(true, needClose, false);
        }
    }

    private async baseInsertApp(
        params: BaseInsertParams,
        appId: string,
        isAddApp: boolean,
        focus?: boolean
    ) {
        if (this.appProxies.has(appId)) {
            this.windowManger.Logger?.warn(
                `[WindowManager]: app duplicate exists and cannot be created again, appId: ${appId}`
            );
            return;
        }
        const AppProxyClass = getExtendClass(AppProxy, WindowManager.extendClass);
        const appProxy = new AppProxyClass(params, this, appId, isAddApp);
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
            if (focusAppId) {
                if (this.lazySetupEnabled && !this.attributes.minimized) {
                    const generation = ++this.lazyFocusGeneration;
                    this.lazyFocusQueue = this.lazyFocusQueue
                        .catch(() => undefined)
                        .then(() => this.ensureLazyFocus(focusAppId, generation));
                } else {
                    this.boxManager.focusBox({ appId: focusAppId });
                }
            }
        }
    }

    public async onReconnected() {
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
                await this.ensureLazyFocus(focused, generation);
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
