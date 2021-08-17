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
    INVISIBLE_APPS,
} from "./constants";
import { AttributesDelegate } from './AttributesDelegate';
import AppDocsViewer from "@netless/app-docs-viewer";
import PPT from "./PPT";

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

type BaseInsertParams = {
    kind: string;
    // app 地址(本地 app 不需要传)
    src?: string;
    // 窗口配置
    options?: AddAppOptions;
    // 初始化 attributes
    attributes?: any;
}

export type AppSyncAttributes = {
    kind: string,
    src?: string,
    options: any,
    state?: any
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
    private invisableAppEmitter = new Emittery<{
        attributesUpdate: { appId: string, attributes: any }
    }>();
    private appsDisposer: Map<string, any> = new Map();

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
    public addApp(params: AddAppParams) {
        if (this.appManager) {
            if (!params.kind || typeof params.kind !== "string") {
                throw new ParamsInvalidError();
            }
            this.appManager.addApp(params);
        } else {
            throw new AppManagerNotInitError();
        }
    }

    public get mainView() {
        return this.appManager!.viewManager.mainView;
    }

    public get camera() {
        return this.appManager!.viewManager.mainView.camera;
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

    public onDestroy() {
        this._destroy();
    }

    public unmount() {
       this._destroy();
    }

    private _destroy() {
        this.appManager?.destroy();
        super.onDestroy();
        if (this.appsDisposer.size) {
            this.appsDisposer.forEach(disposer => disposer());
        }
        this.invisableAppEmitter.clearListeners();
        WindowManager.isCreated = false;
    }

    public registerInvisibleApp(appId: string) {
        if (!this.attributes[INVISIBLE_APPS]) {
            this.safeSetAttributes({ [INVISIBLE_APPS]: {} });
        }
        this.safeUpdateAttributes([INVISIBLE_APPS, appId], {});
        const disposer = autorun(() => {
            const attrs = this.attributes[INVISIBLE_APPS][appId];
            this.invisableAppEmitter.emit("attributesUpdate", { appId: appId, attributes: attrs });
        });
        this.appsDisposer.set(appId, disposer);
    }

    public unregisterInvisibleApp(appId: string) {
        if (!this.attributes[INVISIBLE_APPS]) {
            return;
        }
        this.safeUpdateAttributes([INVISIBLE_APPS, appId], undefined);
        const disposer = this.appsDisposer.get(appId);
        if (disposer) {
            disposer();
            this.appsDisposer.delete(appId);
        }
    }

    public updateInvisibleAppAttributes(appId: string, key: string, value: any) {
        if (!this.appsDisposer.has(appId)) {
            throw new Error("[WindowManager]: before update invisible app attributes, must register invisible app");
        }
        if (!this.attributes[INVISIBLE_APPS][appId]) {
            this.safeUpdateAttributes([INVISIBLE_APPS, appId], {});
        }
        this.safeUpdateAttributes([INVISIBLE_APPS, appId, key], value);
    }

    private bindMainView(divElement: HTMLDivElement) {
        if (this.appManager) {
            const mainView = this.appManager.viewManager.mainView;
            mainView.divElement = divElement;
        }
    }
    public get canOperate() {
        if (isRoom(this.displayer)) {
            return (this.displayer as Room).isWritable;
        } else {
            return false;
        }
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
    public delegate = new AttributesDelegate(this);

    private appListeners: AppListeners;
    private attributesDisposer: any;

    constructor(private windowManger: WindowManager, collector?: HTMLElement) {
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
            this.displayer,
            this.boxManager,
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
                if (!this.appProxies.has(id)) {
                    const app = apps[id];
                    let appImpl = app.src;
                    if (!appImpl) {
                        appImpl = WindowManager.appClasses.get(app.kind);
                    }
                    await this.baseInsertApp({
                        kind: app.kind,
                        src: appImpl,
                        options: app.options,
                    });
                    this.focusByAttributes(apps);
                }
            }
        }
    }

    public async addApp(params: AddAppParams) {
        log("addApp", params);
        const id = AppProxy.genId(params.kind, params.options);
        if (this.appProxies.has(id)) {
            return;
        }
        try {
            this.delegate.setupAppAttributes(params, id);
            this.safeSetAttributes({ [id]: params.attributes });
            const appProxy = await this.baseInsertApp(params, true);
            if (appProxy) {
                if (params.options?.scenePath) {
                    this.setupScenePath(params.options.scenePath);
                }
                this.viewManager.swtichViewToWriter(id);
            }
        } catch (error) {
            if (error instanceof AppCreateError) {
                console.log(error);
                if (this.attributes[id]) {
                    this.safeSetAttributes({ [id]: undefined });
                }
            }
            this.delegate.cleanAppAttributes(id);
        }
    }

    private async baseInsertApp(params: BaseInsertParams, focus?: boolean) {
        const id = AppProxy.genId(params.kind, params.options);
        if (this.appProxies.has(id)) {
            return;
        }
        const appProxy = new AppProxy(params, this);
        if (appProxy) {
            await appProxy.baseInsertApp(focus);
            return appProxy;
        } else {
            console.log("app create failed", params);
        }
    }

    private setupScenePath(scenePath: string) {
        const scenes = this.displayer.entireScenes()[scenePath];
        if (!scenes) {
            this.room?.putScenes(scenePath, [{ name: "1" }]);
        }
    }

    private displayerStateListener = (state: Partial<DisplayerState>) => {
        const sceneState = state.sceneState;
        if (sceneState) {
            const scenePath = sceneState.scenePath;
            this.appProxies.forEach((appProxy) => {
                if (appProxy.scenePath && scenePath.startsWith(appProxy.scenePath)) {
                    appProxy.emitAppSceneStateChange(sceneState);
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

    public safeSetAttributes(attributes: any) {
        this.windowManger.safeSetAttributes(attributes);
    }

    public safeUpdateAttributes(keys: string[], value: any) {
        this.windowManger.safeUpdateAttributes(keys, value);
    }

    public getAppInitPath(appId: string): string | undefined {
        const attrs = this.delegate.getAppAttributes(appId);
        if (attrs) {
            return attrs?.options?.scenePath;
        }
    }

    private updateAppState(appId: string, stateName: AppAttributes, state: any) {
        this.safeUpdateAttributes(["apps", appId, "state", stateName], state);
    }

    private safeDispatchMagixEvent(event: string, payload: any) {
        if (this.canOperate) {
            (this.displayer as Room).dispatchMagixEvent(event, payload);
        }
    }

    private eventListener = (eventName: string, payload: any) => {
        switch (eventName) {
            case "move": {
                this.safeDispatchMagixEvent(Events.AppMove, payload);
                this.updateAppState(payload.appId, AppAttributes.Position, {
                    x: payload.x,
                    y: payload.y,
                });
                break;
            }
            case "focus": {
                this.safeDispatchMagixEvent(Events.AppFocus, payload);
                this.windowManger.safeSetAttributes({ focus: payload.appId });
                this.viewManager.swtichViewToWriter(payload.appId);
                break;
            }
            case "blur": {
                this.safeDispatchMagixEvent(Events.AppBlur, payload);
                break;
            }
            case "resize": {
                if (payload.width && payload.height) {
                    this.safeDispatchMagixEvent(Events.AppResize, payload);
                    this.updateAppState(payload.appId, AppAttributes.Size, {
                        width: payload.width,
                        height: payload.height,
                    });
                }
                break;
            }
            case TELE_BOX_STATE.Minimized: {
                this.safeDispatchMagixEvent(Events.AppBoxStateChange, {
                    ...payload,
                    state: eventName,
                });
                this.safeSetAttributes({ boxState: eventName });
                this.viewManager.switchMainViewToWriter();
                this.delegate.cleanFocus();
                this.boxManager.blurAllBox();
                break;
            }
            case TELE_BOX_STATE.Maximized: {
                this.safeDispatchMagixEvent(Events.AppBoxStateChange, {
                    ...payload,
                    state: eventName,
                });
                this.safeSetAttributes({ boxState: eventName });
                this.swtichFocusAppToWritable();
                break;
            }
            case TELE_BOX_STATE.Normal: {
                this.safeDispatchMagixEvent(Events.AppBoxStateChange, {
                    ...payload,
                    state: eventName,
                });
                this.safeSetAttributes({ boxState: eventName });
                this.swtichFocusAppToWritable();
                break;
            }
            case "snapshot": {
                this.safeDispatchMagixEvent(Events.AppSnapshot, payload);
                this.updateAppState(
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
                break;
            }
            default:
                break;
        }
    };

    private swtichFocusAppToWritable() {
        const focusAppId = this.delegate.focus;
        if (focusAppId) {
            const view = this.viewManager.getView(focusAppId);
            if (view) {
                this.viewManager.swtichViewToWriter(focusAppId);
            }
        }
    }

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
