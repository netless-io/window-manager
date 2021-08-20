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

export const setViewFocusScenePath = (view: View, focusScenePath: string) => {
    if (view.focusScenePath !== focusScenePath) {
        view.focusScenePath = focusScenePath;
    }
}

export const setScenePath = (room: Room | undefined, scenePath: string) => {
    if (room) {
        if (room.state.sceneState.scenePath !== scenePath) {
            room.setScenePath(scenePath);
        }
    }
}
