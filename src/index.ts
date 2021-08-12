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
import { loadPlugin } from "./loader";
import { log } from "./log";
import { Plugin, PluginEmitterEvent, PluginListenerKeys } from "./typings";
import { PluginContext } from "./PluginContext";
import { PluginListeners } from "./PluginListener";
import { ViewCameraManager } from "./ViewCameraManager";
import { ViewManager } from "./ViewManager";
import "./style.css";
import "telebox-insider/dist/style.css";
import {
    Events,
    PluginAttributes,
    PluginEvents,
} from "./constants";
import get from "lodash.get";
import { PluginProxy } from "./PluginProxy";
import { PluginCreateError } from "./error";

(window as any).PPT = PPT;


export type WindowMangerAttributes = {
    modelValue?: string,
    boxState: TeleBoxState,
    [key: string]: any,
}

export type Plugins = {
    [key: string]: Plugin
}

export type AddPluginOptions = {
    scenePath?: string;
    title?: string;
}

export type setPluginOptions = AddPluginOptions & { pluginOptions?: any };

export type InsertComponentToWrapperParams = {
    pluginId: string;
    plugin: Plugin;
    emitter: Emittery<PluginEmitterEvent>;
    initScenePath?: string;
    pluginOptions?: any,
    options?: AddPluginOptions
}

export type AddPluginParams = {
    kind: string;
    plugin?: string;
    options?: AddPluginOptions;
    pluginArgs?: any;
}

export type PluginSyncAttributes = {
    kind: string,
    url?: string,
    options: any,
    state?: any
}

export type PluginInitState = {
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

    public pluginListeners: PluginListeners;
    public pluginProxies: Map<string, PluginProxy> = new Map();
    private attributesDisposer: any;
    public static pluginClasses: Map<string, Plugin> = new Map();

    constructor(context: InvisiblePluginContext) {
        super(context);
        emitter.onAny(this.eventListener);

        WindowManager.instance = this;
        WindowManager.displayer = this.displayer;
        this.viewCameraManager = new ViewCameraManager(this);
        WindowManager.viewManager = new ViewManager(this.displayer as Room, this, this.viewCameraManager);
        this.boxManager = new BoxManager(WindowManager.viewManager.mainView, this);
        this.pluginListeners = new PluginListeners(this.displayer, this.boxManager, this);
        this.displayer.callbacks.on(this.eventName, this.displayerStateListener);
        this.pluginListeners.addListeners();
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
        const plugins = attributes.plugins;
        if (plugins) {
            for (const id in plugins) {
                if (!this.pluginProxies.has(id)) {
                    const plugin = plugins[id];
                    let pluginClass = plugin.url;
                    if (!pluginClass) {
                        pluginClass = WindowManager.pluginClasses.get(plugin.kind);
                    }
                    this.baseInsertPlugin({
                        kind: plugin.kind,
                        plugin: pluginClass,
                        options: plugin.options
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
     * @param {Plugin} plugin
     * @memberof WindowManager
     */
    public static register(plugin: Plugin) {
        this.pluginClasses.set(plugin.kind, plugin);
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
     * 创建一个插件至白板
     *
     * @param {AddPluginParams} params
     * @memberof WindowManager
     */
    public async addPlugin(params: AddPluginParams) {
        log("addPlugin", params);
        try {
            const pluginProxy = await this.baseInsertPlugin(params);
            if (pluginProxy) {
                pluginProxy.setupAttributes();
            }
        } catch (error) {
            if (error instanceof PluginCreateError) {
                console.log(error);
            }
        }
    }

    private async baseInsertPlugin(params: AddPluginParams) {
        const id = PluginProxy.genId(params.kind, params.options);
        if (this.pluginProxies.has(id)) {
            return;
        }
        const pluginProxy = new PluginProxy(params, this, this.boxManager);
        if (pluginProxy) {
            await pluginProxy.baseInsertPlugin();
            return pluginProxy;
        } else {
            console.log("plugin create failed", params);
        }
    }

    /**
     * 插件 destroy 回调
     *
     * @param {string} kind
     * @param {(error: Error) => void} listener
     * @memberof WindowManager
     */
    public onPluginDestroy(kind: string, listener: (error: Error) => void) {
        emitter.once(`destroy-${kind}`).then(listener);
    }

    private eventListener = (eventName: string, payload: any) => {
        switch (eventName) {
            case "move": {
                this.safeDispatchMagixEvent(Events.PluginMove, payload);
                this.updatePluginState(payload.pluginId, PluginAttributes.Position, { x: payload.x, y: payload.y });
                break;
            }
            case "focus": {
                this.safeDispatchMagixEvent(Events.PluginFocus, payload);
                this.safeSetAttributes({ focus: payload.pluginId });
                WindowManager.viewManager.swtichViewToWriter(payload.pluginId);
                break;
            }
            case "blur": {
                this.safeDispatchMagixEvent(Events.PluginBlur, payload);
            }
            case "resize": {
                this.safeDispatchMagixEvent(Events.PluginResize, payload);
                this.updatePluginState(payload.pluginId, PluginAttributes.Size, { width: payload.width, height: payload.height });
                break;
            }
            case TeleBoxState.Minimized:
            case TeleBoxState.Maximized:
            case TeleBoxState.Normal: {
                this.safeDispatchMagixEvent(Events.PluginBoxStateChange, {...payload, state: eventName });
                this.setAttributes({ boxState: eventName });
                break;
            }
            case "snapshot": {
                this.safeDispatchMagixEvent(Events.PluginSnapshot, payload);
                this.updatePluginState(payload.pluginId, PluginAttributes.SnapshotRect, payload.rect);
                break;
            }
            case "close": {
                const pluginProxy = this.pluginProxies.get(payload.pluginId);
                if (pluginProxy) {
                    pluginProxy.destroy(false, payload.error)
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
            this.pluginProxies.forEach((pluginProxy) => {
                if (pluginProxy.scenePath && scenePath.startsWith(pluginProxy.scenePath)) {
                    pluginProxy.emitPluginSceneStateChange(sceneState);
                }
            });
        }
    }

    public onDestroy() {
        emitter.offAny(this.eventListener);
        this.displayer.callbacks.off(this.eventName, this.displayerStateListener);
        this.pluginListeners.removeListeners();
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

    public getPluginInitPath(pluginId: string): string | undefined {
        const pluginAttributes = this.attributes["plugins"][pluginId];
        if (pluginAttributes) {
            return pluginAttributes?.options.scenePath;
        }
    }

    private updatePluginState(pluginId: string, stateName: PluginAttributes, state: any) {
        this.safeUpdateAttributes(["plugins", pluginId, "state", stateName], state);
    }
}

export * from "./typings";
