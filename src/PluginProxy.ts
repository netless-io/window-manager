import Emittery from 'emittery';
import get from 'lodash.get';
import { autorun, SceneState } from "white-web-sdk";
import {
    AddPluginOptions,
    AddPluginParams,
    emitter,
    InsertComponentToWrapperParams,
    PluginEmitterEvent,
    PluginInitState,
    PluginListenerKeys,
    PluginSyncAttributes,
    setPluginOptions,
    WindowManager
    } from './index';
import { BoxManager } from './BoxManager';
import { Events, PluginAttributes, PluginEvents } from './constants';
import { log } from './log';
import { PluginContext } from './PluginContext';
import { Plugin } from "./typings";
import { loadPlugin } from './loader';
import { PluginCreateError } from './error';

export class PluginProxy {
    private id: string;
    public pluginEmitter: Emittery<PluginEmitterEvent>;
    private pluginLisener: any;
    private disposer: any;
    public scenePath?: string;

    constructor(
        private params: AddPluginParams,
        private manager: WindowManager,
        private boxManager: BoxManager,
    ) {
        this.id = PluginProxy.genId(params.kind, params.options);
        if (this.manager.pluginProxies.has(this.id)) {
            throw new PluginCreateError();
        }
        this.manager.pluginProxies.set(this.id, this);
        this.pluginEmitter = new Emittery();
        this.pluginLisener = this.makePluginEventListener(this.id);
        this.scenePath = this.params.options?.scenePath;
    }

    public static genId(kind: string, options?: AddPluginOptions) {
        if (options && options.scenePath) {
            return `${kind}-${options.scenePath}`;
        } else {
            return kind;
        }
    }

    public setupAttributes(): void {
        const params = this.params;
        const attributes = this.manager.attributes;
        if (!attributes.plugins) {
            this.manager.safeSetAttributes({ plugins: {} });
        }
        let pluginAttributes: PluginSyncAttributes = { kind: params.kind, options: params.options };
        if (typeof params.plugin === "string") {
            pluginAttributes.url = params.plugin;
        }
        this.manager.safeUpdateAttributes(["plugins", this.id], pluginAttributes);
        this.manager.safeUpdateAttributes(["plugins", this.id, "state"],{
            [PluginAttributes.Size]: { width: 0, height: 0 },
            [PluginAttributes.Position]: { x: 0, y: 0 },
            [PluginAttributes.SnapshotRect]: {},
        });
        this.manager.safeSetAttributes({ focus: this.id });
    }

    public async baseInsertPlugin() {
        const params = this.params; 
        if (params.kind) {
            let pluginClass;
            if (params.plugin === undefined) {
                pluginClass = WindowManager.pluginClasses.get(params.kind);
                if (!pluginClass) {
                    throw new Error("plugin need register");
                }
            } else {
                pluginClass = typeof params.plugin === "string" ? await loadPlugin(params.kind, params.plugin) : params.plugin;
            }

            if (pluginClass) {
                await this.setupPlugin(this.id, pluginClass, params.options, params.pluginArgs);
            } else {
                throw new Error(`plugin load failed ${params.kind} ${params.plugin}`);
            }
            this.boxManager.updateManagerRect();
            return {
                pluginId: this.id, plugin: pluginClass
            }
        } else {
            // throw new Error("kind and plugin is require");
        }
    }

    private async setupPlugin(pluginId: string, plugin: Plugin, options?: setPluginOptions, localOptions?: any) {
        log("setupPlugin", pluginId, plugin, options, localOptions);
        const context = new PluginContext(this.manager, pluginId, this.pluginEmitter);
        try {
            emitter.once(`${pluginId}${Events.WindowCreated}`).then(async () => {
                const boxInitState = this.getPluginInitState(pluginId);
                this.boxManager.updateBox(boxInitState);
                this.pluginEmitter.onAny(this.pluginLisener);
                this.pluginAttributesUpdateListener(pluginId);
                await plugin.setup(context, localOptions);
                this.pluginEmitter.emit("create", undefined);
            });
            this.boxManager.createBox({
                pluginId, plugin
            });
        } catch (error) {
            throw new Error(`plugin setup error: ${error.message}`);
        }
    }

    public getPluginInitState = (id: string) => {
        const pluginAttributes = get(this.manager.attributes, ["plugins", id, "state"]);
        if (!pluginAttributes) return;
        const position = pluginAttributes?.[PluginAttributes.Position];
        const focus = this.manager.attributes.focus;
        const size = pluginAttributes?.[PluginAttributes.Size];
        const snapshotRect = pluginAttributes?.[PluginAttributes.SnapshotRect];
        const boxState = this.manager.attributes["boxState"];
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

    public destroy(needCloseBox: boolean, error?: Error) {
        this.pluginEmitter.emit("destroy", { error });
        this.pluginEmitter.offAny(this.pluginLisener);
        emitter.emit(`destroy-${this.id}`, { error });
        this.manager.safeUpdateAttributes(["plugins", this.id], undefined);
        if (needCloseBox) {
            this.boxManager.closeBox(this.id);
            WindowManager.viewManager.destoryView(this.id);
        }

        if (this.disposer) {
            this.disposer();
        }
        this.cleanPluginAttributes();
        this.manager.pluginProxies.delete(this.id);
    }

    public emitPluginSceneStateChange(sceneState: SceneState) {
        this.pluginEmitter.emit("sceneStateChange", sceneState!);
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
                    this.destroy(true, data.error);
                }
                default:
                    break;
            }
        }
    }

    private pluginAttributesUpdateListener = (pluginId: string) => {
        const disposer = autorun(() => {
            const pluginAttributes = this.manager.attributes[pluginId];
            this.pluginEmitter.emit("attributesUpdate", pluginAttributes);
        });
        this.disposer = disposer;
    }

    private insertComponentToWrapper(params: InsertComponentToWrapperParams) {
        log("insertComponentToWrapper", params);
        const { pluginId, plugin, emitter, options } = params;
        let payload: any = { pluginId, emitter, plugin, options };
        
    }

    private cleanPluginAttributes() {
        this.manager.safeSetAttributes({ [this.id]: undefined });
        const focus = this.manager.attributes["focus"];
        if (focus === this.id) {
            this.manager.safeSetAttributes({ focus: undefined });
        }
    }
}
