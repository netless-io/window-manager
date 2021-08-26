import AppDocsViewer from '@netless/app-docs-viewer';
import AppMediaPlayer from '@netless/app-media-player';
import Emittery from 'emittery';
import {
    AppCreateError,
    AppManagerNotInitError,
    ParamsInvalidError,
    WhiteWebSDKInvalidError
} from './error';
import { AppListeners } from './AppListener';
import { AppProxy } from './AppProxy';
import { AttributesDelegate, Fields } from './AttributesDelegate';
import {
    autorun,
    CameraBound,
    CameraState,
    Displayer,
    DisplayerState,
    Event,
    InvisiblePlugin,
    InvisiblePluginContext,
    isRoom,
    Room,
    SceneDefinition,
    View,
    ViewVisionMode,
    WhiteVersion,
    reaction,
    RoomPhase,
    ViewMode,
    ScenePathType
} from 'white-web-sdk';
import { BoxManager, CreateCollectorConfig, TELE_BOX_STATE } from './BoxManager';
import { CameraStore } from './CameraStore';
import { log } from './log';
import { NetlessApp } from './typings';
import { setupWrapper, ViewManager } from './ViewManager';
import './style.css';
import '@netless/telebox-insider/dist/style.css';
import {
    Events,
    AppAttributes,
    AppEvents,
    REQUIRE_VERSION,
    AppStatus,
    MagixEventName,
    DEFAULT_CONTAINER_RATIO,
} from "./constants";
import { genAppId, makeValidScenePath, setScenePath, setViewFocusScenePath, } from './Common';
import { replaceRoomFunction } from './RoomHacker';
import { MainViewProxy } from './MainView';

export const BuiltinApps = {
    DocsViewer: AppDocsViewer.kind as string,
    MediaPlayer: AppMediaPlayer.kind as string,
}

export type WindowMangerAttributes = {
    modelValue?: string,
    boxState: TELE_BOX_STATE,
    [key: string]: any,
}

export type apps = {
    [key: string]: NetlessApp
}

export type AddAppOptions = {
    scenePath?: string;
    title?: string;
    scenes?: SceneDefinition[],
}

export type setAppOptions = AddAppOptions & { appOptions?: any };

export type AddAppParams = {
    kind: string;
    // app 地址(本地 app 不需要传)
    src?: string;
    // 窗口配置
    options?: AddAppOptions;
    // 初始化 attributes
    attributes?: any;
}

export type BaseInsertParams = {
    kind: string;
    // app 地址(本地 app 不需要传)
    src?: string;
    // 窗口配置
    options?: AddAppOptions;
    // 初始化 attributes
    attributes?: any;
    isDynamicPPT?: boolean;
}

export type AppSyncAttributes = {
    kind: string,
    src?: string,
    options: any,
    state?: any,
    isDynamicPPT?: boolean,
}

export type AppInitState = {
    id: string,
    x?: number,
    y?: number,
    width?: number,
    height?: number,
    focus?: boolean,
    snapshotRect?: any,
    boxState?: TELE_BOX_STATE,
    sceneIndex?: number,
}

export const emitter: Emittery<{
    onCreated: undefined;
    [key: string]: any
}> = new Emittery();

export type PublicEvent = {
    mainViewModeChange: ViewVisionMode,
    boxStateChange: `${TELE_BOX_STATE}`,
}

export const callbacks: Emittery<PublicEvent> = new Emittery();

export type MountParams = {
    room: Room,
    container: HTMLElement,
    containerSizeRatio?: number,
    collectorContainer?: HTMLElement,
    collectorStyles?: Partial<CSSStyleDeclaration>,
    debug?: boolean,
};

export class WindowManager extends InvisiblePlugin<WindowMangerAttributes> {
    public static kind: string = "WindowManager";
    public static displayer: Displayer;
    public static wrapper: HTMLElement | null;
    public static debug = false;
    public static containerSizeRatio = DEFAULT_CONTAINER_RATIO;
    private static isCreated = false;

    public appListeners?: AppListeners;
    public static appClasses: Map<string, NetlessApp> = new Map();

    private appManager?: AppManager;
    public readonly?: boolean;
    public emitter: Emittery<PublicEvent> = callbacks;

    constructor(context: InvisiblePluginContext) {
        super(context);
    }

    /**
     * 挂载 WindowManager
     */
    public static async mount(
        room: Room,
        container: HTMLElement,
        collectorContainer?: HTMLElement,
        options?: {
            containerSizeRatio: number,
            collectorStyles?: Partial<CSSStyleDeclaration>,
            debug?: boolean,
        }
    ): Promise<WindowManager>;

    public static async mount(params: MountParams): Promise<WindowManager>;

    public static async mount(
        params: MountParams | Room,
        container?: HTMLElement,
        collectorContainer?: HTMLElement,
        options?: {
            containerSizeRatio?: number,
            collectorStyles?: Partial<CSSStyleDeclaration>,
            debug?: boolean,
        }) {
        let room: Room;
        let containerSizeRatio: number | undefined;
        let collectorStyles: Partial<CSSStyleDeclaration> | undefined;
        let debug: boolean | undefined;
        if ("room" in params) {
            room = params.room;
            container = params.container;
            collectorContainer = params.collectorContainer;
            containerSizeRatio = params.containerSizeRatio;
            collectorStyles = params.collectorStyles;
            debug = params.debug;
        } else {
            room = params;
            containerSizeRatio = options?.containerSizeRatio;
            collectorStyles = options?.collectorStyles;
            debug = options?.debug;
        }

        this.checkVersion();
        if (!container) {
            throw new Error("[WindowManager]: Container must provide");
        }
        if (WindowManager.isCreated) {
            throw new Error("[WindowManager]: Already created cannot be created again");
        }
        let manager = room.getInvisiblePlugin(WindowManager.kind) as WindowManager;
        if (!manager) {
            manager = await room.createInvisiblePlugin(WindowManager, {}) as WindowManager;
        }
        this.debug = Boolean(debug);
        if (containerSizeRatio) {
            WindowManager.containerSizeRatio = containerSizeRatio;
        }
        const { mainViewElement } = setupWrapper(container);
        manager.appManager = new AppManager(manager, {
            collectorContainer: collectorContainer,
            collectorStyles: collectorStyles
        });
        manager.bindMainView(mainViewElement);
        replaceRoomFunction(room, manager.appManager);
        emitter.emit("onCreated");
        WindowManager.isCreated = true;
        return manager;
    }

    /**
     * 注册插件
     */
    public static register(app: NetlessApp) {
        this.appClasses.set(app.kind, app);
    }

    /**
     * 创建 main View
     */
    public createMainView(): View {
        if (this.appManager) {
            return this.appManager.viewManager.mainView!;
        } else {
            throw new AppManagerNotInitError();
        }
    }

    /**
     * 创建一个 app 至白板
     */
    public async addApp(params: AddAppParams) {
        if (this.appManager) {
            if (!params.kind || typeof params.kind !== "string") {
                throw new ParamsInvalidError();
            }
            const appImpl = WindowManager.appClasses.get(params.kind);
            if (appImpl && appImpl.config?.singleton) {
                if (this.appManager.appProxies.has(params.kind)) {
                    throw new AppCreateError();
                }
            }
            let isDynamicPPT = false;
            if (params.options) {
                const { scenePath, scenes } = params.options;
                if (scenePath) {
                    for (const appId in this.apps) {
                        const appScenePath = this.appManager.delegate.getAppScenePath(appId);
                        if (appScenePath && appScenePath === scenePath) {
                            console.warn(`ScenePath ${scenePath} Already opened`);
                            return;
                        }
                    }
                }
                if (scenePath && scenes && scenes.length > 0) {
                    if (this.isDynamicPPT(scenes)) {
                        isDynamicPPT = true;
                        if (!this.displayer.entireScenes()[scenePath]) {
                            this.room?.putScenes(scenePath, scenes);
                        }
                    } else {
                        if (!this.displayer.entireScenes()[scenePath]) {
                            this.room?.putScenes(scenePath, [{ name: scenes[0].name }]);
                        }
                    }
                }
            }

            const appId = await this.appManager.addApp(params, isDynamicPPT);
            return appId
        } else {
            throw new AppManagerNotInitError();
        }
    }

    /**
     * 关闭 APP
     */
    public async closeApp(appId: string) {
        return this.appManager?.closeApp(appId);
    }

    /**
     * 设置 mainView 的 ScenePath, 并且切换白板为可写状态
     */
    public setMainViewScenePath(scenePath: string) {
        if (this.appManager) {
            this.appManager.setMainViewScenePath(scenePath);
        }
    }

    /**
     * 设置 mainView 的 SceneIndex, 并且切换白板为可写状态
     */
    public setMainViewSceneIndex(index: number) {
        if (this.appManager) {
            this.appManager.setMainViewSceneIndex(index);
        }
    }

    /**
     * 返回 mainView 的 ScenePath
     */
    public getMainViewScenePath(): string {
        return this.appManager?.delegate.getMainViewScenePath();
    }

    /**
     * 返回 mainView 的 SceneIndex
     */
    public getMainViewSceneIndex(): number {
        return this.appManager?.delegate.getMainViewSceneIndex();
    }

    /**
     * 设置所有 app 的 readonly 模式
     */
    public setReadonly(readonly: boolean) {
        if (this.room?.isWritable) {
            this.readonly = readonly;
            this.appManager?.boxManager.teleBoxManager.setReadonly(readonly);
        }
    }

    /**
     * 切换 mainView 为可写
     */
    public switchMainViewToWriter() {
        return this.appManager?.viewManager.mainViewClickHandler();
    }

    /**
     * app destroy 回调
    */
    public onAppDestroy(kind: string, listener: (error: Error) => void) {
        emitter.once(`destroy-${kind}`).then(listener);
    }

    /**
     * 设置 ViewMode
     */
    public setViewMode(mode: ViewMode) {
        if (mode === ViewMode.Broadcaster) {
            this.appManager?.delegate.setBroadcaster(this.displayer.observerId);
            this.appManager?.delegate.setMainViewCamera(this.mainView.camera);
            this.appManager?.delegate.setMainViewSize(this.mainView.size);
        }
        if (mode === ViewMode.Freedom) {
            this.appManager?.delegate.setMainViewCamera(undefined);
            this.appManager?.delegate.setMainViewSize(undefined);
            this.appManager?.delegate.setBroadcaster(undefined);
        }
    }

    public get mainView() {
        return this.appManager!.viewManager.mainView;
    }

    public get camera() {
        return this.appManager!.viewManager.mainView.camera;
    }

    public get apps() {
        return this.appManager?.delegate.apps();
    }

    public get boxState() {
        return this.appManager?.boxManager.teleBoxManager.state;
    }

    public onDestroy() {
        this._destroy();
    }

    public destroy() {
        this._destroy();
    }

    private _destroy() {
        this.appManager?.destroy();
        WindowManager.isCreated = false;
        log("Destroyed");
    }

    private bindMainView(divElement: HTMLDivElement) {
        if (this.appManager) {
            const mainView = this.appManager.viewManager.mainView;
            mainView.divElement = divElement;

            if (!mainView.focusScenePath) {
                this.appManager.delegate.setMainViewFocusPath();
            }
            if (!this.appManager.delegate.getMainViewScenePath()) {
                const sceneState = this.displayer.state.sceneState;
                this.appManager.delegate.setMainViewScenePath(sceneState.scenePath);
                this.appManager.delegate.setMainViewSceneIndex(sceneState.index);
            }

            if (this.appManager.delegate.focus === undefined) {
                this.appManager.viewManager.freedomAllViews();
                this.appManager.viewManager.switchMainViewToWriter();
            }
        }
    }

    public get canOperate() {
        if (isRoom(this.displayer)) {
            return (this.displayer as Room).isWritable && (this.displayer as Room).phase === RoomPhase.Connected;
        } else {
            return false;
        }
    }

    public get room() {
        return this.canOperate ? (this.displayer as Room) : undefined;
    }

    public safeSetAttributes(attributes: any) {
        if (this.canOperate) {
            this.setAttributes(attributes);
        }
    }

    public safeUpdateAttributes(keys: string[], value: any) {
        if (this.canOperate) {
            this.updateAttributes(keys, value);
        }
    }

    private safeDispatchMagixEvent(event: string, payload: any) {
        if (this.canOperate) {
            (this.displayer as Room).dispatchMagixEvent(event, payload);
        }
    }

    private getSceneName(scenePath: string, index?: number) {
        const scenes = this.displayer.entireScenes()[scenePath];
        if (scenes && index !== undefined) {
            return scenes[index]?.name
        }
    }

    private isDynamicPPT(scenes: SceneDefinition[]) {
        const sceneSrc = scenes[0]?.ppt?.src;
        return sceneSrc?.startsWith("pptx://");
    }

    private static checkVersion() {
        const version = this.getVersionNumber(WhiteVersion);
        if (version < this.getVersionNumber(REQUIRE_VERSION)) {
            throw new WhiteWebSDKInvalidError(REQUIRE_VERSION);
        }
    }

    private static getVersionNumber(version: string) {
        return parseInt(version.split(".").join(""));
    }
}

export class AppManager {
    public displayer: Displayer;
    public boxManager: BoxManager;
    public cameraStore: CameraStore;
    public viewManager: ViewManager;
    public appProxies: Map<string, AppProxy> = new Map();
    public appStatus: Map<string, AppStatus> = new Map();
    public delegate = new AttributesDelegate(this);
    public mainViewProxy = new MainViewProxy(this);

    private appListeners: AppListeners;
    private reactionDisposers: any[] = [];

    constructor(public windowManger: WindowManager, options: CreateCollectorConfig) {
        this.displayer = windowManger.displayer;
        this.cameraStore = new CameraStore();
        this.viewManager = new ViewManager(
            this.displayer as Room,
            this,
            this.cameraStore
        );
        this.boxManager = new BoxManager(
            this,
            this.viewManager.mainView,
            this.appProxies,
            options
        );
        this.appListeners = new AppListeners(
            this,
            this.viewManager,
            this.appProxies
        );
        this.displayer.callbacks.on(this.eventName, this.displayerStateListener);
        this.displayer.callbacks.on(
            "onEnableWriteNowChanged",
            this.displayerWritableListener
        );
        this.appListeners.addListeners();

        emitter.once("onCreated").then(async () => {
            await this.attributesUpdateCallback(this.attributes.apps);
            emitter.onAny(this.eventListener);
            this.reactionDisposers.push(
                reaction(
                    () => Object.keys(this.attributes?.apps || {}).length,
                    appsCount => {
                        this.attributesUpdateCallback(this.attributes.apps);
                    }
                )
            );
            this.reactionDisposers.push(
                reaction(
                    () => this.attributes[Fields.MainViewCamera],
                    camera => {
                        if (this.delegate.broadcaster !== this.displayer.observerId && camera) {
                            this.mainViewProxy.moveCamera(camera);
                        }
                    }, {
                    fireImmediately: true
                }
                )
            );
            this.reactionDisposers.push(
                reaction(
                    () => this.attributes[Fields.MainViewSize],
                    size => {
                        if (this.delegate.broadcaster !== this.displayer.observerId && size) {
                            this.mainViewProxy.moveCameraToContian(size);
                        }
                    }, {
                    fireImmediately: true
                }
                )
            );
            if (!this.attributes.apps || Object.keys(this.attributes.apps).length === 0) {
                const mainScenePath = this.delegate.getMainViewScenePath();
                if (!mainScenePath) return;
                const sceneState = this.displayer.state.sceneState;
                if (sceneState.scenePath !== mainScenePath) {
                    this.room?.setScenePath(mainScenePath);
                }
            }
        });
    }

    /**
     * 插件更新 attributes 时的回调
     *
     * @param {*} attributes
     * @memberof WindowManager
     */
    public async attributesUpdateCallback(apps: any) {
        if (apps) {
            for (const id in apps) {
                if (!this.appProxies.has(id) && !this.appStatus.has(id)) {
                    const app = apps[id];
                    let appImpl = app.src;
                    if (!appImpl) {
                        appImpl = WindowManager.appClasses.get(app.kind);
                    }
                    await this.baseInsertApp({
                        kind: app.kind,
                        src: appImpl,
                        options: app.options,
                        isDynamicPPT: app.isDynamicPPT
                    }, id);
                    this.focusByAttributes(apps);
                }
            }
        }
    }

    public async addApp(params: AddAppParams, isDynamicPPT: boolean): Promise<string | undefined> {
        log("addApp", params);
        try {
            const appId = genAppId(params.kind);
            this.appStatus.set(appId, AppStatus.StartCreate);
            this.delegate.setupAppAttributes(params, appId, isDynamicPPT);
            const needFocus = this.boxManager.boxState !== TELE_BOX_STATE.Minimized;
            if (needFocus) {
                this.delegate.setAppFocus(appId, true);
            }
            const attrs = params.attributes ?? {};
            this.safeUpdateAttributes([appId], attrs);

            const appProxy = await this.baseInsertApp(params, appId, needFocus);
            return appProxy?.id;
        } catch (error) {
            throw error;
        }
    }

    public async closeApp(appId: string) {
        const appProxy = this.appProxies.get(appId);
        if (appProxy) {
            appProxy.destroy(true, true);
        }
    }

    private async baseInsertApp(params: BaseInsertParams, appId: string, focus?: boolean) {
        this.appStatus.set(appId, AppStatus.StartCreate);
        if (this.appProxies.has(appId)) {
            console.warn("[WindowManager]: app duplicate exists and cannot be created again");
            return;
        }
        const appProxy = new AppProxy(params, this, appId);
        if (appProxy) {
            await appProxy.baseInsertApp(focus);
            this.appStatus.delete(appId);
            return appProxy;
        } else {
            this.appStatus.delete(appId);
            throw new Error("");
        }
    }

    private displayerStateListener = (state: Partial<DisplayerState>) => {
        const sceneState = state.sceneState;
        if (sceneState) {
            const scenePath = sceneState.scenePath;
            this.appProxies.forEach((appProxy) => {
                if (appProxy.scenePath && scenePath.startsWith(appProxy.scenePath)) {
                    appProxy.emitAppSceneStateChange(sceneState);
                    if (sceneState.index !== appProxy.sceneIndex) {
                        appProxy.setSceneIndex(sceneState.index);
                    }
                }
            });
            this.viewManager.refreshViews();
        }
    };

    private displayerWritableListener = (isReadonly: boolean) => {
        if (this.windowManger.readonly === undefined) {
            this.boxManager.teleBoxManager.setReadonly(isReadonly);
        } else if (this.windowManger.readonly === false && isReadonly === true) {
            this.boxManager.teleBoxManager.setReadonly(isReadonly);
        }
        this.appProxies.forEach((appProxy) => {
            appProxy.emitAppIsWritableChange();
        });
    };

    private get eventName() {
        return isRoom(this.displayer)
            ? "onRoomStateChanged"
            : "onPlayerStateChanged";
    }

    public get attributes() {
        return this.windowManger.attributes;
    }

    public get canOperate() {
        return this.windowManger.canOperate;
    }

    public get room() {
        return this.canOperate ? (this.displayer as Room) : undefined;
    }

    public get mainView() {
        return this.windowManger.mainView;
    }

    public safeSetAttributes(attributes: any) {
        this.windowManger.safeSetAttributes(attributes);
    }

    public safeUpdateAttributes(keys: string[], value: any) {
        this.windowManger.safeUpdateAttributes(keys, value);
    }

    public setMainViewScenePath(scenePath: string) {
        if (this.room) {
            const scenePathType = this.displayer.scenePathType(scenePath);
            if (scenePathType === ScenePathType.None) {
                throw new Error(`${scenePath} not valid scene`);
            } else if (scenePathType === ScenePathType.Page) {
                this._setMainViewScenePath(scenePath);
            } else if (scenePathType === ScenePathType.Dir) {
                const validScenePath = makeValidScenePath(this.displayer, scenePath);
                this._setMainViewScenePath(validScenePath);
            }
        }
    }

    private _setMainViewScenePath(scenePath: string) {
        this.safeSetAttributes({ _mainScenePath: scenePath });
        this.viewManager.freedomAllViews();
        this.viewManager.switchMainViewToWriter();
        this.delegate.setMainViewFocusPath();
    }

    public setMainViewSceneIndex(index: number) {
        if (this.room) {
            this.safeSetAttributes({ _mainSceneIndex: index });
            this.viewManager.freedomAllViews();
            this.viewManager.switchMainViewToWriter();
            this.room.setSceneIndex(index);
            this.delegate.setMainViewScenePath(this.room.state.sceneState.scenePath);
            this.delegate.setMainViewFocusPath();
        }
    }

    public getAppInitPath(appId: string): string | undefined {
        const attrs = this.delegate.getAppAttributes(appId);
        if (attrs) {
            return attrs?.options?.scenePath;
        }
    }

    public safeDispatchMagixEvent(event: string, payload: any) {
        if (this.canOperate) {
            (this.displayer as Room).dispatchMagixEvent(event, payload);
        }
    }

    private eventListener = (eventName: string | number, payload: any) => {
        switch (eventName) {
            case "move": {
                this.dispatchIntenalEvent(Events.AppMove, payload);
                this.delegate.updateAppState(payload.appId, AppAttributes.Position, {
                    x: payload.x,
                    y: payload.y,
                });
                break;
            }
            case "focus": {
                this.windowManger.safeSetAttributes({ focus: payload.appId });
                const appProxy = this.appProxies.get(payload.appId);
                if (appProxy?.scenePath) {
                    this.dispatchIntenalEvent(Events.SwitchViewsToFreedom, {});
                    this.viewManager.switchAppToWriter(payload.appId);
                }
                this.dispatchIntenalEvent(Events.AppFocus, payload);
                break;
            }
            case "blur": {
                this.dispatchIntenalEvent(Events.AppBlur, payload);
                break;
            }
            case "resize": {
                if (payload.width && payload.height) {
                    this.dispatchIntenalEvent(Events.AppResize, payload);
                    this.delegate.updateAppState(payload.appId, AppAttributes.Size, {
                        width: payload.width,
                        height: payload.height,
                    });
                    this.room?.refreshViewSize();
                }
                break;
            }
            case TELE_BOX_STATE.Minimized: {
                this.safeDispatchMagixEvent(MagixEventName, {
                    eventName: Events.AppBoxStateChange, payload: {
                        ...payload,
                        state: eventName,
                    }
                });
                this.safeSetAttributes({ boxState: eventName });

                this.delegate.cleanFocus();
                this.boxManager.blurFocusBox();
                this.viewManager.freedomAllViews();
                this.viewManager.switchMainViewToWriter();
                break;
            }
            case TELE_BOX_STATE.Maximized: {
                this.safeDispatchMagixEvent(MagixEventName, {
                    eventName: Events.AppBoxStateChange, payload: {
                        ...payload,
                        state: eventName,
                    }
                });
                this.safeSetAttributes({ boxState: eventName });
                break;
            }
            case TELE_BOX_STATE.Normal: {
                this.safeDispatchMagixEvent(MagixEventName, {
                    eventName: Events.AppBoxStateChange, payload: {
                        ...payload,
                        state: eventName,
                    }
                });
                this.safeSetAttributes({ boxState: eventName });
                break;
            }
            case "snapshot": {
                this.safeDispatchMagixEvent(MagixEventName, {
                    eventName: Events.AppSnapshot, payload
                });

                this.delegate.updateAppState(
                    payload.appId,
                    AppAttributes.SnapshotRect,
                    payload.rect
                );
                break;
            }
            case "close": {
                this.safeDispatchMagixEvent(MagixEventName, {
                    eventName: Events.AppClose, payload
                });
                const appProxy = this.appProxies.get(payload.appId);
                if (appProxy) {
                    appProxy.destroy(false, true, payload.error);
                }
                setTimeout(() => { // view release 完成不能立马切, 可能会报错
                    this.viewManager.refreshViews();
                }, 100);
                break;
            }
            default:
                break;
        }
    };

    public focusByAttributes(apps: any) {
        if (apps && Object.keys(apps).length === this.boxManager!.appBoxMap.size) {
            const focusAppId = this.delegate.focus;
            if (focusAppId) {
                this.boxManager.focusBox({ appId: focusAppId });
            }
        }
    }

    public dispatchIntenalEvent(event: Events, payload: any) {
        this.safeDispatchMagixEvent(MagixEventName, {
            eventName: event,
            payload: payload
        });
    }

    public destroy() {
        this.displayer.callbacks.off(this.eventName, this.displayerStateListener);
        this.displayer.callbacks.off(
            "onEnableWriteNowChanged",
            this.displayerWritableListener
        );
        this.appListeners.removeListeners();
        emitter.offAny(this.eventListener);
        if (this.reactionDisposers.length) {
            this.reactionDisposers.map(disposer => disposer());
            this.reactionDisposers = [];
        }
        if (this.appProxies.size) {
            this.appProxies.forEach(appProxy => {
                appProxy.destroy(true, false);
            });
        }
        this.viewManager.destroy();
        callbacks.clearListeners();
    }
}

WindowManager.register(AppDocsViewer);
WindowManager.register(AppMediaPlayer);

export * from "./typings";
