import Emittery from 'emittery';
import PPT from './PPT';
import { AddComponentParams, BoxMap, WindowManagerWrapper } from './wrapper';
import {
    CameraState,
    Displayer,
    Event,
    InvisiblePlugin,
    InvisiblePluginContext,
    isRoom,
    Room,
    View,
    ViewVisionMode
    } from 'white-web-sdk';
import { Events, PluginAttributes } from './constants';
import { loadPlugin } from './loader';
import { WinBox } from './box/src/winbox';
import './box/css/winbox.css';
import './box/css/themes/modern.less';
import './style.css';

(window as any).PPT = PPT;


export type WindowMangerAttributes = {
    modelValue?: string,
    [key: string]: any,
}

export type Plugin = {
    kind: string;
    options: {
        width: number;
        height: number;

        minwidth?: number;
        minheight?: number;
        enableView?: boolean;
    };
    setup: (context: Context) => void;
    wrapper?: React.ReactNode;
}

export type Context = {
    displayer: Displayer;
    attributes: any,
    setAttributes: (attributes: { [key: string]: any }) => void;
    updateAttributes: (keys: string[], attributes: any) => void;
    on: (event: string, listener: () => void) => void;
    emit: (event: string, payload?: any) => void;
    off: (event: string, listener: () => void) => void;
    once: (event: string, listener: () => any) => void;
};


export type Plugins = {
    [key: string]: Plugin
}

export type AddPluginOptions = {
    ppt?: {
        scenePath: string;
    };
}

export type AddPluginLocalOptions = {
    isFirst: boolean;
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
    context: Context,
}

export const emitter: Emittery = new Emittery();

export class WindowManager extends InvisiblePlugin<WindowMangerAttributes> {
    public static kind: string = "WindowManager";
    public static instance: WindowManager;
    public static displayer: Displayer;
    public static viewsMap: Map<string, View> = new Map();
    public static emitterMap:Map<string, Emittery> = new Map();

    private instancePlugins: Map<string, Plugin> = new Map();
    private pluginListenerMap: Map<string, any> = new Map();


    constructor(context: InvisiblePluginContext) {
        super(context);
        emitter.onAny(this.eventListener);
        this.displayer.addMagixEventListener(Events.PluginMove, this.pluginMoveListener);
        this.displayer.addMagixEventListener(Events.PluginFocus, this.pluginFocusListener);
        this.displayer.addMagixEventListener(Events.PluginResize, this.pluginResizeListener);
        WindowManager.instance = this;
        WindowManager.displayer = this.displayer;
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
                instance.addPlugin(plugin.name, plugin.url, plugin.options);
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
                    this.addPlugin(plugin.name, plugin.url, plugin.options);
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
    public static async use(room: Room): Promise<WindowManager> {
        let manger = room.getInvisiblePlugin(WindowManager.kind);
        if (!manger) {
            manger = await room.createInvisiblePlugin(WindowManager, {});
        }
        (manger as any).enableCallbackUpdate = true;
        return manger as WindowManager;
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
        let plugin;
        if (url) {
            plugin = await loadPlugin(name, url);
        } else {
            plugin = localOptions?.plugin;
        }

        if (plugin) {
            const pluginId = this.generatePluginId(plugin.kind, options);
            this.addPluginToAttirbutes(pluginId, url, plugin, options, localOptions);
            await this.setupPlugin(pluginId, plugin, options, localOptions);
        } else {
            throw new Error(`plugin load failed ${name} ${url}`);
        }
    }

    /**
     * 插件 destory 回调
     *
     * @param {string} kind
     * @param {(error: Error) => void} listener
     * @memberof WindowManager
     */
    public onPluginDestory(kind: string, listener: (error: Error) => void) {
        emitter.once(`destory-${kind}`).then(listener);
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
                break;
            }
            case "resize": {
                this.safeDispatchMagixEvent(Events.PluginResize, payload);
                this.safeUpdateAttributes([payload.pluginId, PluginAttributes.Size], { width: payload.width, height: payload.height })
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
                this.destoryPlugin(payload.pluginId, false, payload.error, payload.errorInfo);
                break;
            }
            default:
                break;
        }
    }

    private destoryPlugin(pluginId: string, needCloseBox: boolean, error?: Error, errorInfo?: any,) {
        const pluginListener = this.pluginListenerMap.get(pluginId);
        const pluginEmitter = WindowManager.emitterMap.get(pluginId);
        const pluginInstance = this.instancePlugins.get(pluginId);
        if (pluginEmitter && pluginListener) {
            pluginEmitter.offAny(pluginListener);
        }
        if (pluginInstance) {
            emitter.emit(`destory-${pluginInstance.kind}`, { error, errorInfo });
        }
        this.instancePlugins.delete(pluginId);
        WindowManager.emitterMap.delete(pluginId);
        WindowManager.viewsMap.delete(pluginId);
        this.pluginListenerMap.delete(pluginId);
        this.safeUpdateAttributes(["plugins", pluginId], undefined);
        if (needCloseBox) {
            const box = this.getWindow(pluginId);
            box && box.closeForce();
        }
    }

    private pluginMoveListener = (event: Event) => {
        if (event.authorId !== this.displayer.observerId) {
            emitter.emit(Events.PluginMove, event.payload);
        }
    };

    private pluginFocusListener = (event: Event) => {
        if (event.authorId !== this.displayer.observerId) {
            emitter.emit(Events.PluginFocus, event.payload);
        }
    };

    private pluginResizeListener = (event: Event) => {
        if (event.authorId !== this.displayer.observerId) {
            emitter.emit(Events.PluginResize, event.payload);
        }
    };

    private addPluginToAttirbutes(
        pluginId: string, 
        url: string, 
        plugin: Plugin, 
        options?: AddPluginOptions,
        localOptions?: AddPluginLocalOptions, 
        ): void {
        if (localOptions?.isFirst) {
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
        const context: Context = {
            displayer: this.displayer,
            attributes: this.attributes[pluginId],
            setAttributes: this.makePluginSetAttibutes(pluginId),
            updateAttributes: this.makePluginUpdateAttributes(pluginId),
            on: (event, listener) => pluginEmitter.on(event, listener),
            emit: (event, payload) => pluginEmitter.emit(event, payload),
            off: (event, listener) => pluginEmitter.off(event, listener),
            once: (event, listener) => pluginEmitter.once(event).then(listener),
        }
        try {
            if (plugin.wrapper) {
                this.insertComponentToWrapper({
                    pluginId,
                    plugin,
                    emitter: pluginEmitter,
                    initScenePath: options.ppt?.scenePath,
                    pluginOptions: localOptions?.options,
                    context
                });
            }
            await plugin.setup(context);
            WindowManager.emitterMap.set(pluginId, pluginEmitter);
            emitter.once(`${pluginId}${Events.WindowCreated}`).then(() => {
                pluginEmitter.emit("create");
                const pluginLisener = this.makePluginEventListener(pluginId, options);
                pluginEmitter.onAny(pluginLisener);
                this.pluginListenerMap.set(pluginId, pluginLisener);
            });
        } catch (error) {
            throw new Error(`plugin setup error: ${JSON.stringify(error)}`);
        }
    }

    private makePluginSetAttibutes(pluginId: string) {
        return (payload: any) => {
            this.safeSetAttributes({ [pluginId]: payload });
        };
    }

    private makePluginUpdateAttributes(pluginId: string) {
        return (keys: string[], value: any) => {
            this.safeUpdateAttributes([pluginId, ...keys], value);
        };
    }

    private makePluginEventListener(pluginId: string, options: setPluginOptions) {
        return (eventName: string, data: any) => {
            switch (eventName) {
                case "setBoxSize": {
                    const box = BoxMap.get(pluginId);
                    if (box) {
                        box.resize(data.width, data.height);
                    }
                    break;
                }
                case "setBoxMinSize": {
                    const box = BoxMap.get(pluginId);
                    if (box) {
                        box.minwidth = data.minwidth;
                        box.minheight = data.minheight;
                    }
                    break;
                }
                case "destory": {
                    this.destoryPlugin(pluginId, true, data.error);
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
        let payload: AddComponentParams = { pluginId, node: plugin.wrapper, emitter, context };
        if (options.enableView) {
            const room = WindowManager.instance.displayer;
            const view = room.views.createView();
            view.mode = ViewVisionMode.Freedom;
            (view as any).cameraman.disableCameraTransform = true;
            if (initScenePath) {
                const viewScenes = room.entireScenes()[initScenePath];
                payload.scenes = viewScenes;
                payload.initScenePath = initScenePath;
            }
            payload.view = view;
            WindowManager.viewsMap.set(pluginId, view);
        }
        if (pluginOptions) {
            payload.options = pluginOptions;
        }
        WindowManagerWrapper.addComponent(payload);
    }

    private resize(name: string, width: number, height: number): void {
        const cameraState = this.displayer.state.cameraState;
        const newWidth = width / cameraState.width;
        const newHeight = height / cameraState.height;
        emitter.emit(Events.PluginResize, { name, width: newWidth, height: newHeight });
    }

    private getWindow(pluginId: string): WinBox | undefined {
        return BoxMap.get(pluginId);
    }

    public onDestroy() {
        emitter.offAny(this.eventListener);
    }

    private safeSetAttributes(attributes: any) {
        if (this.canOperate) {
            this.setAttributes(attributes);
        }
    }

    private safeUpdateAttributes(keys: string[], value: any) {
        console.log(keys, value);
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
        (this.displayer as Room).dispatchMagixEvent(event, payload);
    }
}

export * from "./wrapper";
