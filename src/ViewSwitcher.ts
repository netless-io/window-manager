import { Room, View, ViewVisionMode } from "white-web-sdk";
import { Events } from "./constants";
import { AppManager } from "./index";

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
        setTimeout(() => {
            const focus = this.manager.delegate.focus;
            if (focus) {
                const appProxy = this.manager.appProxies.get(focus);
                if (appProxy) {
                    if (appProxy.view?.mode === ViewVisionMode.Writable) return;
                    appProxy.switchToWritable();
                    appProxy.setScenePath();
                    appProxy.recoverCamera();
                }
            } else {
                if (this.manager.mainView.mode === ViewVisionMode.Writable) return;
                this.switchWriteToFreedom();
                const mainViewScenePath = this.manager.delegate.getMainViewScenePath();
                if (mainViewScenePath) {
                    setViewFocusScenePath(this.manager.mainView, mainViewScenePath);
                    setScenePath(this.manager.room, mainViewScenePath);
                    this.manager.viewManager.switchMainViewToWriter();
                }
            }
        }, 50);
    }
}

export const setViewFocusScenePath = (view: View, focusScenePath: string) => {
    if (view.focusScenePath !== focusScenePath) {
        view.focusScenePath = focusScenePath;
    }
}

export const setScenePath = (room: Room | undefined, scenePath: string) => {
    if (room) {
        room.setScenePath(scenePath);
    }
}
