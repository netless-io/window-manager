import Emittery from "emittery";
import { PluginEventKeys, PluginListenerKeys } from "./constants";
import { WindowManager } from "./index";

export class PluginContext {
    private manager: WindowManager;
    private pluginId: string;
    private pluginEmitter: Emittery;

    constructor(manager: WindowManager, pluginId: string, pluginEmitter: Emittery) {
        this.manager = manager;
        this.pluginId = pluginId;
        this.pluginEmitter = pluginEmitter;
    }
    
    public get displayer() {
        return this.manager.displayer;
    }

    public get attributes() {
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
        return this.manager.boxManager.getBox({ pluginId: this.pluginId })?.$content;
    }

    public get footer() {
        return this.manager.boxManager.getBox({ pluginId: this.pluginId })?.$footer;
    }

    public setAttributes(attributes: any) {
        this.manager.safeSetAttributes({ [this.pluginId]: attributes });
    }

    public updateAttributes(keys: string[], value: any) { 
        this.manager.safeUpdateAttributes([this.pluginId, ...keys], value);
    }

    public on(event: PluginListenerKeys, listener: any) {
        this.pluginEmitter.on(event, listener);
    }

    public off(event: PluginListenerKeys, listener: any) {
        this.pluginEmitter.off(event, listener);
    }

    public emit(event: PluginEventKeys, payload: any) {
        this.pluginEmitter.emit(event, payload);
    }

    public once(event: PluginListenerKeys, listener: any) {
        this.pluginEmitter.once(event).then(listener);
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