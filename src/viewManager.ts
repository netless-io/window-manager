import { debounce } from "lodash-es";
import { AnimationMode, Camera, Displayer, Room, RoomConsumer, Size, View, ViewVisionMode } from "white-web-sdk";
import { emitter, callbacks, WindowManager } from "./index";
import type { AppManager } from "./AppManager";
import { log } from "./log";
import type { CameraStore } from "./CameraStore";
import { Events, MagixEventName, SET_SCENEPATH_DELAY } from "./constants";
import {  notifyMainViewModeChange, setScenePath, setViewFocusScenePath, setViewMode } from "./Common";
import { TELE_BOX_STATE } from "@netless/telebox-insider";
export class ViewManager {
    public mainView: View;
    private views: Map<string, View> = new Map();
    private mainViewIsAddListener = false;
    private delegate = this.manager.delegate;
    private timer?: number;

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
                this.setMainViewSize(size);
            }
        });
        this.switchMainViewModeToWriter();
        return mainView;
    }

    public setMainViewSize = debounce(size => {
        this.manager.delegate.setMainViewSize({ ...size });
    }, 200);

    public createView(appId: string): View {
        const view = this.displayer.views.createView();
        this.cameraStore.setCamera(appId, view.camera);
        setViewMode(view, ViewVisionMode.Freedom);
        this.views.set(appId, view);
        return view;
    }

    public destroyView(appId: string) {
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

    public async mainViewClickHandler() {
        if (this.mainView.mode === ViewVisionMode.Writable) return;
        this.manager.delegate.cleanFocus();
        this.freedomAllViews();
        this.manager.dispatchInternalEvent(Events.SwitchViewsToFreedom, {});
        this.manager.dispatchInternalEvent(Events.MainViewFocus, {});
        this.manager.boxManager.blurFocusBox();
        await this.manager.viewManager.switchMainViewToWriter();
    }

    private mainViewCameraListener = (camera: Camera) => {
        this.cameraStore.setCamera("mainView", camera);
        if (this.delegate.broadcaster === this.displayer.observerId) {
            this.delegate.setMainViewCamera({ ...camera });
        }
    }

    public switchMainViewToWriter() {
        if (this.timer) {
            clearTimeout(this.timer);
        }
        return new Promise((resolve, reject) => {
            this.timer = window.setTimeout(() => {
                try {
                    const mainViewScenePath = this.manager.delegate.getMainViewScenePath();
                    if (mainViewScenePath) {
                        this.freedomAllViews();
                        this.removeMainViewCameraListener();
                        setScenePath(this.manager.room, mainViewScenePath);
                        this.switchMainViewModeToWriter();
                        this.manager.cameraStore.recoverCamera("mainView", this.mainView);
                        this.addMainViewCameraListener();
                    }
                    resolve(true);
                } catch (error) {
                    reject(error);
                }
            }, SET_SCENEPATH_DELAY);
        });
    }

    public refreshViews() {
        const focus = this.manager.delegate.focus;
        this.setMainViewFocusScenePath();
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
            this.freedomAllViews();
            this.switchMainViewToWriter();
        }
    }

    private setMainViewFocusScenePath() {
        const mainViewScenePath = this.manager.delegate.getMainViewScenePath();
        if (mainViewScenePath) {
            setViewFocusScenePath(this.manager.mainView, mainViewScenePath);
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
            WindowManager.wrapper = undefined;
        }
    }
}

export const setupWrapper = (root: HTMLElement) => {
    const playground = document.createElement('div')
    playground.className = "netless-window-manager-playground";
    
    const sizer = document.createElement('div')
    sizer.className = "netless-window-manager-sizer";
    
    const wrapper = document.createElement("div");
    wrapper.className = "netless-window-manager-wrapper";
    
    const mainViewElement = document.createElement("div");
    mainViewElement.className = "netless-window-manager-main-view";
    
    playground.appendChild(sizer)
    sizer.appendChild(wrapper)
    wrapper.appendChild(mainViewElement);
    root.appendChild(playground);
    WindowManager.wrapper = wrapper;
    
    return { playground, wrapper, sizer, mainViewElement };
}

