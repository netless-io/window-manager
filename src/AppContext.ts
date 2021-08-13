import Emittery from "emittery";
import { BoxManager } from "./BoxManager";
import { AppEmitterEvent, AppManager } from "./index";

export class AppContext<T = any> {

    public readonly emitter: Emittery<AppEmitterEvent<T>>;

    constructor(
        private manager: AppManager,
        private boxManager: BoxManager,
        private appId: string,
        appEmitter: Emittery<AppEmitterEvent<T>>) {
        this.emitter = appEmitter;
    }

    public getDisplayer() {
        return this.manager.displayer;
    }

    public getAttributes(): T | undefined {
        return this.manager.attributes[this.appId];
    }

    public getView() {
        let view = this.manager.viewManager.getView(this.appId);
        if (!view) {
            view = this.createView();
        }
        return view;
    }

    public getInitScenePath() {
        return this.manager.getAppInitPath(this.appId);
    }

    public getIsWritable(): boolean {
        return this.manager.canOperate && Boolean(this.boxManager.boxIsFocus(this.appId));
    }

    public getBox() {
        return this.boxManager.getBox(this.appId);
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
        const view = this.manager.viewManager.createView(this.appId);
        const mainViewElement = this.manager.viewManager.mainView.divElement;
        if (!mainViewElement) {
            throw new Error(`create app main view must bind divElement`);
        }
        this.manager.viewManager.addMainViewListener();
        (view as any).cameraman.disableCameraTransform = true;
        const initScenePath = this.getInitScenePath();
        if (initScenePath) {
            const viewScenes = room.entireScenes()[initScenePath];
            if (viewScenes) {
                view.focusScenePath = `${initScenePath}/${viewScenes[0].name}`;
            }
        }
        this.manager.viewManager.swtichViewToWriter(this.appId);
        return view;
    }
}
