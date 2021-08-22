import { Room, View, ViewVisionMode } from "white-web-sdk";
import { Events, MagixEventName, SET_SCENEPATH_DELAY } from "./constants";
import { AppManager, emitter } from "./index";
import { setScenePath, setViewFocusScenePath } from "./Common";
import { AppProxy } from "./AppProxy";
import { TELE_BOX_STATE } from "@netless/telebox-insider";

export class ViewSwitcher {
    private viewManager = this.manager.viewManager;

    constructor(
        private manager: AppManager
    ) { }


    private switchWriteToFreedom() {
        this.manager.appProxies.forEach(app => {
            if (app.view?.mode === ViewVisionMode.Writable) {
                app.switchToFreedom();
            }
        });
    }

    public refreshViews() {
        const focus = this.manager.delegate.focus;
        if (focus) {
            const appProxy = this.manager.appProxies.get(focus);
            if (appProxy) {
                if (appProxy.view?.mode === ViewVisionMode.Writable) return;
                appProxy.removeCameraListener();
                appProxy.switchToWritable();
                appProxy.recoverCamera();
                appProxy.addCameraListener();
            }
        } else {
            if (this.manager.mainView.mode === ViewVisionMode.Writable) return;
            const mainViewScenePath = this.manager.delegate.getMainViewScenePath();
            if (mainViewScenePath) {
                setViewFocusScenePath(this.manager.mainView, mainViewScenePath);
                this.manager.viewManager.switchMainViewToWriter();
            }
        }
    }

    public freedomAllViews() {
        this.manager.displayer.views.forEach(view => {
            view.mode = ViewVisionMode.Freedom;
        });
        this.manager.appProxies.forEach(appProxy => {
            appProxy.setViewFocusScenePath();
        });
        if (!this.manager.viewManager.mainView.focusScenePath) {
            this.manager.delegate.setMainViewFocusPath();
        }
    }

    public switchAppToWriter(id: string) {
        this.manager.dispatchIntenalEvent(Events.SwitchViewsToFreedom, {});
        this.freedomAllViews();
        // 为了同步端不闪烁, 需要给 room setScenePath 一个延迟
        setTimeout(() => {
            const appProxy = this.manager.appProxies.get(id);
            if (appProxy) {
                const boxState = this.manager.delegate.getBoxState();
                if (boxState && boxState === TELE_BOX_STATE.Minimized) {
                    return;
                }
                appProxy.removeCameraListener();
                appProxy.setScenePath();
                appProxy.switchToWritable();
                appProxy.recoverCamera();
                appProxy.addCameraListener();
            }
        }, SET_SCENEPATH_DELAY);
    }
}
