import { get } from "lodash-es";
import { AnimationMode, Camera, Displayer, Room, Size, View, ViewVisionMode } from "white-web-sdk";
import { AppManager, WindowManager } from "./index";
import { log } from "./log";
import { CameraStore } from "./CameraStore";

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

    private get scenePath() {
        return this.displayer.state.sceneState.scenePath;
    }

    public createMainView(): View {
        const mainView = this.displayer.views.createView();
        this.cameraStore.setCamera("mainView", mainView.camera);
        mainView.callbacks.on("onCameraUpdated", this.cameraListener("mainView", mainView));
        mainView.callbacks.on("onSizeUpdated", () => this.manager.boxManager.updateManagerRect());
        mainView.mode = ViewVisionMode.Writable;
        return mainView;
    }

    public createView(appId: string): View {
        const view = this.displayer.views.createView();
        const cameraListener = this.cameraListener(appId, view);
        this.viewListeners.set(appId, cameraListener);
        this.cameraStore.setCamera(appId, view.camera);
        view.callbacks.on("onCameraUpdated", cameraListener);
        view.mode = ViewVisionMode.Freedom;
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

    public swtichViewToWriter(appId: string) {
        if (!this.manager.canOperate) return;
        const view = this.views.get(appId);
        if (view) {
            if (view.mode === ViewVisionMode.Writable &&
                view.focusScenePath === this.scenePath) return;
            this.displayer.views.forEach(roomView => {
                if (roomView.mode === ViewVisionMode.Writable) {
                    roomView.focusScenePath = this.scenePath;
                }
                roomView.mode = ViewVisionMode.Freedom;
            });
            if (!view.focusScenePath) {
                const pluginOptions = get(this.manager.attributes, ["apps", appId, "options"]);
                if (pluginOptions) {
                    view.focusScenePath = pluginOptions?.scenePath;
                }
            }
            if (view.focusScenePath) {
                this.manager.room?.setScenePath(view.focusScenePath);
                const viewCamera = this.cameraStore.getCamera(appId);
                view.mode = ViewVisionMode.Writable;
                if (viewCamera) {
                    view.moveCamera({ ...viewCamera, animationMode: AnimationMode.Immediately });
                }
            }
        }
    }

    public switchAppToFreedom(appId: string) {
        const view = this.views.get(appId);
        if (view) {
            this.switchViewToFreedom(view);
        }
    }

    public switchMainViewToFreedom() {
        this.switchViewToFreedom(this.mainView);
    }

    private switchViewToFreedom(view: View) {
        if (!view.focusScenePath) {
            view.focusScenePath = this.scenePath;
        }
        view.mode = ViewVisionMode.Freedom;
    }

    public switchMainViewToWriter() {
        if (!this.manager.canOperate) return;
        if (this.mainView) {
            if (this.mainView.mode === ViewVisionMode.Writable) return;
            this.displayer.views.forEach(roomView => {
                if (roomView.mode === ViewVisionMode.Writable) {
                    roomView.focusScenePath = this.scenePath;
                }
                roomView.mode = ViewVisionMode.Freedom;
            });
            if (this.mainView.focusScenePath) {
                this.manager.room?.setScenePath(this.mainView.focusScenePath);
                const mainViewCamera = this.cameraStore.getCamera("mainView");
                this.mainView.mode = ViewVisionMode.Writable;
                if (mainViewCamera) {
                    this.mainView.moveCamera({ ...mainViewCamera, animationMode: AnimationMode.Immediately });
                }
            }
        }
    }

    public addMainViewListener() {
        if (this.mainViewIsAddListener) return;
        if (this.mainView.divElement) {
            this.mainView.divElement.addEventListener("click", () => {
                if (this.mainView.mode === ViewVisionMode.Writable) return;
                this.manager.boxManager.blurAllBox();
                this.switchMainViewToWriter();
            });
            this.mainViewIsAddListener = true;
        }
    }

    public cameraListener(id: string, view: View) {
        return (camera: Camera) => {
            this.cameraStore.setCamera(id, camera);
        };
    }

    public destroy() {
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

