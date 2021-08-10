import Emittery from 'emittery';
import PPT from './PPT';
import { BoxManager, TeleBoxState } from './BoxManager';
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
import { debug, log } from './log';
import {
    Events,
    PluginAttributes,
    PluginEvents,
    PluginListenerEvents
    } from './constants';
import { loadPlugin } from './loader';
import { Plugin } from './typings';
import { PluginContext } from './PluginContext';
import { ViewManager } from './ViewManager';
import './style.css';
import 'telebox-insider/dist/style.css';
import { PluginListeners } from './PluginListener';

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
    ppt?: {
        scenePath: string;
    };
}

export type AddPluginLocalOptions = {
    plugin?: Plugin;
    options?: any;
}

type setPluginOptions = AddPluginOptions & { pluginOptions?: any };

type InsertComponentToWrapperParams = {
    pluginId: string;
    plugin: Plugin;
    emitter: Emittery;
    initScenePath?: string;
    pluginOptions?: any,
    context: PluginContext,
}

export const emitter: Emittery = new Emittery();

export class WindowManager extends InvisiblePlugin<WindowMangerAttributes> {
    public static kind: string = "WindowManager";
    public static instance: WindowManager;
    public static displayer: Displayer;
    public static emitterMap:Map<string, Emittery> = new Map();
    public static root: HTMLElement | null;
    public static viewManager: ViewManager;
    public boxManager: BoxManager;

    private instancePlugins: Map<string, Plugin> = new Map();
    private pluginListenerMap: Map<string, any> = new Map();
    private pluginListeners: PluginListeners;


    constructor(context: InvisiblePluginContext) {
        super(context);
        emitter.onAny(this.eventListener);
        
        WindowManager.instance = this;
        WindowManager.displayer = this.displayer;
        WindowManager.viewManager = new ViewManager(this.displayer as Room, this);
        this.boxManager = new BoxManager(WindowManager.viewManager.mainView, this);
        this.pluginListeners = new PluginListeners(this, this.displayer, this.boxManager);
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
                    instance.baseInsertPlugin(plugin.name, plugin.url, plugin.options);
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
                    this.baseInsertPlugin(plugin.name, plugin.url, plugin.options);
                }
            }
        }
        for (const [pluginId, pluginEmitter] of WindowManager.emitterMap.entries()) {
            const pluginAttributes = plugins[pluginId];
            if (pluginAttributes) {
                pluginEmitter.emit(PluginListenerEvents.attributesUpdate, pluginAttributes);
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
    public static async use(room: Room, root: HTMLElement): Promise<WindowManager> {
        let manger = room.getInvisiblePlugin(WindowManager.kind);
        if (!manger) {
            manger = await room.createInvisiblePlugin(WindowManager, {});
        }
        (manger as any).enableCallbackUpdate = true;
        WindowManager.root = root;
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

    /**`
     * 创建一个插件至白板
     * 
     * @param {string} name
     * @param {string} url
     * @param {AddPluginOptions} options
     * @memberof WindowManager
     */
    public async addPlugin(name: string, url: string, options: AddPluginOptions, localOptions?: AddPluginLocalOptions) {
        const baseResult = await this.baseInsertPlugin(name, url, options, localOptions);
        if (baseResult) {
            this.addPluginToAttirbutes(baseResult.pluginId, url, baseResult.plugin, options, localOptions);
        }
    }

    private async baseInsertPlugin(name: string, url: string, options: AddPluginOptions, localOptions?: AddPluginLocalOptions) {
        const pluginId = this.generatePluginId(name, options);
        if (this.instancePlugins.get(pluginId)) {
            return;
        }
        if ((name && url) || localOptions?.plugin) {
            const plugin = localOptions?.plugin ? localOptions.plugin : await loadPlugin(name, url);
            if (plugin) {
                await this.setupPlugin(pluginId, plugin, options, localOptions);
            } else {
                throw new Error(`plugin load failed ${name} ${url}`);
            }
            this.boxManager.updateManagerRect();
            return {
                pluginId, plugin
            }
        } else {
            // throw new Error("name or url is require");
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

    private onPluginBoxInit = (name: string) => {
        const pluginAttributes = this.attributes[name];
        const position = pluginAttributes?.[PluginAttributes.Position];
        const focus = this.attributes.focus;
        const size = pluginAttributes?.[PluginAttributes.Size];
        let payload = {};
        if (position) {
            payload = { name: name, x: position.x, y: position.y };
        }
        if (focus) {
            payload = { ...payload, focus: true };
        }
        if (size) {
            payload = { ...payload, width: size.width, height: size.height };
        }
        emitter.emit(Events.InitReplay, {});
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
            case TeleBoxState.Minimized: {
                this.safeDispatchMagixEvent(Events.PluginMinimize, payload);
                this.setAttributes({ boxState: TeleBoxState.Minimized });
                break;
            }
            case TeleBoxState.Maximized: {
                this.safeDispatchMagixEvent(Events.PluginMaximize, payload);
                this.setAttributes({ boxState: TeleBoxState.Maximized });
                break;
            }
            case "init": {
                this.onPluginBoxInit(payload.pluginId);
                this.safeSetAttributes({ [payload.pluginId]: {
                    [PluginAttributes.Position]: {}
                 } });
                break;
            }
            case "close": {
                this.destroyPlugin(payload.pluginId, false, payload.error, payload.errorInfo);
                break;
            }
            default:
                break;
        }
    }

    private destroyPlugin(pluginId: string, needCloseBox: boolean, error?: Error, errorInfo?: any,) {
        const pluginListener = this.pluginListenerMap.get(pluginId);
        const pluginEmitter = WindowManager.emitterMap.get(pluginId);
        const pluginInstance = this.instancePlugins.get(pluginId);
        if (pluginEmitter && pluginListener) {
            pluginEmitter.emit(PluginListenerEvents.destroy, { error, errorInfo });
            pluginEmitter.offAny(pluginListener);
        }
        if (pluginInstance) {
            emitter.emit(`destroy-${pluginInstance.kind}`, { error, errorInfo });
        }
        this.instancePlugins.delete(pluginId);
        WindowManager.emitterMap.delete(pluginId);
        this.pluginListenerMap.delete(pluginId);
        this.safeUpdateAttributes(["plugins", pluginId], undefined);
        // BoxMap.delete(pluginId);
        if (needCloseBox) {
            // const box = this.getWindow(pluginId);
            // box && box.closeForce();
        }
    }

    private displayerStateListener = (state: Partial<DisplayerState>) => {
        if (state.sceneState) {
            const scenePath = state.sceneState.scenePath;
            this.instancePlugins.forEach((_, id) => {
                const initPath = this.getPluginInitPath(id);
                if (initPath && scenePath.startsWith(initPath)) {
                    this.emitToPlugin(id, PluginListenerEvents.sceneStateChange, state.sceneState);
                }
            });
        }
    }

    private addPluginToAttirbutes(
        pluginId: string, 
        url: string, 
        plugin: Plugin, 
        options?: AddPluginOptions,
        localOptions?: AddPluginLocalOptions, 
        ): void {
        if (!this.attributes[pluginId]) {
            this.safeSetAttributes({ [pluginId]: {
                [PluginAttributes.Size]: { width: 0, height: 0 },
                [PluginAttributes.Position]: { x: 0, y: 0 }
            } });
        }
        if (!this.attributes.plugins) {
            this.safeSetAttributes({ plugins: {} });
        }
        this.safeUpdateAttributes(["plugins", pluginId], { url, options });
        this.instancePlugins.set(pluginId, plugin);
    }

    private async setupPlugin(pluginId: string, plugin: Plugin, options: setPluginOptions, localOptions?: AddPluginLocalOptions) {
        const pluginEmitter: Emittery = new Emittery();
        const context = new PluginContext(this, pluginId, pluginEmitter);
        try {
            WindowManager.emitterMap.set(pluginId, pluginEmitter);
            emitter.once(`${pluginId}${Events.WindowCreated}`).then(() => {
                pluginEmitter.emit(PluginListenerEvents.create);
                const pluginLisener = this.makePluginEventListener(pluginId, options);
                pluginEmitter.onAny(pluginLisener);
                this.pluginListenerMap.set(pluginId, pluginLisener);
            });
            await plugin.setup(context);
            this.insertComponentToWrapper({
                pluginId,
                plugin,
                emitter: pluginEmitter,
                initScenePath: options.ppt?.scenePath,
                pluginOptions: localOptions?.options,
                context
            });
        } catch (error) {
            throw new Error(`plugin setup error: ${error.message}`);
        }
    }

    private makePluginEventListener(pluginId: string, options: setPluginOptions) {
        return (eventName: string, data: any) => {
            switch (eventName) {
                case PluginEvents.setBoxSize: {
                    this.boxManager.resizeBox({
                        pluginId,
                        width: data.width,
                        height: data.height,
                    });
                    break;
                }
                case PluginEvents.setBoxMinSize: {
                    this.boxManager.setBoxMinSize({
                        pluginId,
                        minWidth: data.minwidth,
                        minHeight: data.minHeight
                    });
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

    private generatePluginId(kind: string, options: AddPluginOptions) {
        if (options.ppt) {
            return `${kind}-${options.ppt.scenePath}`;
        } else {
            return kind;
        }
    }

    private insertComponentToWrapper({ pluginId, plugin, emitter, initScenePath, pluginOptions, context }: InsertComponentToWrapperParams) {
        const options = plugin.options;
        let payload: any = { pluginId, node: plugin.wrapper, emitter, context, plugin };
        if (options.enableView) {
            const room = this.displayer;
            const view = WindowManager.viewManager.createView(payload.pluginId);
            const mainViewElement = WindowManager.viewManager.mainView.divElement;
            if (!mainViewElement) {
                throw new Error(`create plugin main view must bind divElement`);
            }
            WindowManager.viewManager.addMainViewListener();
            (view as any).cameraman.disableCameraTransform = true;
            if (initScenePath) {
                const viewScenes = room.entireScenes()[initScenePath];
                if (viewScenes) {
                    payload.scenes = viewScenes;
                    payload.initScenePath = initScenePath;
                    view.focusScenePath = `${initScenePath}/${viewScenes[0].name}`;
                }
            }
            payload.view = view;
        }
        if (pluginOptions) {
            payload.options = pluginOptions;
        }
        this.boxManager.createBox(payload);
        if (this.canOperate) {
            WindowManager.viewManager.swtichViewToWriter(pluginId);
        }
    }

    private resize(name: string, width: number, height: number): void {
        const cameraState = this.displayer.state.cameraState;
        const newWidth = width / cameraState.width;
        const newHeight = height / cameraState.height;
        emitter.emit(Events.PluginResize, { name, width: newWidth, height: newHeight });
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
            return pluginAttributes?.options?.ppt.scenePath;
        }
    }

    private emitToPlugin(pluginId: string, event: string, payload: any) {
        const pluginEmitter = WindowManager.emitterMap.get(pluginId);
        if (pluginEmitter) {
            pluginEmitter.emit(event, payload);
        }
    }
}

export * from "./typings";
