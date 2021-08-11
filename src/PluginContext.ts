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

    public getDisplayer() {
        return this.manager.displayer;
    }

    public getAttributes(): T {
        return this.manager.attributes[this.pluginId];
    }

    public getView() {
        let view = WindowManager.viewManager.getView(this.pluginId);
        if (!view) {
            view = this.createView();
        }
        return view;
    }

    public getInitScenePath() {
        return this.manager.getPluginInitPath(this.pluginId);
    }

    public getIsWritable(): boolean {
        return this.manager.canOperate && Boolean(this.manager.boxManager?.boxIsFocus(this.pluginId)) ;
    }

    public getBox() {
        return this.manager.boxManager.getBox(this.pluginId);
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

    private createView() {
        const room = this.manager.displayer;
        const view = WindowManager.viewManager.createView(this.pluginId);
        const mainViewElement = WindowManager.viewManager.mainView.divElement;
        if (!mainViewElement) {
            throw new Error(`create plugin main view must bind divElement`);
        }
        WindowManager.viewManager.addMainViewListener();
        (view as any).cameraman.disableCameraTransform = true;
        const initScenePath = this.getInitScenePath();
        if (initScenePath) {
            const viewScenes = room.entireScenes()[initScenePath];
            if (viewScenes) {
                view.focusScenePath = `${initScenePath}/${viewScenes[0].name}`;
            }
        }
        WindowManager.viewManager.swtichViewToWriter(this.pluginId);
        return view;
    }
}