import {
    InvisiblePlugin, InvisiblePluginContext, Room, Event,
    View, ViewVisionMode, CameraState, Displayer, isRoom
} from "white-web-sdk";
import Emittery from "emittery";
import { loadPlugin } from "./loader";
import { AddComponentParams, WindowManagerWrapper } from "./wrapper";
import PPT from "./PPT";

(window as any).PPT = PPT;

import "./box/css/winbox.css";
import "./box/css/themes/modern.less";
import "./style.css";
import { WinBox } from "./box/src/winbox";
import { ReactNode } from "react";

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
        maxheight?: number;
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

export const emitter: Emittery = new Emittery();

export enum EventNames {
    PluginMove = "PluginMove",
    PluginFocus = "PluginFocus",
    PluginResize = "PluginResize",
    GetAttributes = "GetAttributes",
    UpdateWindowManagerWrapper = "UpdateWindowManagerWrapper",
    InitReplay = "InitReplay",
    WindowCreated = "WindowCreated",
}

export enum PluginAttributes {
    Size = "size",
    Position = "position",
}

export type AddPluginOptions = {
    ppt?: {
        scenePath: string;
    };
    isFirst: boolean;
    plugin?: Plugin,
    options?: () => Promise<any>;
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
        this.displayer.addMagixEventListener(EventNames.PluginMove, this.pluginMoveListener);
        this.displayer.addMagixEventListener(EventNames.PluginFocus, this.pluginFocusListener);
        this.displayer.addMagixEventListener(EventNames.PluginResize, this.pluginResizeListener);
        WindowManager.instance = this;
        WindowManager.displayer = this.displayer;
    }

    public static onCreate(instance: WindowManager) {
        const plugins = instance.attributes.plugins;
        if (plugins) {
            for (const [_, plugin] of Object.entries(plugins)) {
                instance.addPlugin((plugin as any).name, (plugin as any).url, { isFirst: false });
            }
        }
    }

    public onAttributesUpdate(attributes: any) {
        const plugins = attributes.plugins;
        if (plugins) {
            for (const [name, plugin] of Object.entries(plugins)) {
                if (!this.instancePlugins.has(name)) {
                    this.addPlugin(name, (plugin as any).url, { isFirst: false });
                }
            }
        }
        console.log("onAttributesUpdate", attributes);
    }

    private pluginMoveListener = (event: Event) => {
        if (event.authorId !== this.displayer.observerId) {
            emitter.emit(EventNames.PluginMove, event.payload);
        }
    };

    private pluginFocusListener = (event: Event) => {
        if (event.authorId !== this.displayer.observerId) {
            emitter.emit(EventNames.PluginFocus, event.payload);
        }
    };

    private pluginResizeListener = (event: Event) => {
        if (event.authorId !== this.displayer.observerId) {
            emitter.emit(EventNames.PluginResize, event.payload);
        }
    };

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
        emitter.emit(EventNames.InitReplay, {});
    }

    private eventListener = (eventName: string, payload: any) => {
        switch (eventName) {
            case "move": {
                this.safeDispatchMagixEvent(EventNames.PluginMove, payload);
                this.safeUpdateAttributes([payload.pluginId, PluginAttributes.Position], { x: payload.x, y: payload.y });
                break;
            }
            case "focus": {
                this.safeDispatchMagixEvent(EventNames.PluginFocus, payload);
                this.safeSetAttributes({ focus: payload.pluginId });
                break;
            }
            case "resize": {
                this.safeDispatchMagixEvent(EventNames.PluginResize, payload);
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
                const pluginListener = this.pluginListenerMap.get(payload.pluginId);
                const pluginEmitter = WindowManager.emitterMap.get(payload.pluginId);
                if (pluginEmitter && pluginListener) {
                    pluginEmitter.offAny(pluginListener);
                }
                this.instancePlugins.delete(payload.pluginId);
                WindowManager.emitterMap.delete(payload.pluginId);
                WindowManager.viewsMap.delete(payload.pluginId);
                this.pluginListenerMap.delete(payload.pluginId);
                break;
            }
            default:
                break;
        }
    }

    public static async use(room: Room): Promise<WindowManager> {
        let manger = room.getInvisiblePlugin(WindowManager.kind);
        if (!manger) {
            manger = await room.createInvisiblePlugin(WindowManager, {});
        }
        return manger as WindowManager;
    }

    public async addPlugin(name: string, url: string, options: AddPluginOptions) {
        let plugin;
        if (url) {
            plugin = await loadPlugin(name, url);
        } else {
            plugin = options?.plugin;
        }

        if (plugin) {
            const pluginId = this.generatePluginId(plugin.kind, options);
            this.addPluginToAttirbutes(pluginId, url, options, plugin);
            if (options.options) {
                const pluginOptions = await options.options();
                await this.setupPlugin(pluginId, plugin, { ...options, pluginOptions })
            } else {
                await this.setupPlugin(pluginId, plugin, options);
            }
        } else {
            throw new Error(`plugin load failed ${name} ${url}`);
        }
    }

    private addPluginToAttirbutes(pluginId: string, url: string, options: AddPluginOptions, plugin: Plugin): void {
        if (options.isFirst) {
            this.safeSetAttributes({ [pluginId]: {
                [PluginAttributes.Size]: { width: 0, height: 0 },
                [PluginAttributes.Position]: { x: 0, y: 0 }
            } });
        }
        if (!this.attributes.plugins) {
            this.safeSetAttributes({ plugins: {} });
        }
        this.safeUpdateAttributes(["plugins", pluginId], { url });
        this.instancePlugins.set(pluginId, plugin);
    }

    private async setupPlugin(pluginId: string, plugin: Plugin, options: setPluginOptions) {
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
                    pluginOptions: options.pluginOptions,
                    context
                });
            }
            await plugin.setup(context);
            WindowManager.emitterMap.set(pluginId, pluginEmitter);
            emitter.once(`${pluginId}${EventNames.WindowCreated}`).then(() => {
                pluginEmitter.emit("create");
                const pluginLisener = this.makePluginEventListener(pluginId);
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

    private makePluginEventListener(pluginId: string) {
        return (eventName: string, data: any) => {
            switch (eventName) {
                case "setBoxSize": {
                    const box = WindowManagerWrapper.winboxMap.get(pluginId);
                    if (box) {
                        box.resize(data.width, data.height);
                    }
                    break;
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

    public resize(name: string, width: number, height: number): void {
        const cameraState = this.displayer.state.cameraState;
        const newWidth = width / cameraState.width;
        const newHeight = height / cameraState.height;
        emitter.emit(EventNames.PluginResize, { name, width: newWidth, height: newHeight });
    }

    public getWindow(name: string): WinBox | undefined {
        return WindowManagerWrapper.winboxMap.get(name);
    }

    public getRoomCameraState(): CameraState {
        return this.displayer.state.cameraState;
    }

    public onWindowCreated(name: string, listener: any) {
        emitter.on(`${name}${EventNames.WindowCreated}`, listener);
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
