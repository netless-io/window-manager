import Emittery from 'emittery';
import PPT from './PPT';
import { NetlessApp } from './typings';
import { AppCreateError } from './error';
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
    ViewVisionMode
    } from 'white-web-sdk';
import { BoxManager, TeleBoxState } from './BoxManager';
import { log } from './log';
import { ViewCameraManager } from './ViewCameraManager';
import { ViewManager } from './ViewManager';
import './style.css';
import 'telebox-insider/dist/style.css';
import {
    Events,
    AppAttributes,
    AppEvents,
} from "./constants";

(window as any).PPT = PPT;


export type WindowMangerAttributes = {
    modelValue?: string,
    boxState: TeleBoxState,
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
    boxState: TeleBoxState,
}

export const emitter: Emittery = new Emittery();

export class WindowManager extends InvisiblePlugin<WindowMangerAttributes> {
    public static kind: string = "WindowManager";
    public static displayer: Displayer;
    public static root: HTMLElement | null;
    public static debug = false;

    public appListeners?: AppListeners;
    public static appClasses: Map<string, NetlessApp> = new Map();

    private appManager?: AppManager;

    constructor(context: InvisiblePluginContext) {
        super(context);
    }

    public static onCreate() {
        emitter.emit("onCreated");
    }

    /**
     * 初始化插件
     * 
     * @static
     * @param {Room} room
     * @returns {Promise<WindowManager>}
     * @memberof WindowManager
     */
    public static async use(room: Room, root: HTMLElement, debug?: boolean): Promise<WindowManager> {
        let manager = room.getInvisiblePlugin(WindowManager.kind);
        if (!manager) {
            manager = await room.createInvisiblePlugin(WindowManager, {});
        }
        this.root = root;
        this.debug = Boolean(debug);
        (manager as WindowManager).appManager = new AppManager(manager as WindowManager);
        emitter.emit("onCreated");
        return manager as WindowManager;
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
        return this.appManager?.viewManager.mainView!;
    }

    /**
     * 创建一个 app 至白板
     *
     * @param {AddAppParams} params
     * @memberof WindowManager
     */
    public async addApp(params: AddAppParams) {
        this.appManager?.addApp(params);
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
        this.appManager?.destroy();
    }
}

export class AppManager {
    public displayer: Displayer;
    public boxManager: BoxManager;
    public viewCameraManager: ViewCameraManager;
    public viewManager: ViewManager;
    public appProxies: Map<string, AppProxy> = new Map();

    private appListeners: AppListeners;
    private attributesDisposer: any;
    private allAppsCreated = false;

    constructor(
        private windowManger: WindowManager,
    ) {
        this.displayer = windowManger.displayer;
        this.viewCameraManager = new ViewCameraManager();
        this.viewManager = new ViewManager(this.displayer as Room, this, this.viewCameraManager);
        this.boxManager = new BoxManager(this.viewManager.mainView, this.appProxies);
        this.appListeners = new AppListeners(this.displayer, this.boxManager, this.viewManager, this.appProxies);
        this.displayer.callbacks.on(this.eventName, this.displayerStateListener);
        this.displayer.callbacks.on("onEnableWriteNowChanged", this.displayerWritableListener);
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
                        options: app.options
                    });
                    this.focusByAttributes(apps);
                }
            }
        }
    }
    
    public async addApp(params: AddAppParams) {
        log("addApp", params);
        try {
            const appProxy = await this.baseInsertApp(params);
            if (appProxy) {
                appProxy.setupAttributes(params.attributes);
            }
        } catch (error) {
            if (error instanceof AppCreateError) {
                console.log(error);
            }
        }
    }
    
    private async baseInsertApp(params: BaseInsertParams) {
        const id = AppProxy.genId(params.kind, params.options);
        if (this.appProxies.has(id)) {
            return;
        }
        const appProxy = new AppProxy(params, this, this.boxManager, this.appProxies);
        if (appProxy) {
            await appProxy.baseInsertApp();
            return appProxy;
        } else {
            console.log("app create failed", params);
        }
    }

    private displayerStateListener = (state: Partial<DisplayerState>) => {
        const sceneState = state.sceneState
        if (sceneState) {
            const scenePath = sceneState.scenePath;
            this.appProxies.forEach((appProxy) => {
                if (appProxy.scenePath && scenePath.startsWith(appProxy.scenePath)) {
                    appProxy.emitAppSceneStateChange(sceneState);
                }
            });
        }
    }

    private displayerWritableListener = () => {
        this.appProxies.forEach((appProxy) => {
            appProxy.emitAppIsWritableChange(this.displayer.enableWriteNow);
        });
    }

    private get eventName() {
        return isRoom(this.displayer) ? "onRoomStateChanged" : "onPlayerStateChanged";
    }

    public get canOperate() {
        if (isRoom(this.displayer)) {
            return (this.displayer as Room).isWritable;
        } else {
            return false;
        }
    }

    public get attributes() {
        return this.windowManger.attributes;
    }

    public get room() {
        return isRoom(this.displayer) ? this.displayer as Room : undefined;
    }

    public getAppInitPath(appId: string): string | undefined {
        const attrs = this.attributes["apps"][appId];
        if (attrs) {
            return attrs?.options.scenePath;
        }
    }


    public safeSetAttributes(attributes: any) {
        if (this.canOperate) {
            this.windowManger.setAttributes(attributes);
        }
    }

    public safeUpdateAttributes(keys: string[], value: any) {
        if (this.canOperate) {
            this.windowManger.updateAttributes(keys, value);
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
                this.updateAppState(payload.appId, AppAttributes.Position, { x: payload.x, y: payload.y });
                break;
            }
            case "focus": {
                if (!this.allAppsCreated) return;
                this.safeDispatchMagixEvent(Events.AppFocus, payload);
                this.safeSetAttributes({ focus: payload.appId });
                this.viewManager.swtichViewToWriter(payload.appId);
                break;
            }
            case "blur": {
                this.safeDispatchMagixEvent(Events.AppBlur, payload);
            }
            case "resize": {
                if (!this.allAppsCreated) return;
                if (payload.width && payload.height) {
                    this.safeDispatchMagixEvent(Events.AppResize, payload);
                    this.updateAppState(payload.appId, AppAttributes.Size, { width: payload.width, height: payload.height });
                }
                break;
            }
            case TeleBoxState.Minimized:
            case TeleBoxState.Maximized:
            case TeleBoxState.Normal: {
                this.safeDispatchMagixEvent(Events.AppBoxStateChange, {...payload, state: eventName });
                this.safeSetAttributes({ boxState: eventName });
                break;
            }
            case "snapshot": {
                this.safeDispatchMagixEvent(Events.AppSnapshot, payload);
                this.updateAppState(payload.appId, AppAttributes.SnapshotRect, payload.rect);
                break;
            }
            case "close": {
                const appProxy = this.appProxies.get(payload.appId);
                if (appProxy) {
                    appProxy.destroy(false, payload.error)
                }
                break;
            }
            default:
                break;
        }
    }

    public focusByAttributes(apps: any) {
        if (apps && Object.keys(apps).length === this.boxManager!.appBoxMap.size) {
            const focusAppId = this.attributes.focus;
            if (focusAppId) {
                this.boxManager!.focusBox({ appId: focusAppId });
            }
            this.allAppsCreated = true;
        }
    }

    public destroy() {
        this.displayer.callbacks.off(this.eventName, this.displayerStateListener);
        this.displayer.callbacks.off("onEnableWriteNowChanged", this.displayerWritableListener);
        this.appListeners.removeListeners();
        emitter.offAny(this.eventListener);
        this.attributesDisposer();
    }
}

export * from "./typings";
