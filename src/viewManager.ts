import { get } from "lodash-es";
import { AnimationMode, Camera, Displayer, Room, RoomConsumer, Size, View, ViewVisionMode } from "white-web-sdk";
import { AppManager, WindowManager } from "./index";
import { log } from "./log";
import { CameraStore } from "./CameraStore";
import { Events } from "./constants";

export class ViewManager {
    public mainView: View;
    private views: Map<string, View> = new Map();
    private viewListeners: Map<string, any> = new Map();
    private mainViewIsAddListener = false;

    constructor(
        private displayer: Displayer,
        private manager: AppManager,
        private cameraStore: CameraStore) {
        this.mainView = this.createMainView();
    }

    public get currentScenePath() {
        return this.displayer.state.sceneState.scenePath;
    }

    public createMainView(): View {
        const mainView = this.displayer.views.createView();
        this.cameraStore.setCamera("mainView", mainView.camera);
        mainView.callbacks.on("onCameraUpdated", this.cameraListener("mainView", mainView));
        mainView.callbacks.on("onSizeUpdated", () => this.manager.boxManager.updateManagerRect());
        this.setViewMode(mainView, ViewVisionMode.Writable);
        return mainView;
    }

    public createView(appId: string): View {
        const view = this.displayer.views.createView();
        const cameraListener = this.cameraListener(appId, view);
        this.viewListeners.set(appId, cameraListener);
        this.cameraStore.setCamera(appId, view.camera);
        view.callbacks.on("onCameraUpdated", cameraListener);
        this.setViewMode(view, ViewVisionMode.Freedom);
        this.views.set(appId, view);
        return view;
    }

    public destoryView(appId: string) {
        const view = this.views.get(appId);
        if (view) {
            const viewListener = this.viewListeners.get(appId);
            if (viewListener) {
                view.callbacks.off("onCameraUpdated", viewListener);
                this.cameraStore.deleteCamera(appId);
            }
            view.release();
            this.views.delete(appId);
        }
    }

    public getView(appId: string) {
        return this.views.get(appId);
    }

    public switchAppToFreedom(appId: string) {
        const view = this.views.get(appId);
        if (view) {
            this.switchViewToFreedom(view);
        }
    }

    public switchWritableAppToFreedom() {
        this.manager.appProxies.forEach(appProxy => {
            if (appProxy.view?.mode === ViewVisionMode.Writable) {
                const fullPath = appProxy.getFullScenePath();
                if (appProxy.view.focusScenePath !== fullPath) {
                    appProxy.view.focusScenePath = fullPath;
                }
                appProxy.view.mode = ViewVisionMode.Freedom;
            }
        });
    }

    public switchMainViewToFreedom() {
        this.switchViewToFreedom(this.mainView);
    }

    private switchViewToFreedom(view: View) {
        if (!view.focusScenePath) {
            view.focusScenePath = this.currentScenePath;
        }
        this.setViewMode(view, ViewVisionMode.Freedom);
    }

    public switchMainViewToWriter() {
        if (!this.manager.canOperate) return;
        if (this.mainView) {
            if (this.mainView.mode === ViewVisionMode.Writable) return;
            const mainViewCamera = this.cameraStore.getCamera("mainView");
                this.setViewMode(this.mainView, ViewVisionMode.Writable);
                if (mainViewCamera) {
                    this.mainView.moveCamera({ ...mainViewCamera, animationMode: AnimationMode.Immediately });
                }
        }
    }

    public addMainViewListener() {
        if (this.mainViewIsAddListener) return;
        if (this.mainView.divElement) {
            this.mainView.divElement.addEventListener("click", this.manViewClickListener);
            this.mainView.divElement.addEventListener("touchend", this.manViewClickListener);
            this.mainViewIsAddListener = true;
        }
    }

    public removeMainViewListener() {
        if (this.mainView.divElement) {
            this.mainView.divElement.removeEventListener("click", this.manViewClickListener);
            this.mainView.divElement.removeEventListener("touchend", this.manViewClickListener);
        }
    }

    private manViewClickListener = () => {
        this.manViewClickHandler();
    }

    private manViewClickHandler() {
        if (this.mainView.mode === ViewVisionMode.Writable) return;
        this.switchWritableAppToFreedom();
        this.manager.delegate.cleanFocus();
        this.switchMainViewToWriter();
        this.manager.boxManager.blurFocusBox();
        const mainViewScenePath = this.manager.delegate.getMainViewScenePath();
        if (mainViewScenePath) {
            this.manager.room?.setScenePath(mainViewScenePath);
        }
        this.manager.safeDispatchMagixEvent(Events.MainViewFocus, {});
    }

    public setViewMode(view: View, mode: ViewVisionMode) {
        if (view.mode !== mode) {
            view.mode = mode;
        }
    }

    public cameraListener(id: string, view: View) {
        return (camera: Camera) => {
            this.cameraStore.setCamera(id, camera);
        };
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

