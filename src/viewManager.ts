import { get } from "lodash-es";
import { AnimationMode, Camera, Displayer, Room, RoomConsumer, Size, View, ViewVisionMode } from "white-web-sdk";
import { AppManager, emitter, userEmitter, WindowManager } from "./index";
import { log } from "./log";
import { CameraStore } from "./CameraStore";
import { Events, MagixEventName, SET_SCENEPATH_DELAY } from "./constants";
import {  setScenePath, setViewFocusScenePath, setViewMode } from "./Common";

export class ViewManager {
    public mainView: View;
    private views: Map<string, View> = new Map();
    private mainViewIsAddListener = false;

    constructor(
        private displayer: Displayer,
        private manager: AppManager,
        private cameraStore: CameraStore) {
        this.mainView = this.createMainView();
        this.addMainViewCameraListener();
    }

    public get currentScenePath() {
        return this.displayer.state.sceneState.scenePath;
    }

    public createMainView(): View {
        const mainView = this.displayer.views.createView();
        this.cameraStore.setCamera("mainView", mainView.camera);
        mainView.callbacks.on("onSizeUpdated", () => this.manager.boxManager.updateManagerRect());
        setViewMode(mainView, ViewVisionMode.Writable);
        return mainView;
    }

    public createView(appId: string): View {
        const view = this.displayer.views.createView();
        this.cameraStore.setCamera(appId, view.camera);
        setViewMode(view, ViewVisionMode.Freedom);
        this.views.set(appId, view);
        return view;
    }

    public destoryView(appId: string) {
        const view = this.views.get(appId);
        if (view) {
            view.release();
            this.views.delete(appId);
        }
    }

    public getView(appId: string) {
        return this.views.get(appId);
    }

    private addMainViewCameraListener() {
        this.mainView.callbacks.on("onCameraUpdated", this.mainViewCameraListener);
    }

    private removeMainViewCameraListener() {
        this.mainView.callbacks.off("onCameraUpdated", this.mainViewCameraListener);
    }

    public switchMainViewToFreedom() {
        this.manager.delegate.setMainViewFocusPath();
        setViewMode(this.mainView, ViewVisionMode.Freedom);
    }

    public switchMainViewModeToWriter() {
        if (!this.manager.canOperate) return;
        if (this.mainView) {
            if (this.mainView.mode === ViewVisionMode.Writable) return;
            setViewMode(this.mainView, ViewVisionMode.Writable);
            userEmitter.emit("mainViewModeChange", ViewVisionMode.Writable);
        }
    }

    public addMainViewListener() {
        if (this.mainViewIsAddListener) return;
        if (this.mainView.divElement) {
            this.mainView.divElement.addEventListener("click", this.mainViewClickListener);
            this.mainView.divElement.addEventListener("touchend", this.mainViewClickListener);
            this.mainViewIsAddListener = true;
        }
    }

    public removeMainViewListener() {
        if (this.mainView.divElement) {
            this.mainView.divElement.removeEventListener("click", this.mainViewClickListener);
            this.mainView.divElement.removeEventListener("touchend", this.mainViewClickListener);
        }
    }

    private mainViewClickListener = () => {
        this.mainViewClickHandler();
    }

    public mainViewClickHandler() {
        this.manager.delegate.cleanFocus();
        this.manager.viewSwitcher.freedomAllViews();
        this.manager.dispatchIntenalEvent(Events.SwitchViewsToFreedom, {});
        this.manager.dispatchIntenalEvent(Events.MainViewFocus, {});
        this.manager.boxManager.blurFocusBox();
        this.manager.viewManager.switchMainViewToWriter();
    }

    private mainViewCameraListener = (camera: Camera) => {
        this.cameraStore.setCamera("mainView", camera);
    }

    public switchMainViewToWriter() {
        setTimeout(() => {
            const mainViewScenePath = this.manager.delegate.getMainViewScenePath();
            if (mainViewScenePath) {
                this.removeMainViewCameraListener();
                setScenePath(this.manager.room, mainViewScenePath);
                this.switchMainViewModeToWriter();
                this.manager.cameraStore.recoverCamera("mainView", this.mainView);
                this.addMainViewCameraListener();
            }
        }, SET_SCENEPATH_DELAY);
    }

    public destroy() {
        this.removeMainViewListener();
        if (WindowManager.wrapper) {
            WindowManager.wrapper.parentNode?.removeChild(WindowManager.wrapper);
            WindowManager.wrapper = null;
        }
    }
}

export const setupWrapper = (root: HTMLElement) => {
    const wrapper = createWrapper();
    const mainViewElement = initMaiViewElement();
    wrapper.appendChild(mainViewElement);
    root.appendChild(wrapper);
    WindowManager.wrapper = wrapper;
    return { wrapper, mainViewElement };
}

export const createWrapper = () => {
    const wrapper = document.createElement("div");
    wrapper.className = "netless-window-manager wrapper";
    return wrapper;
}

export const initMaiViewElement = () => {
    const element = document.createElement("div");
    element.className = "main-view";
    return element;
}
