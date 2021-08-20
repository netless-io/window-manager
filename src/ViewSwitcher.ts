import { Room, View, ViewVisionMode } from "white-web-sdk";
import { Events } from "./constants";
import { AppManager } from "./index";
import { setScenePath, setViewFocusScenePath } from "./Common";

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

    private freedomAllViews() {
        this.manager.appProxies.forEach(app => {
            if (app.view?.mode === ViewVisionMode.Writable) {
                app.switchToFreedom();
            }
        });
        if (this.manager.mainView.mode === ViewVisionMode.Writable) {
            this.viewManager.switchMainViewToFreedom();
        }
    }

    public refreshViews() {
        const focus = this.manager.delegate.focus;
        if (focus) {
            const appProxy = this.manager.appProxies.get(focus);
            if (appProxy) {
                if (appProxy.view?.mode === ViewVisionMode.Writable) return;
                appProxy.removeCameraListener();
                appProxy.setScenePath();
                appProxy.switchToWritable();
                appProxy.recoverCamera();
                appProxy.addCameraListener();
            }
        } else {
            if (this.manager.mainView.mode === ViewVisionMode.Writable) return;
            const mainViewScenePath = this.manager.delegate.getMainViewScenePath();
            if (mainViewScenePath) {
                setScenePath(this.manager.room, mainViewScenePath);
                this.switchWriteToFreedom();
                setViewFocusScenePath(this.manager.mainView, mainViewScenePath);
                this.manager.viewManager.switchMainViewToWriter();
            }
        }
    }
}
