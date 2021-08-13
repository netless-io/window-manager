import Emittery from "emittery";
import PPT from './PPT';
import { BoxManager, TeleBoxState } from "./BoxManager";
import {
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
    autorun
} from 'white-web-sdk';
import { log } from "./log";
import { App, AppEmitterEvent, AppListenerKeys } from "./typings";
import { AppListeners } from "./AppListener";
import { ViewCameraManager } from "./ViewCameraManager";
import { ViewManager } from "./ViewManager";
import "./style.css";
import "telebox-insider/dist/style.css";
import {
    Events,
    AppAttributes,
    AppEvents,
} from "./constants";
import { AppProxy } from "./AppProxy";
import { AppCreateError } from "./error";

(window as any).PPT = PPT;


export type WindowMangerAttributes = {
    modelValue?: string,
    boxState: TeleBoxState,
    [key: string]: any,
}

export type apps = {
    [key: string]: App
}

export type AddAppOptions = {
    scenePath?: string;
    title?: string;
}

export type setAppOptions = AddAppOptions & { appOptions?: any };

export type AddAppParams = {
    kind: string;
    // 插件地址(本地插件不需要传)
    src?: string;
    // 窗口配置
    options?: AddAppOptions;
    // 初始化 attributes
    attributes?: any;
}

type BaseInsertParams = {
    kind: string;
    // 插件地址(本地插件不需要传)
    src?: string;
    // 窗口配置
    options?: AddAppOptions;
    // 初始化 attributes
    attributes?: any;
    appClass?: App;
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
    public static instance: WindowManager;
    public static displayer: Displayer;
    public static root: HTMLElement | null;
    public static viewManager: ViewManager;
    public static debug = false;
    public boxManager: BoxManager;
    public viewCameraManager: ViewCameraManager;

    public appListeners: AppListeners;
    public appProxies: Map<string, AppProxy> = new Map();
    private attributesDisposer: any;
    public static appClasses: Map<string, App> = new Map();

    constructor(context: InvisiblePluginContext) {
        super(context);
        emitter.onAny(this.eventListener);

        WindowManager.instance = this;
        WindowManager.displayer = this.displayer;
        this.viewCameraManager = new ViewCameraManager(this);
        WindowManager.viewManager = new ViewManager(this.displayer as Room, this, this.viewCameraManager);
        this.boxManager = new BoxManager(WindowManager.viewManager.mainView, this);
        this.appListeners = new AppListeners(this.displayer, this.boxManager, this);
        this.displayer.callbacks.on(this.eventName, this.displayerStateListener);
        this.appListeners.addListeners();
        setTimeout(() => {
            this.attributesDisposer = autorun(() => {
                const attributes = this.attributes;
                this.attributesUpdateCallback(attributes);
            });
        }, 50);
    }

    /**
     * 插件更新 attributes 时的回调
     *
     * @param {*} attributes
     * @memberof WindowManager
     */
    public attributesUpdateCallback(attributes: any) {
        const apps = attributes.apps;
        if (apps) {
            for (const id in apps) {
                if (!this.appProxies.has(id)) {
                    const app = apps[id];
                    let appImpl = app.src;
                    if (!appImpl) {
                        appImpl = WindowManager.appClasses.get(app.kind);
                    }
                    this.baseInsertApp({
                        kind: app.kind,
                        src: appImpl,
                        options: app.options
                    });
                }
            }
        }
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
        let manger = room.getInvisiblePlugin(WindowManager.kind);
        if (!manger) {
            manger = await room.createInvisiblePlugin(WindowManager, {});
        }
        this.root = root;
        this.debug = Boolean(debug);
        (manger as WindowManager).boxManager.setupBoxManager();
        return manger as WindowManager;
    }

    /**
     * 注册插件
     *
     * @param {App} app
     * @memberof WindowManager
     */
    public static register(app: App) {
        this.appClasses.set(app.kind, app);
    }

    /**
     * 创建 main View
     *
     * @returns {View}
     * @memberof WindowManager
     */
    public createMainView(): View {
        return WindowManager.viewManager.mainView;
    }

    /**
     * 创建一个 app 至白板
     *
     * @param {AddAppParams} params
     * @memberof WindowManager
     */
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
        const appProxy = new AppProxy(params, this, this.boxManager);
        if (appProxy) {
            await appProxy.baseInsertApp();
            return appProxy;
        } else {
            console.log("app create failed", params);
        }
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

    private eventListener = (eventName: string, payload: any) => {
        switch (eventName) {
            case "move": {
                this.safeDispatchMagixEvent(Events.AppMove, payload);
                this.updateAppState(payload.appId, AppAttributes.Position, { x: payload.x, y: payload.y });
                break;
            }
            case "focus": {
                this.safeDispatchMagixEvent(Events.AppFocus, payload);
                this.safeSetAttributes({ focus: payload.appId });
                WindowManager.viewManager.swtichViewToWriter(payload.appId);
                break;
            }
            case "blur": {
                this.safeDispatchMagixEvent(Events.AppBlur, payload);
            }
            case "resize": {
                this.safeDispatchMagixEvent(Events.AppResize, payload);
                this.updateAppState(payload.appId, AppAttributes.Size, { width: payload.width, height: payload.height });
                break;
            }
            case TeleBoxState.Minimized:
            case TeleBoxState.Maximized:
            case TeleBoxState.Normal: {
                this.safeDispatchMagixEvent(Events.AppBoxStateChange, {...payload, state: eventName });
                this.setAttributes({ boxState: eventName });
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

    public onDestroy() {
        emitter.offAny(this.eventListener);
        this.displayer.callbacks.off(this.eventName, this.displayerStateListener);
        this.appListeners.removeListeners();
        this.attributesDisposer();
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

    public get canOperate() {
        if (isRoom(this.displayer)) {
            return (this.displayer as Room).isWritable;
        } else {
            return false;
        }
    }

    private safeDispatchMagixEvent(event: string, payload: any) {
        if (this.canOperate) {
            (this.displayer as Room).dispatchMagixEvent(event, payload);
        }
    }

    public get room() {
        return isRoom(this.displayer) ? this.displayer as Room : undefined;
    }

    private get eventName() {
        return isRoom(this.displayer) ? "onRoomStateChanged" : "onPlayerStateChanged";
    }

    public getAppInitPath(appId: string): string | undefined {
        const attrs = this.attributes["apps"][appId];
        if (attrs) {
            return attrs?.options.scenePath;
        }
    }

    private updateAppState(appId: string, stateName: AppAttributes, state: any) {
        this.safeUpdateAttributes(["apps", appId, "state", stateName], state);
    }
}

export * from "./typings";
