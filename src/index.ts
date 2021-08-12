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
    ViewVisionMode
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
}

type setPluginOptions = AddPluginOptions & { pluginOptions?: any };

type InsertComponentToWrapperParams = {
    pluginId: string;
    plugin: Plugin;
    emitter: Emittery<PluginEmitterEvent>;
    initScenePath?: string;
    pluginOptions?: any,
}

export type AddPluginParams = {
    kind: string;
    plugin: string | Plugin;
    options?: AddPluginOptions;
    pluginArgs?: any;
}

type PluginSyncAttributes = {
    kind: string,
    url?: string,
    options: any,
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
    public static emitterMap: Map<string, Emittery<PluginEmitterEvent>> = new Map();
    public static root: HTMLElement | null;
    public static viewManager: ViewManager;
    public static debug = false;
    public boxManager: BoxManager;
    public viewCameraManager: ViewCameraManager;

    private instancePlugins: Map<string, Plugin> = new Map();
    private pluginListenerMap: Map<string, any> = new Map();
    private pluginListeners: PluginListeners;


    constructor(context: InvisiblePluginContext) {
        super(context);
        emitter.onAny(this.eventListener);

        WindowManager.instance = this;
        WindowManager.displayer = this.displayer;
        this.viewCameraManager = new ViewCameraManager(this);
        WindowManager.viewManager = new ViewManager(this.displayer as Room, this, this.viewCameraManager);
        this.boxManager = new BoxManager(WindowManager.viewManager.mainView, this);
        this.pluginListeners = new PluginListeners(this.displayer, this.boxManager);
        this.displayer.callbacks.on(this.eventName, this.displayerStateListener);
        this.pluginListeners.addListeners();
    }

    /**
     * SDK 创建 window manager 自动调用
     *
     * @static
     * @param {WindowManager} instance
     * @memberof WindowManager
     */
    public static onCreate(instance: WindowManager) {
        const plugins = instance.attributes.plugins;
        if (plugins) {
            for (const id in plugins) {
                const plugin = plugins[id];
                if (plugin) {
                    instance.baseInsertPlugin({
                        kind: plugin.kind,
                        plugin: plugin.url,
                        options: plugin.options
                    });
                }
            }
        }
    }

    /**
     * 插件更新 attributes 时的回调
     *
     * @param {*} attributes
     * @memberof WindowManager
     */
    public onAttributesUpdate(attributes: any) {
        const plugins = attributes.plugins;
        if (plugins) {
            for (const id in plugins) {
                if (!this.instancePlugins.has(id)) {
                    const plugin = plugins[id];
                    this.baseInsertPlugin({
                        kind: plugin.kind,
                        plugin: plugin.url,
                        options: plugin.options
                    });
                }
            }
        }
        for (const [pluginId, pluginEmitter] of WindowManager.emitterMap.entries()) {
            const pluginAttributes = attributes[pluginId];
            if (pluginAttributes) {
                pluginEmitter.emit("attributesUpdate", pluginAttributes);
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
        (manger as any).enableCallbackUpdate = true;
        WindowManager.root = root;
        WindowManager.debug = Boolean(debug);
        (manger as WindowManager).boxManager.setupBoxManager();
        return manger as WindowManager;
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
        const baseResult = await this.baseInsertPlugin(params);
        if (baseResult) {
            this.addPluginToAttirbutes(baseResult.pluginId, params);
            this.instancePlugins.set(baseResult.pluginId, baseResult.plugin);
        }
    }

    private async baseInsertPlugin(params: AddPluginParams) {
        const pluginId = this.generatePluginId(params.kind, params.options);
        if (this.instancePlugins.get(pluginId)) {
            return;
        }

        if (params.kind && params.plugin) {
            const plugin = typeof params.plugin === "string" ? await loadPlugin(params.kind, params.plugin) : params.plugin;
            if (plugin) {
                await this.setupPlugin(pluginId, plugin, params.options, params.pluginArgs);
            } else {
                throw new Error(`plugin load failed ${params.kind} ${params.plugin}`);
            }
            this.boxManager.updateManagerRect();
            return {
                pluginId, plugin
            }
        } else {
            // throw new Error("kind and plugin is require");
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

    public getPluginInitState = (id: string) => {
        const pluginAttributes = this.attributes[id];
        if (!pluginAttributes) return;
        const position = pluginAttributes?.[PluginAttributes.Position];
        const focus = this.attributes.focus;
        const size = pluginAttributes?.[PluginAttributes.Size];
        const snapshotRect = pluginAttributes?.[PluginAttributes.SnapshotRect];
        const boxState = this.attributes["boxState"];
        let payload = { boxState } as PluginInitState;
        if (position) {
            payload = { ...payload, id: id, x: position.x, y: position.y };
        }
        if (focus === id) {
            payload = { ...payload, focus: true };
        }
        if (size) {
            payload = { ...payload, width: size.width, height: size.height };
        }
        if (snapshotRect) {
            payload = { ...payload, snapshotRect };
        }
        emitter.emit(Events.InitReplay, payload);
        return payload;
    }

    private eventListener = (eventName: string, payload: any) => {
        switch (eventName) {
            case "move": {
                this.safeDispatchMagixEvent(Events.PluginMove, payload);
                this.safeUpdateAttributes([payload.pluginId, PluginAttributes.Position], { x: payload.x, y: payload.y });
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
                this.safeUpdateAttributes([payload.pluginId, PluginAttributes.Size], { width: payload.width, height: payload.height });
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
                this.safeUpdateAttributes([payload.pluginId, PluginAttributes.SnapshotRect], payload.rect);
                break;
            }
            case "init": {
                this.getPluginInitState(payload.pluginId);
                break;
            }
            case "close": {
                this.destroyPlugin(payload.pluginId, false, payload.error);
                this.cleanPluginAttributes(payload.pluginId);
                break;
            }
            default:
                break;
        }
    }

    private destroyPlugin(pluginId: string, needCloseBox: boolean, error?: Error) {
        log("destroyPlugin", pluginId, needCloseBox, error);
        const pluginListener = this.pluginListenerMap.get(pluginId);
        const pluginEmitter = WindowManager.emitterMap.get(pluginId);
        const pluginInstance = this.instancePlugins.get(pluginId);
        if (pluginEmitter && pluginListener) {
            pluginEmitter.emit("destroy", { error });
            pluginEmitter.offAny(pluginListener);
        }
        if (pluginInstance) {
            emitter.emit(`destroy-${pluginInstance.kind}`, { error });
        }
        this.instancePlugins.delete(pluginId);
        WindowManager.emitterMap.delete(pluginId);
        this.pluginListenerMap.delete(pluginId);
        this.safeUpdateAttributes(["plugins", pluginId], undefined);
        if (needCloseBox) {
            this.boxManager.closeBox(pluginId);
            WindowManager.viewManager.destoryView(pluginId);
        }
    }

    private cleanPluginAttributes(pluginId: string) {
        this.safeSetAttributes({ [pluginId]: undefined });
        const focus = this.attributes["focus"];
        if (focus === pluginId) {
            this.safeSetAttributes({ focus: undefined });
        }
    }

    private displayerStateListener = (state: Partial<DisplayerState>) => {
        if (state.sceneState) {
            const scenePath = state.sceneState.scenePath;
            this.instancePlugins.forEach((_, id) => {
                const initPath = this.getPluginInitPath(id);
                if (initPath && scenePath.startsWith(initPath)) {
                    this.emitToPlugin(id, "sceneStateChange", state.sceneState);
                }
            });
        }
    }

    private addPluginToAttirbutes(pluginId: string, params: AddPluginParams): void {
        if (!this.attributes[pluginId]) {
            this.safeSetAttributes({
                [pluginId]: {
                    [PluginAttributes.Size]: { width: 0, height: 0 },
                    [PluginAttributes.Position]: { x: 0, y: 0 },
                    [PluginAttributes.SnapshotRect]: {},
                },
                focus: pluginId,
            });
        }
        if (!this.attributes.plugins) {
            this.safeSetAttributes({ plugins: {} });
        }
        let pluginAttributes: PluginSyncAttributes = { kind: params.kind, options: params.options };
        if (typeof params.plugin === "string") {
            pluginAttributes.url = params.plugin;
        }
        this.safeUpdateAttributes(["plugins", pluginId], pluginAttributes);
    }

    private async setupPlugin(pluginId: string, plugin: Plugin, options?: setPluginOptions, localOptions?: any) {
        log("setupPlugin", pluginId, plugin, options, localOptions);
        const pluginEmitter: Emittery<PluginEmitterEvent> = new Emittery();
        const context = new PluginContext(this, pluginId, pluginEmitter);
        try {
            WindowManager.emitterMap.set(pluginId, pluginEmitter);
            emitter.once(`${pluginId}${Events.WindowCreated}`).then(() => {
                const boxInitState = this.getPluginInitState(pluginId);
                log("WindowCreated", boxInitState);
                this.boxManager.updateBox(boxInitState);
                pluginEmitter.emit("create", undefined);
                const pluginLisener = this.makePluginEventListener(pluginId);
                pluginEmitter.onAny(pluginLisener);
                this.pluginListenerMap.set(pluginId, pluginLisener);
            });
            await plugin.setup(context, localOptions);
            this.insertComponentToWrapper({
                pluginId,
                plugin,
                emitter: pluginEmitter,
                initScenePath: options?.scenePath,
                pluginOptions: localOptions,
            });
        } catch (error) {
            throw new Error(`plugin setup error: ${error.message}`);
        }
    }

    private makePluginEventListener(pluginId: string) {
        return (eventName: PluginListenerKeys, data: any) => {
            switch (eventName) {
                case "setBoxSize": {
                    this.boxManager.resizeBox({
                        pluginId,
                        width: data.width,
                        height: data.height,
                    });
                    break;
                }
                case "setBoxMinSize": {
                    this.boxManager.setBoxMinSize({
                        pluginId,
                        minWidth: data.minwidth,
                        minHeight: data.minheight
                    });
                    break;
                }
                case "setBoxTitle": {
                    this.boxManager.setBoxTitle({ pluginId, title: data.title });
                    break;
                }
                case PluginEvents.destroy: {
                    this.destroyPlugin(pluginId, true, data.error);
                }
                default:
                    break;
            }
        }
    }

    private generatePluginId(kind: string, options?: AddPluginOptions) {
        if (options && options.scenePath) {
            return `${kind}-${options.scenePath}`;
        } else {
            return kind;
        }
    }

    private insertComponentToWrapper(params: InsertComponentToWrapperParams) {
        log("insertComponentToWrapper", params);
        const { pluginId, plugin, emitter, pluginOptions } = params;
        let payload: any = { pluginId, emitter, plugin };

        if (pluginOptions) {
            payload.options = pluginOptions;
        }
        this.boxManager.createBox(payload);
    }

    public onDestroy() {
        emitter.offAny(this.eventListener);
        this.displayer.callbacks.off(this.eventName, this.displayerStateListener);
        this.pluginListeners.removeListeners();
    }

    public safeSetAttributes(attributes: any) {
        if (this.canOperate) {
            this.setAttributes(attributes);
        }
        (this as any).enableCallbackUpdate = true;
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

    private emitToPlugin(pluginId: string, event: PluginListenerKeys, payload: any) {
        const pluginEmitter = WindowManager.emitterMap.get(pluginId);
        if (pluginEmitter) {
            pluginEmitter.emit(event, payload);
        }
    }
}

export * from "./typings";
