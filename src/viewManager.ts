import { debounce, get } from "lodash-es";
import { AnimationMode, Camera, Displayer, Room, RoomConsumer, Size, View, ViewVisionMode } from "white-web-sdk";
import { AppManager, emitter, callbacks, WindowManager } from "./index";
import { log } from "./log";
import { CameraStore } from "./CameraStore";
import { Events, MagixEventName, SET_SCENEPATH_DELAY } from "./constants";
import {  notifyMainViewModeChange, setScenePath, setViewFocusScenePath, setViewMode } from "./Common";
import { TELE_BOX_STATE } from "@netless/telebox-insider";

export class ViewManager {
    public mainView: View;
    private views: Map<string, View> = new Map();
    private mainViewIsAddListener = false;
    private delegate = this.manager.delegate;

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
        mainView.callbacks.on("onSizeUpdated", (size: Size) => {
            this.manager.boxManager.updateManagerRect();
            if (this.delegate.broadcaster === this.displayer.observerId) {
                this.setMianViewSize(size);
            }
        });
        this.switchMainViewModeToWriter();
        return mainView;
    }

    public setMianViewSize = debounce(size => {
        this.manager.delegate.setMainViewSize({ ...size });
    }, 200);

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
        notifyMainViewModeChange(callbacks, ViewVisionMode.Freedom);
        setViewMode(this.mainView, ViewVisionMode.Freedom);
    }

    public switchMainViewModeToWriter() {
        if (!this.manager.canOperate) return;
        if (this.mainView) {
            if (this.mainView.mode === ViewVisionMode.Writable) return;
            notifyMainViewModeChange(callbacks, ViewVisionMode.Writable);
            setViewMode(this.mainView, ViewVisionMode.Writable);
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
        if (this.mainView.mode === ViewVisionMode.Writable) return;
        this.manager.delegate.cleanFocus();
        this.freedomAllViews();
        this.manager.dispatchIntenalEvent(Events.SwitchViewsToFreedom, {});
        this.manager.dispatchIntenalEvent(Events.MainViewFocus, {});
        this.manager.boxManager.blurFocusBox();
        this.manager.viewManager.switchMainViewToWriter();
    }

    private mainViewCameraListener = (camera: Camera) => {
        this.cameraStore.setCamera("mainView", camera);
        if (this.delegate.broadcaster === this.displayer.observerId) {
            this.delegate.setMainViewCamera({ ...camera });
        }
    }

    public switchMainViewToWriter() {
        setTimeout(() => {
        const mainViewScenePath = this.manager.delegate.getMainViewScenePath();
            if (mainViewScenePath) {
                this.freedomAllViews();
                this.removeMainViewCameraListener();
                setScenePath(this.manager.room, mainViewScenePath);
                this.switchMainViewModeToWriter();
                this.manager.cameraStore.recoverCamera("mainView", this.mainView);
                this.addMainViewCameraListener();
            }
        }, SET_SCENEPATH_DELAY);
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
                this.freedomAllViews();
                this.manager.viewManager.switchMainViewToWriter();
            }
        }
    }

    public freedomAllViews() {
        this.manager.appProxies.forEach(appProxy => {
            appProxy.setViewFocusScenePath();
            if (appProxy.view) {
                appProxy.view.mode = ViewVisionMode.Freedom;
            }
        });
        if (this.mainView.mode === ViewVisionMode.Writable) {
            notifyMainViewModeChange(callbacks, ViewVisionMode.Freedom);
            this.mainView.mode = ViewVisionMode.Freedom;
        }
        if (!this.manager.viewManager.mainView.focusScenePath) {
            this.manager.delegate.setMainViewFocusPath();
        }
    }

    public switchAppToWriter(id: string) {
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
