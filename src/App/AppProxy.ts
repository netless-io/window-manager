import Emittery from "emittery";
import { AppAttributes, AppEvents, Events, SETUP_APP_DELAY } from "../constants";
import { AppContext } from "./AppContext";
import { AppPageStateImpl } from "./AppPageStateImpl";
import { appRegister } from "../Register";
import { autorun } from "white-web-sdk";
import { BoxManagerNotFoundError } from "../Utils/error";
import { debounce, get } from "lodash";
import { internalEmitter } from "../InternalEmitter";
import { Fields } from "../AttributesDelegate";
import { log } from "../Utils/log";
import {
    entireScenes,
    getScenePath,
    removeScenes,
    setScenePath,
    setViewFocusScenePath,
} from "../Utils/Common";
import type {
    AppEmitterEvent,
    AppInitState,
    BaseInsertParams,
    setAppOptions,
    AppListenerKeys,
} from "../index";
import { WindowManager } from "../index";
import type { SceneState, View, SceneDefinition } from "white-web-sdk";
import type { AppManager } from "../AppManager";
import type { NetlessApp } from "../typings";
import { TELE_BOX_STATE } from "@netless/telebox-insider";
import type { ReadonlyTeleBox, TeleBoxState } from "@netless/telebox-insider";
import type { PageRemoveService, PageState } from "../Page";
import { calculateNextIndex } from "../Page";
import { boxEmitter } from "../BoxEmitter";
import { callbacks } from "../callback";
import { getExtendClass } from "../Utils/extendClass";
import { AppBoxSizeSynchronizer } from "./AppBoxSizeSynchronizer";
import type { AppBoxSizeSyncOptions } from "./AppBoxSizeSynchronizer";

const APP_SETUP_WATCHDOG_TIMEOUT = 10_000;
const APP_FOCUS_EVENT_WATCHDOG_TIMEOUT = 10_000;

type AppSetupCompletion = { succeeded: true; result: any } | { succeeded: false; error: unknown };

class AppTeardownFailure extends Error {}

export type AppEmitter = Emittery<AppEmitterEvent>;

export class AppProxy implements PageRemoveService {
    static readonly kind = "AppProxy";
    public kind: string;
    public id: string;
    public scenePath?: string;
    public appEmitter: AppEmitter;
    public scenes?: SceneDefinition[];

    private appListener: any;
    private boxManager = this.manager.boxManager;
    private appProxies = this.manager.appProxies;
    private viewManager = this.manager.viewManager;
    private store = this.manager.store;

    public isAddApp: boolean;
    private status: "normal" | "destroyed" = "normal";
    private stateKey: string;
    private _pageState: AppPageStateImpl;
    private _prevFullPath: string | undefined;
    private boxSizeSynchronizer: AppBoxSizeSynchronizer;
    private setupWatchdogTimer?: ReturnType<typeof setTimeout>;
    private teardownWatchdog?: { timer: ReturnType<typeof setTimeout>; startedAt: number };
    private setupCompletionPromise!: Promise<AppSetupCompletion>;
    private resolveSetupCompletion!: (completion: AppSetupCompletion) => void;
    private setupCompletionSettled = false;
    private setupAttemptStarted = false;
    private setupStarted = false;
    private setupSucceeded = false;
    private setupDescriptorReady?: Promise<void>;
    private resolveSetupDescriptorReady?: () => void;
    private setupInitializationError?: Error;
    private setupInitializationPromise?: Promise<void>;
    private resolveSetupInitialization?: () => void;
    private pendingZIndex?: number;
    private setupScopeAttached = false;
    private deferredSetup?: {
        app: NetlessApp;
        context: AppContext<any, any>;
        boxInitState?: AppInitState;
        currentMainViewScenePath?: string;
    };
    private setupDescriptor?: {
        app: NetlessApp;
        context: AppContext<any, any>;
        boxInitState?: AppInitState;
        currentMainViewScenePath?: string;
    };
    private setupResult: any;
    private appDefinition?: NetlessApp;
    private boxFocusOffHandlers: Array<() => void> = [];
    // Bumped on teardown/destroy. An in-flight setup compares its captured
    // generation afterwards and aborts instead of marking a released runtime
    // as ready (teardown-during-setup race).
    private setupRunGeneration = 0;
    private destroyPromise?: Promise<void>;
    private focusNotification?: {
        target: boolean;
        epoch: number;
        activity: number;
        completion: Promise<boolean>;
    };
    private contentPageState?: PageState;
    private contentPageStateActive = false;

    public appResult?: NetlessApp<any>;
    public appContext?: AppContext<any, any>;

    constructor(
        private params: BaseInsertParams,
        private manager: AppManager,
        appId: string,
        isAddApp: boolean
    ) {
        this.kind = params.kind;
        this.id = appId;
        this.resetSetupCompletion();
        this.stateKey = `${this.id}_state`;
        this.appProxies.set(this.id, this);
        this.appEmitter = new Emittery();
        this.boxSizeSynchronizer = new AppBoxSizeSynchronizer(
            this.id,
            () => this.view,
            () => this.view?.divElement || this.box?.$content,
            payload => {
                this.appEmitter.emit("boxSizeChange", payload).catch(error => {
                    this.Logger?.error(
                        `[WindowManager]: failed to notify app box size change: ${error}`
                    );
                });
            },
            error => {
                this.Logger?.error(`[WindowManager]: failed to refresh app view size: ${error}`);
            },
            () => this.box?.$content
        );
        this.appListener = this.makeAppEventListener(this.id);
        this.isAddApp = isAddApp;
        this.boxFocusOffHandlers = [
            boxEmitter.on("focus", ({ appId }) => {
                if (
                    appId === this.id &&
                    this.status !== "destroyed" &&
                    !this.manager.lazySetupEnabled
                ) {
                    void this.emitAppFocusEvent(true);
                }
            }),
            boxEmitter.on("blurred", ({ appId }) => {
                if (
                    appId === this.id &&
                    this.status !== "destroyed" &&
                    !this.manager.lazySetupEnabled
                ) {
                    void this.emitAppFocusEvent(false);
                }
            }),
        ];

        // The proxy is inserted before the async App factory and WindowCreated
        // notification complete. Lazy focus must wait for that lifecycle boundary.
        this.setupInitializationPromise = new Promise(resolve => {
            this.resolveSetupInitialization = resolve;
        });

        this.initScenes();

        if (this.params.options?.scenePath) {
            // 只有传入了 scenePath 的 App 才会创建 View
            this.createView();
        }
        this._pageState = new AppPageStateImpl({
            displayer: this.manager.displayer,
            scenePath: this.scenePath,
            view: this.view,
            notifyPageStateChange: this.notifyPageStateChange,
        });
    }

    private initScenes() {
        const options = this.params.options;
        if (options) {
            this.scenePath = options.scenePath;
            if (this.appAttributes?.isDynamicPPT && this.scenePath) {
                this.scenes = entireScenes(this.manager.displayer)[this.scenePath];
            } else {
                this.scenes = options.scenes;
            }
        }
    }

    public get view(): View | undefined {
        return this.manager.viewManager.getView(this.id);
    }

    public scheduleBoxSizeSync = (options?: AppBoxSizeSyncOptions): void => {
        if (this.status !== "destroyed") this.boxSizeSynchronizer.schedule(options);
    };

    public get viewIndex(): number | undefined {
        return this.view?.focusSceneIndex;
    }

    public get isWritable(): boolean {
        return this.manager.canOperate && !this.box?.readonly;
    }

    public get isSetup(): boolean {
        return this.setupSucceeded;
    }

    public get isDestroyed(): boolean {
        return this.status === "destroyed";
    }

    /** Whether this app implements the runtime teardown contract. Apps
     * without it can never be suspended (design §13): the manager keeps
     * their runtime (and cache slot) alive instead of evicting them. */
    public get canTeardown(): boolean {
        return !!(this.appDefinition && (this.appDefinition as NetlessApp).teardown);
    }

    /** Whether the room-level focus currently points to this app. */
    public get isFocused(): boolean {
        return this.store.focus === this.id;
    }

    /**
     * Emit the per-app `focus` boolean event. Sources: the attributes.focus
     * autorun (authoritative, works on readonly/Player clients too), box
     * focus/blur events (early local signal) and the setup-complete sync.
     * Change-duplicated emissions are deduped here; apps must still treat
     * the event as potentially repeated and handle it idempotently.
     */
    public emitAppFocusEvent(isFocused: boolean, force = false): Promise<boolean> {
        if (this.status === "destroyed") return Promise.resolve(false);
        const previous = this.focusNotification;
        const epoch = this.setupRunGeneration;
        const activity = this.manager.activityRevision ?? 0;
        if (
            !force &&
            previous?.target === isFocused &&
            previous.epoch === epoch &&
            previous.activity === activity
        ) {
            return previous.completion;
        }
        const record = { target: isFocused, epoch, activity, completion: Promise.resolve(false) };
        this.focusNotification = record;
        record.completion = this.notifyResourceEvent("focus", isFocused).then(succeeded => {
            if (!succeeded && this.focusNotification === record) {
                // Failure means unknown physical state, never the previous boolean.
                this.focusNotification = undefined;
            }
            return succeeded && this.setupRunGeneration === epoch && !this.isDestroyed;
        });
        return record.completion;
    }

    public emitAppActivityEvent(): Promise<boolean> {
        return this.notifyResourceEvent("runtimeActivity", {
            active: this.manager.canRunLazyTarget(this.id) && this.isFocused,
            revision: this.manager.activityRevision ?? 0,
        });
    }

    private notifyResourceEvent<K extends "focus" | "runtimeActivity">(
        event: K,
        payload: AppEmitterEvent[K]
    ): Promise<boolean> {
        if (this.isDestroyed) return Promise.resolve(false);
        let emission: Promise<void>;
        try {
            emission = this.appEmitter.emit(event, payload);
        } catch (error) {
            emission = Promise.reject(error);
        }
        return new Promise<boolean>(resolve => {
            let settled = false;
            const finish = (succeeded: boolean): void => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                resolve(succeeded);
            };
            const timeout = setTimeout(() => {
                this.Logger?.warn(
                    `[WindowManager]: ${event} event timeout, kind: ${this.kind}, appId: ${
                        this.id
                    }, epoch: ${this.setupRunGeneration}, activity: ${
                        this.manager.activityRevision ?? 0
                    }, timeout: ${APP_FOCUS_EVENT_WATCHDOG_TIMEOUT}ms`
                );
                finish(false);
            }, APP_FOCUS_EVENT_WATCHDOG_TIMEOUT);
            emission.then(
                () => finish(true),
                error => {
                    this.Logger?.warn(
                        `[WindowManager]: ${event} event rejected, kind: ${this.kind}, appId: ${this.id}, error: ${error}`
                    );
                    this.logPostSetupNotificationError(`${event} event`, error);
                    finish(false);
                }
            );
        });
    }

    public get attributes() {
        return this.manager.attributes[this.id];
    }

    public get appAttributes() {
        return this.store.getAppAttributes(this.id);
    }

    public get Logger() {
        return this.manager.windowManger.Logger;
    }

    public async waitForSetup(): Promise<any> {
        const completion = await this.setupCompletionPromise;
        if (!completion.succeeded) throw completion.error;
        return completion.result;
    }

    public getFullScenePath(): string | undefined {
        if (this.scenePath) {
            return get(this.appAttributes, [Fields.FullPath]) || this.getFullScenePathFromScenes();
        }
    }

    private getFullScenePathFromScenes() {
        const sceneIndex = get(this.appAttributes, ["state", "SceneIndex"], 0);
        const fullPath = getScenePath(this.manager.room, this.scenePath, sceneIndex);
        if (fullPath) {
            this.setFullPath(fullPath);
        }
        return fullPath;
    }

    public setFullPath(path: string) {
        this.manager.safeUpdateAttributes(["apps", this.id, Fields.FullPath], path);
    }

    public async baseInsertApp(
        skipUpdate = false,
        boxStatus: TeleBoxState = TELE_BOX_STATE.Normal
    ): Promise<{ appId: string; app: NetlessApp }> {
        const params = this.params;
        if (!params.kind) {
            this.Logger && this.Logger.error(`[WindowManager]: kind require`);
            throw new Error("[WindowManager]: kind require");
        }
        try {
            const appImpl = await appRegister.appClasses.get(params.kind)?.();
            this.throwIfDestroyed();
            const appParams = appRegister.registered.get(params.kind);
            const appOptions = this.manager.windowManger.resolveAppOptions(
                params.kind,
                appParams?.appOptions
            );
            if (appImpl) {
                // setupApp installs setupDescriptorReady synchronously before its
                // first await, so resolve only after that lifecycle has started.
                const setupPromise = this.setupApp(
                    this.id,
                    skipUpdate,
                    appImpl,
                    params.options,
                    appOptions,
                    this.manager.useBoxesStatus ? boxStatus : undefined,
                    params.forceTop,
                    params.forceNormal,
                    params.isDragContent,
                    params.lazySetup
                );
                this.resolveSetupInitialization?.();
                this.resolveSetupInitialization = undefined;
                await setupPromise;
                this.throwIfDestroyed();
            } else {
                this.Logger &&
                    this.Logger.error(
                        `[WindowManager]: app load failed ${params.kind} ${params.src}`
                    );
                throw new Error(`[WindowManager]: app load failed ${params.kind} ${params.src}`);
            }
            internalEmitter.emit("updateManagerRect");
            return {
                appId: this.id,
                app: appImpl,
            };
        } catch (error) {
            this.setupInitializationError =
                error instanceof Error ? error : new Error(String(error));
            this.resolveSetupInitialization?.();
            this.resolveSetupInitialization = undefined;
            throw error;
        }
    }

    public get box(): ReadonlyTeleBox | undefined {
        return this.boxManager?.getBox(this.id);
    }

    private throwIfDestroyed(): void {
        if (this.isDestroyed) {
            throw (
                this.setupInitializationError ||
                new Error(`[WindowManager]: app destroyed before setup, appId: ${this.id}`)
            );
        }
    }

    private async setupApp(
        appId: string,
        skipUpdate: boolean,
        app: NetlessApp,
        options?: setAppOptions,
        appOptions?: any,
        boxStatus?: TeleBoxState,
        forceTop?: boolean,
        forceNormal?: boolean,
        isDragContent?: boolean,
        lazySetup = false
    ) {
        log("setupApp", appId, app, options, boxStatus, forceTop, forceNormal, isDragContent);
        this.appDefinition = app;
        if (!this.boxManager) {
            throw new BoxManagerNotFoundError();
        }
        const AppContextClass = getExtendClass(AppContext, WindowManager.extendClass);
        const context = new AppContextClass(this.manager, this.boxManager, appId, this, appOptions);
        this.appContext = context;
        try {
            this.setupInitializationError = undefined;
            this.setupDescriptorReady = new Promise(resolve => {
                this.resolveSetupDescriptorReady = resolve;
            });
            internalEmitter
                .once(`${appId}${Events.WindowCreated}` as any)
                .then(() => {
                    if (this.isDestroyed) return;
                    let boxInitState: AppInitState | undefined;
                    if (!skipUpdate) {
                        boxInitState = this.getAppInitState(appId);
                        this.boxManager?.updateBoxState(boxInitState);
                    }
                    this.attachSetupScope(appId);
                    this.setViewFocusScenePath();
                    // 如果当前是回放模式, 则需要记录当前主视图的场景路径, 以便在 app 创建后恢复
                    let currentMainViewScenePath: string | undefined;
                    if (this.manager.isReplay) {
                        currentMainViewScenePath = (this.manager.mainView as any)
                            .scenePath as string;
                    }
                    this.setupDescriptor = {
                        app,
                        context,
                        boxInitState,
                        currentMainViewScenePath,
                    };
                    this.resolveSetupDescriptorReady?.();
                    this.resolveSetupDescriptorReady = undefined;
                    if (lazySetup) {
                        this.deferredSetup = this.setupDescriptor;
                    } else {
                        // Keep the original setup hand-off delay (attribute
                        // propagation safety), but hand execution to the
                        // manager's serial setup queue: focused app first and
                        // one setup finished before the next one starts.
                        this.deferredSetup = this.setupDescriptor;
                        setTimeout(() => {
                            if (!this.isDestroyed) this.manager.enqueueEagerSetup(this.id);
                        }, SETUP_APP_DELAY);
                    }
                })
                .catch(error => {
                    this.setupInitializationError =
                        error instanceof Error ? error : new Error(String(error));
                    this.resolveSetupDescriptorReady?.();
                    this.resolveSetupDescriptorReady = undefined;
                    this.handleSetupFailure(error);
                });
            this.boxManager?.createBox({
                appId: appId,
                app,
                options,
                canOperate: this.manager.canOperate,
                smartPosition: this.isAddApp,
                boxStatus,
                forceTop,
                forceNormal,
                isDragContent,
            });
            if (this.isAddApp && this.box) {
                if (boxStatus) {
                    this.store.setBoxStatus(appId, boxStatus);
                }
                this.store.updateAppState(appId, AppAttributes.ZIndex, this.box.zIndex);
                this.store.updateAppState(appId, AppAttributes.Size, {
                    width: this.box.intrinsicWidth,
                    height: this.box.intrinsicHeight,
                });
                this.boxManager.focusBox({ appId }, false);
            }
        } catch (error) {
            const cause = error instanceof Error ? error : new Error(String(error));
            this.Logger?.error(
                `[WindowManager]: app setup initialization error, kind: ${this.kind}, appId: ${
                    this.id
                }, error: ${cause.message}, stack: ${cause.stack || ""}`
            );
            throw error;
        }
    }

    private attachSetupScope(appId: string): void {
        if (this.setupScopeAttached) return;
        this.appEmitter.onAny(this.appListener);
        this.appAttributesUpdateListener(appId);
        this.setupScopeAttached = true;
    }

    private detachSetupScope(): void {
        if (!this.setupScopeAttached) return;
        this.appEmitter.offAny(this.appListener);
        this.manager.refresher.remove(this.id);
        this.manager.refresher.remove(this.stateKey);
        this.manager.refresher.remove(`${this.id}-fullPath`);
        this.setupScopeAttached = false;
    }

    public async ensureSetup(): Promise<any> {
        if (this.setupStarted) return this.waitForSetup();
        await this.waitForSetupInitialization();
        let deferred = this.deferredSetup || this.setupDescriptor;
        if (!deferred && this.setupDescriptorReady) {
            await this.setupDescriptorReady;
            if (this.setupStarted) return this.waitForSetup();
            deferred = this.deferredSetup || this.setupDescriptor;
        }
        if (this.setupInitializationError) {
            throw this.setupInitializationError;
        }
        if (!deferred) {
            const error = new Error(
                `[WindowManager]: app setup descriptor is unavailable, appId: ${this.id}`
            );
            this.Logger?.warn(`[WindowManager]: ${error.message}`);
            this.settleSetup({ succeeded: false, error });
            throw error;
        }
        this.deferredSetup = undefined;
        // Teardown removes the app attribute listeners. Reattach them before
        // re-running setup so scenePath/fullPath changes continue to update the View.
        this.attachSetupScope(this.id);
        this.setViewFocusScenePath();
        this.setupStarted = true;
        this.contentPageStateActive = true;
        // The constructor's completion belongs to the first attempt, including
        // callers that started waiting before setup. Retries get a new one.
        if (this.setupAttemptStarted || this.setupCompletionSettled) this.resetSetupCompletion();
        this.setupAttemptStarted = true;
        const completionPromise = this.setupCompletionPromise;
        const settleAttempt = this.createSetupSettler();
        await this.finishAppSetup(
            this.id,
            deferred.app,
            deferred.context,
            deferred.boxInitState,
            deferred.currentMainViewScenePath,
            settleAttempt
        );
        const completion = await completionPromise;
        if (!completion.succeeded) throw completion.error;
        return completion.result;
    }

    /** Wait until async App factory loading has entered setupApp. */
    public async waitForSetupInitialization(): Promise<void> {
        if (this.setupInitializationPromise) {
            await this.setupInitializationPromise;
        }
        if (this.setupInitializationError) {
            throw this.setupInitializationError;
        }
    }

    private resetSetupCompletion(): void {
        this.setupCompletionSettled = false;
        this.setupSucceeded = false;
        this.setupCompletionPromise = new Promise(resolve => {
            this.resolveSetupCompletion = resolve;
        });
    }

    private createSetupSettler(): (completion: AppSetupCompletion) => void {
        const resolve = this.resolveSetupCompletion;
        let settled = false;
        return completion => {
            if (settled) return;
            settled = true;
            if (this.resolveSetupCompletion === resolve) this.setupCompletionSettled = true;
            resolve(completion);
        };
    }

    private async finishAppSetup(
        appId: string,
        app: NetlessApp,
        context: AppContext<any, any>,
        boxInitState?: AppInitState,
        currentMainViewScenePath?: string,
        settle: (completion: AppSetupCompletion) => void = completion =>
            this.settleSetup(completion)
    ): Promise<void> {
        const setupGeneration = this.setupRunGeneration;
        let completedSetup: AppSetupCompletion | undefined;
        const aborted = async () => {
            let cleanupFailure: AppTeardownFailure | undefined;
            if (completedSetup?.succeeded && app.teardown) {
                try {
                    await this.invokeAppTeardown(app, context, completedSetup.result);
                } catch (error) {
                    cleanupFailure = new AppTeardownFailure(String(error));
                    this.Logger?.error(
                        `[WindowManager]: late app teardown failed, kind: ${this.kind}, appId: ${appId}, error: ${error}`
                    );
                }
            }
            this.Logger?.warn(
                `[WindowManager]: app setup aborted by teardown/destroy, kind: ${this.kind}, appId: ${appId}`
            );
            settle({
                succeeded: false,
                error:
                    cleanupFailure ??
                    new Error(
                        `[WindowManager]: app setup aborted by teardown/destroy, appId: ${appId}`
                    ),
            });
        };
        try {
            // 延迟执行 setup, 防止初始化的属性没有更新成功
            this.Logger?.info(`[WindowManager]: setup app ${this.kind}, appId: ${appId}`);
            const setupResult = await this.runAppSetup(appId, app, context);
            completedSetup = setupResult;
            if (setupGeneration !== this.setupRunGeneration || this.status === "destroyed") {
                // Teardown/destroy ran while setup was in flight: the runtime
                // this setup produced is already released. Never mark it as
                // set up; settle as aborted so waiters (the serial setup
                // queue) move on and a later ensureSetup() can re-run cleanly
                // from the retained descriptor.
                await aborted();
                return;
            }
            if (!setupResult.succeeded) {
                settle(setupResult);
                return;
            }
            const { result } = setupResult;
            this.appResult = result;
            this.setupResult = result;
            this.setupSucceeded = true;
            // Focus events may have fired before setup ran; sync the current
            // focus state so apps observe a consistent initial value.
            await this.emitAppFocusEvent(this.isFocused, true);
            if (setupGeneration !== this.setupRunGeneration || this.isDestroyed) {
                await aborted();
                return;
            }
            if (this.manager.lazySetupEnabled) await this.emitAppActivityEvent();
            if (setupGeneration !== this.setupRunGeneration || this.isDestroyed) {
                await aborted();
                return;
            }
            this.scheduleBoxSizeSync();
            if (!this.manager.lazySetupEnabled) {
                this.afterSetupApp(boxInitState);
                this.flushPendingZIndex();
            }
            this.fixMobileSize();
            if (currentMainViewScenePath && !this.manager.lazySetupEnabled) {
                this.manager.mainViewProxy.setFocusScenePath(currentMainViewScenePath);
            }
            settle(setupResult);
            void appRegister
                .notifyApp(this.kind, "created", { appId, result })
                .catch(error => this.logPostSetupNotificationError("registered hook", error));
            void callbacks
                .emit("onAppSetup", appId)
                .catch(error => this.logPostSetupNotificationError("onAppSetup", error));
        } catch (error) {
            if (setupGeneration !== this.setupRunGeneration || this.isDestroyed) await aborted();
            else this.handleSetupFailure(error, settle);
        }
    }

    private async invokeAppTeardown(
        app: NetlessApp,
        context: AppContext<any, any>,
        result: any
    ): Promise<void> {
        if (!app.teardown) return;
        await this.withTeardownWatchdog(() => app.teardown!(context, result));
    }

    private async withTeardownWatchdog<T>(operation: () => Promise<T> | T): Promise<T> {
        if (this.teardownWatchdog) return operation();
        const startedAt = Date.now();
        const timer = setTimeout(() => {
            this.Logger?.error(
                `[WindowManager]: app teardown timeout, kind: ${this.kind}, appId: ${
                    this.id
                }, elapsedMs: ${Date.now() - startedAt}`
            );
        }, 10_000);
        const watchdog = { timer, startedAt };
        this.teardownWatchdog = watchdog;
        try {
            return await operation();
        } finally {
            if (this.teardownWatchdog === watchdog) {
                clearTimeout(timer);
                this.teardownWatchdog = undefined;
            }
        }
    }

    private handleSetupFailure(
        error: unknown,
        settle: (completion: AppSetupCompletion) => void = completion =>
            this.settleSetup(completion)
    ): void {
        const cause = error instanceof Error ? error : new Error(String(error));
        this.Logger?.error(
            `[WindowManager]: app setup lifecycle error, kind: ${this.kind}, appId: ${
                this.id
            }, status: ${this.status}, error: ${cause.message}, stack: ${cause.stack || ""}`
        );
        // Keep the descriptor and allow a later ensureSetup() to retry from
        // scratch (design TC-016 step 3: recovery after a failed setup).
        this.setupStarted = false;
        this.contentPageStateActive = false;
        this.contentPageState = undefined;
        this.deferredSetup = this.setupDescriptor;
        settle({ succeeded: false, error: cause });
    }

    private logPostSetupNotificationError(stage: string, error: unknown): void {
        const cause = error instanceof Error ? error : new Error(String(error));
        this.Logger?.error(
            `[WindowManager]: app post-setup notification error, stage: ${stage}, kind: ${
                this.kind
            }, appId: ${this.id}, error: ${cause.message}, stack: ${cause.stack || ""}`
        );
    }

    private async runAppSetup(
        appId: string,
        app: NetlessApp,
        context: AppContext<any, any>
    ): Promise<AppSetupCompletion> {
        this.clearSetupWatchdog();
        this.setupWatchdogTimer = setTimeout(() => {
            this.setupWatchdogTimer = undefined;
            if (this.status === "destroyed") return;
            this.Logger?.warn(
                `[WindowManager]: hydrate timeout, stage: app setup, kind: ${this.kind}, appId: ${appId}, timeout: ${APP_SETUP_WATCHDOG_TIMEOUT}ms`
            );
        }, APP_SETUP_WATCHDOG_TIMEOUT);
        try {
            return { succeeded: true, result: await app.setup(context) };
        } catch (error) {
            const cause = error instanceof Error ? error : new Error(String(error));
            this.Logger?.error(
                `[WindowManager]: app setup error, kind: ${this.kind}, appId: ${appId}, status: ${
                    this.status
                }, error: ${cause.message}, stack: ${cause.stack || ""}`
            );
            return { succeeded: false, error };
        } finally {
            this.clearSetupWatchdog();
        }
    }

    private settleSetup(completion: AppSetupCompletion): void {
        if (this.setupCompletionSettled) return;
        this.setupCompletionSettled = true;
        this.resolveSetupCompletion(completion);
    }

    private flushPendingZIndex(): void {
        const zIndex = this.pendingZIndex;
        this.pendingZIndex = undefined;
        if (zIndex != null && zIndex > 0 && zIndex !== this.box?.zIndex) {
            this.boxManager?.setZIndex(this.id, zIndex);
            // Deliberate direct focus: this runs only after this app's own
            // setup completed (design §16.2 leaves post-setup zIndex commits
            // outside the coordinator; the app is ready by definition).
            this.boxManager?.focusBox({ appId: this.id });
        }
    }

    private clearSetupWatchdog(): void {
        if (this.setupWatchdogTimer != null) {
            clearTimeout(this.setupWatchdogTimer);
            this.setupWatchdogTimer = undefined;
        }
    }

    // 兼容移动端创建时会出现 PPT 不适配的问题
    private fixMobileSize() {
        const box = this.boxManager?.getBox(this.id);
        if (box) {
            this.boxManager?.resizeBox({
                appId: this.id,
                width: box.intrinsicWidth + 0.001,
                height: box.intrinsicHeight + 0.001,
                skipUpdate: true,
            });
        }
    }

    private afterSetupApp(boxInitState: AppInitState | undefined): void {
        if (boxInitState) {
            if (!boxInitState?.x || !boxInitState.y) {
                this.boxManager?.setBoxInitState(this.id);
            }
        }
    }

    public async onSeek(time: number) {
        this.appEmitter.emit("seek", time).catch(err => {
            console.log(`[WindowManager]: emit seek error: ${err.message}`);
        });
        const boxInitState = this.getAppInitState(this.id);
        this.boxManager?.updateBoxState(boxInitState);
    }

    public async onReconnected() {
        const isExist = Boolean(this.manager.attributes.apps[this.id]);
        if (!isExist) {
            await this.destroy(true, false, true);
            return;
        }
        this.appEmitter.emit("reconnected", undefined);
        const currentAppState = this.getAppInitState(this.id);
        await this.destroy(true, false, true);
        const params = this.params;
        const AppProxyClass = getExtendClass(AppProxy, WindowManager.extendClass);
        const appProxy = new AppProxyClass(params, this.manager, this.id, this.isAddApp);
        await appProxy.baseInsertApp(true, currentAppState?.boxStatus);
        this.boxManager?.updateBoxState(currentAppState);
    }

    public async onRemoveScene(scenePath: string) {
        if (this.scenePath && scenePath.startsWith(this.scenePath + "/")) {
            let nextIndex = this.pageState.index;
            let fullPath = this._pageState.getFullPath(nextIndex);
            if (!fullPath) {
                nextIndex = 0;
                fullPath = this._pageState.getFullPath(nextIndex);
            }
            if (fullPath) {
                this.setFullPath(fullPath);
            }
            this.setViewFocusScenePath();
            if (this.view) {
                this.view.focusSceneIndex = nextIndex;
            }
        }
    }

    private getEffectiveAppWindowFlags(id: string) {
        const { forceTop, forceNormal, isDragContent } = this.store.getAppAttributes(id);
        return {
            forceTop: this.manager.useBoxesStatus ? forceTop : undefined,
            forceNormal: this.manager.useBoxesStatus ? forceNormal : undefined,
            isDragContent,
        };
    }

    public getAppInitState = (id: string) => {
        const attrs = this.store.getAppState(id);
        if (!attrs) return;
        const position = attrs?.[AppAttributes.Position];
        const focus = this.store.focus;
        const size = attrs?.[AppAttributes.Size];
        const sceneIndex = attrs?.[AppAttributes.SceneIndex];
        const maximized = this.attributes?.["maximized"];
        const minimized = this.attributes?.["minimized"];
        const boxStatus = this.store.getBoxStatus(id) ?? undefined;
        const lastNotMinimizedBoxStatus = this.store.getLastNotMinimizedBoxStatus(id) ?? undefined;
        const { forceTop, forceNormal, isDragContent } = this.getEffectiveAppWindowFlags(id);
        const zIndex = attrs?.zIndex;
        let payload = { maximized, minimized, zIndex } as AppInitState;
        if (position) {
            payload = { ...payload, id: id, x: position.x, y: position.y };
        }
        if (focus === id) {
            payload = { ...payload, focus: true };
        }
        if (size) {
            payload = { ...payload, width: size.width, height: size.height };
        }
        if (sceneIndex) {
            payload = { ...payload, sceneIndex };
        }
        if (boxStatus) {
            payload = { ...payload, boxStatus };
        }
        if (lastNotMinimizedBoxStatus) {
            payload = { ...payload, lastNotMinimizedBoxStatus };
        }
        if (forceTop) {
            payload = { ...payload, forceTop };
        }
        if (forceNormal) {
            payload = { ...payload, forceNormal };
        }
        if (isDragContent) {
            payload = { ...payload, isDragContent };
        }
        return payload;
    };

    public emitAppSceneStateChange(sceneState: SceneState) {
        this.appEmitter.emit("sceneStateChange", sceneState);
    }

    public emitAppIsWritableChange() {
        this.appEmitter.emit("writableChange", this.isWritable);
    }

    private makeAppEventListener(appId: string) {
        return (eventName: AppListenerKeys, data: any) => {
            if (!this.manager.canOperate) return;
            switch (eventName) {
                case "setBoxSize": {
                    this.boxManager?.resizeBox({
                        appId,
                        width: data.width,
                        height: data.height,
                        skipUpdate: false,
                    });
                    break;
                }
                case "setBoxMinSize": {
                    this.boxManager?.setBoxMinSize({
                        appId,
                        minWidth: data.minwidth,
                        minHeight: data.minheight,
                    });
                    break;
                }
                case "setBoxTitle": {
                    this.boxManager?.setBoxTitle({ appId, title: data.title });
                    break;
                }
                case AppEvents.destroy: {
                    if (this.status === "destroyed") return;
                    this.destroy(true, false, true, data?.error);
                    if (data?.error) {
                        console.error(data?.error);
                    }
                    break;
                }
                case "focus": {
                    // Two semantics share this event name: the legacy
                    // app → WM focus REQUEST (emitted with no payload) and
                    // the v2 WM → app boolean focus broadcast. A boolean
                    // payload is a broadcast echo: focusing the app here
                    // would blur the other cached apps, whose blur
                    // broadcasts would focus them back — an infinite
                    // focus-fight loop.
                    if (typeof data === "boolean") break;
                    // Legacy request path: routed through onBoxFocus, which
                    // defers to the lazy coordinator for unsetup apps
                    // (design §16.2).
                    this.boxManager?.focusBox({ appId: this.id });
                    boxEmitter.emit("focus", { appId: this.id, source: "app" });
                    break;
                }
                default: {
                    break;
                }
            }
        };
    }

    private appAttributesUpdateListener = (appId: string) => {
        this.manager.refresher.add(appId, () => {
            return autorun(() => {
                const attrs = this.manager.attributes[appId];
                if (attrs) {
                    this.appEmitter.emit("attributesUpdate", attrs);
                }
            });
        });
        this.manager.refresher.add(this.stateKey, () => {
            return autorun(() => {
                const appState = this.appAttributes?.state;
                if (appState?.zIndex > 0 && appState.zIndex !== this.box?.zIndex) {
                    if (!this.isSetup) {
                        this.pendingZIndex = appState.zIndex;
                        return;
                    }
                    this.boxManager?.setZIndex(appId, appState.zIndex);
                    this.boxManager?.focusBox({ appId });
                }
            });
        });
        this.manager.refresher.add(`${appId}-fullPath`, () => {
            return autorun(() => {
                const fullPath = this.appAttributes?.fullPath;
                this.setFocusScenePathHandler(fullPath);
                if (this._prevFullPath !== fullPath) {
                    this.notifyPageStateChange();
                    this._prevFullPath = fullPath;
                }
            });
        });
    };

    private setFocusScenePathHandler = debounce((fullPath: string | undefined) => {
        if (this.view && fullPath && fullPath !== this.view?.focusScenePath) {
            setViewFocusScenePath(this.view, fullPath);
            callbacks.emit("onAppScenePathChange", { appId: this.id, view: this.view });
        }
    }, 50);

    public setScenePath(): void {
        if (!this.manager.canOperate) return;
        const fullScenePath = this.getFullScenePath();
        if (this.manager.room && fullScenePath && this.view) {
            setScenePath(this.manager.room, fullScenePath);
        }
    }

    public setViewFocusScenePath() {
        const fullPath = this.getFullScenePath();
        if (fullPath && this.view) {
            setViewFocusScenePath(this.view, fullPath);
        }
        return fullPath;
    }

    private createView(): View {
        const view = this.viewManager.createView(this.id);
        this.setViewFocusScenePath();
        return view;
    }

    public notifyPageStateChange = debounce(() => {
        this.appEmitter.emit("pageStateChange", this.pageState);
    }, 50);

    public notifyBoxStatusChange = (status: TeleBoxState) => {
        this.appEmitter.emit("boxStatusChange", { appId: this.id, status });
    };

    public get pageState(): PageState {
        return this._pageState.toObject();
    }

    /** Latest page state reported by an App whose pages are not whiteboard scenes. */
    public setContentPageState(state: unknown): void {
        if (this.status === "destroyed" || !this.contentPageStateActive) return;
        if (!state || typeof state !== "object") return;
        const { index, length } = state as Partial<PageState>;
        if (
            !Number.isInteger(index) ||
            !Number.isInteger(length) ||
            (length as number) < 1 ||
            (index as number) < 0 ||
            (index as number) >= (length as number)
        ) {
            return;
        }
        this.contentPageState = { index: index as number, length: length as number };
    }

    public getContentPageState(): PageState | undefined {
        return this.status !== "destroyed" && this.setupSucceeded && this.contentPageState
            ? { ...this.contentPageState }
            : undefined;
    }

    // PageRemoveService
    public async removeSceneByIndex(index: number) {
        const scenePath = this._pageState.getFullPath(index);
        if (scenePath) {
            const nextIndex = calculateNextIndex(index, this.pageState);
            // 只修改 focus path 不修改 FullPath
            this.setSceneIndexWithoutSync(nextIndex);
            this.manager.dispatchInternalEvent(Events.SetAppFocusIndex, {
                type: "app",
                appID: this.id,
                index: nextIndex,
            });
            // 手动添加一个延迟, 让 app 切换场景后再删除以避免闪烁
            setTimeout(() => {
                removeScenes(this.manager.room, scenePath, index);
            }, 100);
            return true;
        } else {
            return false;
        }
    }

    public setSceneIndexWithoutSync(index: number) {
        if (this.view) {
            this.view.focusSceneIndex = index;
        }
    }
    // PageRemoveService end

    public setSceneIndex(index: number) {
        if (this.view) {
            this.view.focusSceneIndex = index;
            const fullPath = this._pageState.getFullPath(index);
            if (fullPath) {
                this.setFullPath(fullPath);
            }
        }
    }

    public async teardown(): Promise<void> {
        if (!this.setupStarted || !this.appContext) return;
        const app = this.appDefinition;
        if (app?.teardown) {
            await this.withTeardownWatchdog(async () => {
                // Invalidate the in-flight attempt without passing an absent
                // setupResult to the App's physical teardown.
                this.setupRunGeneration += 1;
                this.contentPageStateActive = false;
                this.contentPageState = undefined;
                if (this.setupCompletionSettled) {
                    await this.invokeAppTeardown(app, this.appContext!, this.setupResult);
                } else {
                    // The invalidated attempt tears down its result when it returns.
                    const completion = await this.setupCompletionPromise;
                    if (!completion.succeeded && completion.error instanceof AppTeardownFailure) {
                        throw completion.error;
                    }
                }
                this.appResult = undefined;
                this.setupResult = undefined;
                this.setupSucceeded = false;
                this.detachSetupScope();
                this.setupStarted = false;
                this.deferredSetup = this.setupDescriptor;
            });
        } else {
            this.Logger?.warn(
                `[WindowManager]: app ${this.kind} does not implement teardown; keeping runtime alive`
            );
        }
    }

    public destroy(
        needCloseBox: boolean,
        cleanAttrs: boolean,
        skipUpdate: boolean,
        error?: Error
    ): Promise<void> {
        if (this.destroyPromise) return this.destroyPromise;
        if (this.isDestroyed) return Promise.resolve();
        let resolveDestroy!: () => void;
        let rejectDestroy!: (error: unknown) => void;
        // Publish completion before any cleanup can synchronously re-enter destroy.
        this.destroyPromise = new Promise<void>((resolve, reject) => {
            resolveDestroy = resolve;
            rejectDestroy = reject;
        });
        this.finishDestroy(needCloseBox, cleanAttrs, skipUpdate, error).then(
            resolveDestroy,
            rejectDestroy
        );
        return this.destroyPromise;
    }

    private async finishDestroy(
        needCloseBox: boolean,
        cleanAttrs: boolean,
        skipUpdate: boolean,
        error?: Error
    ): Promise<void> {
        this.status = "destroyed";
        this.contentPageStateActive = false;
        this.contentPageState = undefined;
        this.setupRunGeneration += 1;
        this.manager.notifyAppDestroyed(this.id);
        this.boxFocusOffHandlers?.forEach(off => off());
        this.boxFocusOffHandlers = [];
        const setupError =
            error || new Error(`[WindowManager]: app destroyed before setup, appId: ${this.id}`);
        this.setupInitializationError = setupError;
        this.resolveSetupInitialization?.();
        this.resolveSetupInitialization = undefined;
        this.resolveSetupDescriptorReady?.();
        this.resolveSetupDescriptorReady = undefined;
        this.settleSetup({
            succeeded: false,
            error: setupError,
        });
        this.clearSetupWatchdog();
        this.boxSizeSynchronizer.destroy();
        try {
            await appRegister.notifyApp(this.kind, "destroy", { appId: this.id });
        } catch (hookError) {
            this.Logger?.error(`[WindowManager]: registered destroy hook failed: ${hookError}`);
        }
        try {
            await this.appEmitter.emit("destroy", { error });
        } catch (appError) {
            this.Logger?.error(`[WindowManager]: app destroy listener failed: ${appError}`);
        }
        this.appEmitter.clearListeners();
        internalEmitter.emit(`destroy-${this.id}` as any, { error });
        if (needCloseBox) {
            this.boxManager?.closeBox(this.id, skipUpdate);
        }
        if (cleanAttrs) {
            this.store.cleanAppAttributes(this.id);
            if (this.scenePath) {
                removeScenes(this.manager.room, this.scenePath);
            }
        }
        this.appProxies.delete(this.id);
        this._pageState.destroy();

        this.viewManager.destroyView(this.id);
        this.manager.appStatus.delete(this.id);
        this.manager.refresher.remove(this.id);
        this.manager.refresher.remove(this.stateKey);
        this.manager.refresher.remove(`${this.id}-fullPath`);
        this._prevFullPath = undefined;
        this.Logger &&
            this.Logger.info(`[WindowManager]: destroy app ${this.kind} appId: ${this.id}`);
    }

    public close(): Promise<void> {
        return this.destroy(true, true, false);
    }
}
