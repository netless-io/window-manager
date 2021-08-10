import Emittery from "emittery";
import { PluginEmitterEvent, WindowManager } from "./index";



export class PluginContext<T = any> {
    private manager: WindowManager;
    private pluginId: string;
    public readonly emitter: Emittery<PluginEmitterEvent<T>>

    constructor(manager: WindowManager, pluginId: string, pluginEmitter: Emittery<PluginEmitterEvent<T>>) {
        this.manager = manager;
        this.pluginId = pluginId;
        this.emitter = pluginEmitter;
    }
    
    public get displayer() {
        return this.manager.displayer;
    }

    public get attributes(): T {
        return this.manager.attributes[this.pluginId];
    }

    public get view() {
        return WindowManager.viewManager.getView(this.pluginId)!;
    }

    public get initScenePath() {
        return this.manager.getPluginInitPath(this.pluginId)
    }

    public get isWritable(): boolean {
        return this.manager.canOperate && Boolean(this.manager.boxManager?.boxIsFocus(this.pluginId)) ;
    }

    public get content() {
        return this.manager.boxManager.getBox(this.pluginId )?.$content;
    }

    public get footer() {
        return this.manager.boxManager.getBox(this.pluginId)?.$footer;
    }

    public setAttributes(attributes: T) {
        this.manager.safeSetAttributes({ [this.pluginId]: attributes });
    }

    public updateAttributes(keys: string[], value: any) { 
        this.manager.safeUpdateAttributes([this.pluginId, ...keys], value);
    }

    public setScenePath(scenePath: string) {
        this.manager.room?.setScenePath(scenePath);
    }

    public pptNextStep() {
        this.manager.room?.pptNextStep();
    }

    public pptPreviousStep() {
        this.manager.room?.pptPreviousStep();
    }
}