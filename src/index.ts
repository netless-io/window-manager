import { InvisiblePlugin, InvisiblePluginContext, Room, Event, View, ViewVisionMode, CameraState } from "white-web-sdk";
import Emittery from "emittery";
import { loadPlugin } from "./loader";
import { WindowManagerWrapper } from "./wrapper";
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
        heigth: number;
    }
    setup: (context: Context) => void;
    wrapper: React.ReactNode;
}

export type Context = {
    room: Room;
    attributes: any,
    setAttributes: (attributes: { [key: string]: any }) => void;
    updateAttributes: (keys: string[], attributes: any) => void;
    on: (event: string, listener: () => void) => void;
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
}

export class WindowManager extends InvisiblePlugin<WindowMangerAttributes> {
    public static kind: string = "WindowManager";
    public static instance: WindowManager;
    public static boardElement: HTMLDivElement | null = null;
    private instancePlugins: Map<string, Plugin> = new Map();
    public viewMap: Map<string, View> = new Map();

    constructor(context: InvisiblePluginContext) {
        super(context);
        emitter.onAny(this.eventListener);
        this.displayer.addMagixEventListener(EventNames.PluginMove, this.pluginMoveListener);
        this.displayer.addMagixEventListener(EventNames.PluginFocus, this.pluginFocusListener);
        this.displayer.addMagixEventListener(EventNames.PluginResize, this.pluginResizeListener);
        WindowManager.instance = this;
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
    }

    public updatePluginAttributes(name: string, keys: string[], value: any) {
        this.updateAttributes([name, ...keys], value);
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
                const room = this.displayer as Room;
                room.dispatchMagixEvent(EventNames.PluginMove, payload);
                this.updateAttributes([payload.name, PluginAttributes.Position], { x: payload.x, y: payload.y });
                break;
            }
            case "focus": {
                const room = this.displayer as Room;
                room.dispatchMagixEvent(EventNames.PluginFocus, payload);
                this.setAttributes({ focus: payload.name });
                break;
            }
            case "resize": {
                const room = this.displayer as Room;
                room.dispatchMagixEvent(EventNames.PluginResize, payload);
                this.updateAttributes([payload.name, PluginAttributes.Size], { width: payload.width, height: payload.height })
                break;
            }
            case "init": {
                this.onPluginBoxInit(payload.name);
                break;
            }
            case "close": {
                this.instancePlugins.delete(payload.name);
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
        WindowManager.boardElement = (room as any).cameraObserver.mainView.divElement;
        return manger as WindowManager;
    }

    public async addPlugin(name: string, url: string, options: AddPluginOptions) {
        const plugin = await loadPlugin(name, url);
        if (plugin) {
            if (options.isFirst) {
                this.setAttributes({ [name]: { 
                    [PluginAttributes.Size]: { width: 0, height: 0 },
                    [PluginAttributes.Position]: { x: 0, y: 0 }
                } });
            }
            this.addPluginToAttirbutes({ name, url });
            this.setupPlugin(plugin, options);
        } else {
            throw new Error(`plugin load failed ${name} ${url}`);
        }
    }

    private async setupPlugin(plugin: Plugin, options: AddPluginOptions) {
        const pluginEmitter: Emittery = new Emittery();
        const context: Context = {
            room: this.displayer as Room,
            attributes: this.attributes,
            setAttributes: this.makePluginSetAttibutes(plugin.kind),
            updateAttributes: this.makePluginUpdateAttributes(plugin.kind),
            on: (event, listener) => pluginEmitter.on(event, listener),
            off: (event, listener) => pluginEmitter.off(event, listener),
            once: (event, listener) => pluginEmitter.once(event).then(listener),
        }
        this.insertComponentToWrapper(plugin.kind, plugin.wrapper, options.ppt?.scenePath);
        await plugin.setup(context);
        pluginEmitter.emit("onCreate");
    }

    private makePluginSetAttibutes(pluginName: string) {
        return (payload: any) => {
            this.setAttributes({ [pluginName]: payload });
        };
    }

    private makePluginUpdateAttributes(pluginName: string) {
        return (keys: string[], value: any) => {
            this.updateAttributes([pluginName, ...keys], value);
        };
    }

    private addPluginToAttirbutes(payload: any): void {
        if (!this.attributes.plugins) {
            this.setAttributes({ plugins: {} });
        }
        this.updateAttributes(["plugins", payload.name], payload);
        this.instancePlugins.set(payload.name, payload);
    }

    public insertComponentToWrapper(name: string, node: ReactNode, initScenePath?: string) {
        const room = WindowManager.instance.displayer;
        const view = room.views.createView();
        view.mode = ViewVisionMode.Freedom;
        (view as any).cameraman.disableCameraTransform = true
        if (initScenePath) {
            const viewScenes = room.entireScenes()[initScenePath];
            WindowManagerWrapper.addComponent(name, node, view, viewScenes, initScenePath);
        } else {
            WindowManagerWrapper.addComponent(name, node, view);
        }
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

    public createView(name: string) {
        const room = this.displayer as Room;
        if (room) {
            const view = room.views.createView();
            view.mode = ViewVisionMode.Writable;
            this.viewMap.set(name, view);
            return view;
        }
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
}

export * from "./wrapper";
