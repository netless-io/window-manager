import Emittery from 'emittery';
import { NetlessApp } from './typings';
import { AppCreateError, AppManagerNotInitError, ParamsInvalidError, WhiteWebSDKInvalidError } from './error';
import { AppListeners } from './AppListener';
import { AppProxy } from './AppProxy';
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
    View,
    ViewVisionMode,
    SceneDefinition,
    WhiteVersion
} from 'white-web-sdk';
import { BoxManager, TELE_BOX_STATE } from './BoxManager';
import { log } from './log';
import { CameraStore } from './CameraStore';
import { setupWrapper, ViewManager } from './ViewManager';
import './style.css';
import '@netless/telebox-insider/dist/style.css';
import {
    Events,
    AppAttributes,
    AppEvents,
    REQUIRE_VERSION,
    AppStatus,
} from "./constants";
import { AttributesDelegate } from './AttributesDelegate';
import AppDocsViewer from "@netless/app-docs-viewer";
import PPT from "./PPT";
import { setScenePath, setViewFocusScenePath, ViewSwitcher } from './ViewSwitcher';

(window as any).PPT = PPT;


export const BuildinApps = {
    DocsViewer: AppDocsViewer.kind as string
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

export const emitter: Emittery = new Emittery();

export class WindowManager extends InvisiblePlugin<WindowMangerAttributes> {
    public static kind: string = "WindowManager";
    public static displayer: Displayer;
    public static wrapper: HTMLElement | null;
    public static debug = false;
    private static isCreated = false;

    public appListeners?: AppListeners;
    public static appClasses: Map<string, NetlessApp> = new Map();

    private appManager?: AppManager;

    constructor(context: InvisiblePluginContext) {
        super(context);
    }

    /**
     * 添加一个 app 到白板
     *
     * @static
     * @param {Room} room
     * @param {HTMLElement} continaer
     * @param {HTMLElement} [collector]
     * @param {{ debug: boolean }} [options]
     * @returns {Promise<WindowManager>}
     * @memberof WindowManager
     */
    public static async mount(room: Room, continaer: HTMLElement, collector?: HTMLElement, options?: { debug: boolean }): Promise<WindowManager> {
        this.checkVersion();
        if (!continaer) {
            throw new Error("[WindowManager]: Continaer must provide");
        }
        if (WindowManager.isCreated) {
            throw new Error("[WindowManager]: Already created cannot be created again");
        }
        let manager = room.getInvisiblePlugin(WindowManager.kind) as WindowManager;
        if (!manager) {
            manager = await room.createInvisiblePlugin(WindowManager, {}) as WindowManager;
        }
        this.debug = Boolean(options?.debug);
        const { mainViewElement } = setupWrapper(continaer);
        manager.appManager = new AppManager(manager, collector);
        manager.bindMainView(mainViewElement);
        emitter.emit("onCreated");
        WindowManager.isCreated = true;
        return manager;
    }

    /**
     * 注册插件
     *
     * @param {NetlessApp} app
     * @memberof WindowManager
     */
    public static register(app: NetlessApp) {
        this.appClasses.set(app.kind, app);
    }

    /**
     * 创建 main View
     *
     * @returns {View}
     * @memberof WindowManager
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
     *
     * @param {AddAppParams} params
     * @memberof WindowManager
     */
    public async addApp(params: AddAppParams) {
        if (this.appManager) {
            if (!params.kind || typeof params.kind !== "string") {
                throw new ParamsInvalidError();
            }
            let isDynamicPPT = false;
            if (params.options) {
                const { scenePath, scenes } = params.options;
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
     *
     * @param {string} appId
     * @memberof AppManager
     */
    public async closeApp(appId: string) {
        return this.appManager?.closeApp(appId);
    }

    /**
     * 设置 mainView 的 ScenePath, 并且切换白板为可写状态
     *
     * @param {string} scenePath
     * @memberof WindowManager
     */
    public setMainViewScenePath(scenePath: string) {
        if (this.appManager) {
            this.appManager.setMainViewScenePath(scenePath);
            this.safeDispatchMagixEvent(Events.SetMainViewScenePath, { scenePath });
        }
    }

    /**
     * 设置 mainView 的 SceneIndex, 并且切换白板为可写状态
     *
     * @param {number} index
     * @memberof WindowManager
     */
    public setMainViewSceneIndex(index: number) {
        if (this.appManager) {
            this.appManager.setMainViewSceneIndex(index);
            this.safeDispatchMagixEvent(Events.SetMainViewSceneIndex, { index });
        }
    }

    /**
     * 切换 mainView 为可写
     *
     * @memberof WindowManager
     */
    public switchMainViewToWriter() {
        this.appManager?.viewManager.switchMainViewToWriter();
    }

    /**
     * app destroy 回调
     *
     * @param {string} kind
     * @param {(error: Error) => void} listener
     * @memberof WindowManager
    */
    public onAppDestroy(kind: string, listener: (error: Error) => void) {
        emitter.once(`destroy-${kind}`).then(listener);
    }

    public get mainView() {
        return this.appManager!.viewManager.mainView;
    }

    public get camera() {
        return this.appManager!.viewManager.mainView.camera;
    }

    public onDestroy() {
        this._destroy();
    }

    public destroy() {
        this._destroy();
        super.destroy();
    }

    private _destroy() {
        this.appManager?.destroy();
        WindowManager.isCreated = false;
    }

    private bindMainView(divElement: HTMLDivElement) {
        if (this.appManager) {
            const mainView = this.appManager.viewManager.mainView;
            mainView.divElement = divElement;
            const scenePath = this.appManager.delegate.getMainViewScenePath();
            const sceneIndex = this.appManager.delegate.getMainViewSceneIndex();
            const sceneName = this.getSceneName(scenePath, sceneIndex);
            if (scenePath) {
                setViewFocusScenePath(mainView, sceneName ? scenePath + `/${sceneName}` : scenePath);
            } else {
                this.setMainViewScenePath(this.displayer.state.sceneState.scenePath);
            }
        }
    }

    public get canOperate() {
        if (isRoom(this.displayer)) {
            return (this.displayer as Room).isWritable;
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
    public viewSwitcher = new ViewSwitcher(this);

    private appListeners: AppListeners;
    private attributesDisposer: any;

    constructor(public windowManger: WindowManager, collector?: HTMLElement) {
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
            collector
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
            this.attributesDisposer = autorun(() => {
                const apps = this.attributes.apps;
                this.attributesUpdateCallback(apps);
            });
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
                    });
                    this.focusByAttributes(apps);
                }
            }
        }
    }

    public async addApp(params: AddAppParams, isDynamicPPT: boolean): Promise<string> {
        log("addApp", params);
        const id = AppProxy.genId(params.kind, params.options);
        if (this.appProxies.has(id)) {
            throw new AppCreateError();
        }
        try {
            this.appStatus.set(id, AppStatus.StartCreate);
            this.delegate.setupAppAttributes(params, id, isDynamicPPT);
            this.safeSetAttributes({ [id]: params.attributes || {} });

            const appProxy = await this.baseInsertApp(params, true);
            return appProxy.id;
        } catch (error) {
            this.delegate.cleanAppAttributes(id);
            throw error;
        }
    }

    public async closeApp(appId: string) {
        const appProxy = this.appProxies.get(appId);
        if (appProxy) {
            appProxy.destroy(true);
        }
    }

    private async baseInsertApp(params: BaseInsertParams, focus?: boolean) {
        const id = AppProxy.genId(params.kind, params.options);
        if (this.appProxies.has(id)) {
            throw new AppCreateError();
        }
        const appProxy = new AppProxy(params, this);
        if (appProxy) {
            await appProxy.baseInsertApp(focus);
            this.appStatus.set(id, AppStatus.CreateSuccess);
            return appProxy;
        } else {
            this.appStatus.delete(id);
            throw new Error()
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
        }
    };

    private displayerWritableListener = (isReadonly: boolean) => {
        this.boxManager.teleBoxManager.setReadonly(isReadonly);
        this.appProxies.forEach((appProxy) => {
            appProxy.emitAppIsWritableChange(!isReadonly);
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
            this.safeSetAttributes({ _mainScenePath: scenePath });
            this.viewManager.switchMainViewToWriter();
            setScenePath(this.room, scenePath);
        }
    }

    public setMainViewSceneIndex(index: number) {
        if (this.room) {
            this.safeSetAttributes({ _mainSceneIndex: index });
            this.viewManager.switchMainViewToWriter();
            this.room.setSceneIndex(index);
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

    private eventListener = (eventName: string, payload: any) => {
        switch (eventName) {
            case "move": {
                this.safeDispatchMagixEvent(Events.AppMove, payload);
                this.delegate.updateAppState(payload.appId, AppAttributes.Position, {
                    x: payload.x,
                    y: payload.y,
                });
                break;
            }
            case "focus": {
                this.windowManger.safeSetAttributes({ focus: payload.appId });
                this.viewSwitcher.refreshViews();
                this.safeDispatchMagixEvent(Events.AppFocus, payload);
                break;
            }
            case "blur": {
                this.safeDispatchMagixEvent(Events.AppBlur, payload);
                break;
            }
            case "resize": {
                if (payload.width && payload.height) {
                    this.safeDispatchMagixEvent(Events.AppResize, payload);
                    this.delegate.updateAppState(payload.appId, AppAttributes.Size, {
                        width: payload.width,
                        height: payload.height,
                    });
                    this.room?.refreshViewSize();
                }
                break;
            }
            case TELE_BOX_STATE.Minimized: {
                this.safeDispatchMagixEvent(Events.AppBoxStateChange, {
                    ...payload,
                    state: eventName,
                });
                this.safeSetAttributes({ boxState: eventName });
                this.viewManager.switchWritableAppToFreedom();
                this.delegate.cleanFocus();
                this.boxManager.blurFocusBox();
                this.viewManager.switchMainViewToWriter();
                const mainViewScenePath = this.delegate.getMainViewScenePath();
                if (mainViewScenePath) {
                    setScenePath(this.room, mainViewScenePath);
                }
                this.safeDispatchMagixEvent(Events.MainViewFocus, {});
                break;
            }
            case TELE_BOX_STATE.Maximized: {
                this.safeDispatchMagixEvent(Events.AppBoxStateChange, {
                    ...payload,
                    state: eventName,
                });
                this.safeSetAttributes({ boxState: eventName });
                break;
            }
            case TELE_BOX_STATE.Normal: {
                this.safeDispatchMagixEvent(Events.AppBoxStateChange, {
                    ...payload,
                    state: eventName,
                });
                this.safeSetAttributes({ boxState: eventName });
                break;
            }
            case "snapshot": {
                this.safeDispatchMagixEvent(Events.AppSnapshot, payload);
                this.delegate.updateAppState(
                    payload.appId,
                    AppAttributes.SnapshotRect,
                    payload.rect
                );
                break;
            }
            case "close": {
                this.safeDispatchMagixEvent(Events.AppClose, payload);
                const appProxy = this.appProxies.get(payload.appId);
                if (appProxy) {
                    appProxy.destroy(false, payload.error);
                }
                this.viewManager.switchWritableAppToFreedom();
                const mainViewScenePath = this.delegate.getMainViewScenePath();
                if (mainViewScenePath) {
                    setViewFocusScenePath(this.mainView, mainViewScenePath);
                }
                if (this.displayer.views.writableView) {
                    this.displayer.views.writableView.mode = ViewVisionMode.Freedom;
                }
                setTimeout(() => { // view release 完成不能立马切, 可能会报错
                    this.viewManager.switchMainViewToWriter();
                    const mainViewScenePath = this.delegate.getMainViewScenePath();
                    if (mainViewScenePath) {
                        setScenePath(this.room, mainViewScenePath);
                    }
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

    public destroy() {
        this.displayer.callbacks.off(this.eventName, this.displayerStateListener);
        this.displayer.callbacks.off(
            "onEnableWriteNowChanged",
            this.displayerWritableListener
        );
        this.appListeners.removeListeners();
        emitter.offAny(this.eventListener);
        this.attributesDisposer();
        if (this.appProxies.size) {
            this.appProxies.forEach(appProxy => {
                appProxy.destroy(true);
            });
        }
        this.viewManager.destroy();
        this.delegate.cleanAttributes();
    }
}

WindowManager.register(AppDocsViewer);

export * from "./typings";
