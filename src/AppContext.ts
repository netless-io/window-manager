import Emittery from "emittery";
import { AppEmitterEvent, WindowManager } from "./index";

export class AppContext<T = any> {
    private manager: WindowManager;
    private appId: string;
    public readonly emitter: Emittery<AppEmitterEvent<T>>

    constructor(manager: WindowManager, appId: string, appEmitter: Emittery<AppEmitterEvent<T>>) {
        this.manager = manager;
        this.appId = appId;
        this.emitter = appEmitter;
    }

    public getDisplayer() {
        return this.manager.displayer;
    }

    public getAttributes(): T | undefined {
        return this.manager.attributes[this.appId];
    }

    public getView() {
        let view = WindowManager.viewManager.getView(this.appId);
        if (!view) {
            view = this.createView();
        }
        return view;
    }

    public getInitScenePath() {
        return this.manager.getPluginInitPath(this.appId);
    }

    public getIsWritable(): boolean {
        return this.manager.canOperate && Boolean(this.manager.boxManager?.boxIsFocus(this.appId)) ;
    }

    public getBox() {
        return this.manager.boxManager.getBox(this.appId);
    }

    public setAttributes(attributes: T) {
        this.manager.safeSetAttributes({ [this.appId]: attributes });
    }

    public updateAttributes(keys: string[], value: any) {
        this.manager.safeUpdateAttributes([this.appId, ...keys], value);
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
        const view = WindowManager.viewManager.createView(this.appId);
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
        WindowManager.viewManager.swtichViewToWriter(this.appId);
        return view;
    }
}