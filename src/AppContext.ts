import Emittery from "emittery";
import { BoxManager } from "./BoxManager";
import { AppEmitterEvent, AppManager } from "./index";
import { ViewManager } from "./ViewManager";

export class AppContext<T = any> {

    public readonly emitter: Emittery<AppEmitterEvent<T>>;
    private viewManager: ViewManager;
    private boxManager: BoxManager;

    constructor(
        private manager: AppManager,
        private appId: string,
        appEmitter: Emittery<AppEmitterEvent<T>>) {
        this.emitter = appEmitter;
        this.viewManager = this.manager.viewManager;
        this.boxManager = this.manager.boxManager;
    }

    public getDisplayer() {
        return this.manager.displayer;
    }

    public getAttributes(): T | undefined {
        return this.manager.attributes[this.appId];
    }

    public getView() {
        let view = this.viewManager.getView(this.appId);
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
        this.viewManager.switchMainViewToFreedom();
        const view = this.viewManager.createView(this.appId);
        const mainViewElement = this.viewManager.mainView.divElement;
        if (!mainViewElement) return;
        this.viewManager.addMainViewListener();
        const initScenePath = this.getInitScenePath();
        if (initScenePath) {
            const viewScenes = room.entireScenes()[initScenePath];
            if (viewScenes) {
                view.focusScenePath = `${initScenePath}/${viewScenes[0].name}`;
            }
        }
        this.viewManager.swtichViewToWriter(this.appId);
        return view;
    }
}
