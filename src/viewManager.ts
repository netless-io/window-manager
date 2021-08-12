import { AnimationMode, Camera, Room, Size, View, ViewVisionMode } from "white-web-sdk";
import { WindowManager } from "./index";
import { log } from "./log";
import { ViewCameraManager } from "./ViewCameraManager";

export class ViewManager {

    public mainView: View;
    private views: Map<string, View> = new Map();
    private viewListeners: Map<string, any> = new Map();
    private mainViewIsAddListener = false;

    constructor(
        private room: Room, 
        private manager: WindowManager,
        private viewCameraManager: ViewCameraManager) {
        this.mainView = this.createMainView();
    }

    public createMainView(): View {
        const mainView = this.room.views.createView();
        mainView.callbacks.on("onCameraUpdated", this.viewCameraListener("mainView", mainView));
        mainView.mode = ViewVisionMode.Writable;
        return mainView;
    }

    public createView(pluginId: string): View {
        const view = this.room.views.createView();
        const cameraListener = this.viewCameraListener(pluginId, view);
        this.viewListeners.set(pluginId, cameraListener);
        view.callbacks.on("onCameraUpdated", cameraListener);
        view.mode = ViewVisionMode.Freedom;
        this.views.set(pluginId, view);
        return view;
    }

    public destoryView(pluginId: string) {
        const view = this.views.get(pluginId);
        if (view) {
            const viewListener = this.viewListeners.get(pluginId);
            if (viewListener) {
                view.callbacks.off("onCameraUpdated", viewListener);
                this.viewCameraManager.deleteCamera(pluginId);
            }
            view.release();
            this.views.delete(pluginId);
        }
    }

    public getView(pluginId: string) {
        return this.views.get(pluginId);
    }

    public swtichViewToWriter(pluginId: string) {
        if (!this.manager.canOperate) return;
        const view = this.views.get(pluginId);
        if (view) {
            this.room.views.forEach(roomView => {
                if (roomView.mode === ViewVisionMode.Writable) {
                    roomView.focusScenePath = this.room.state.sceneState.scenePath;
                }
                roomView.mode = ViewVisionMode.Freedom;
            });
            if (view.focusScenePath) {
                this.room.setScenePath(view.focusScenePath);
                const viewCamera = this.viewCameraManager.getCamera(pluginId);
                view.mode = ViewVisionMode.Writable;
                if (viewCamera) {
                    view.moveCamera({ ...viewCamera, animationMode: AnimationMode.Immediately });
                }
            }
        }
    }

    public switchViewToFreedom(pluginId: string) {
        const view = this.views.get(pluginId);
        if (view) {
            if (!view.focusScenePath) {
                view.focusScenePath = this.room.state.sceneState.scenePath;
            }
            view.mode = ViewVisionMode.Freedom;
        }
    }

    public switchMainViewToWriter() {
        if (this.mainView) {
            if (this.mainView.mode === ViewVisionMode.Writable) return;
            this.room.views.forEach(roomView => {
                if (roomView.mode === ViewVisionMode.Writable) {
                    roomView.focusScenePath = this.room.state.sceneState.scenePath;
                }
                roomView.mode = ViewVisionMode.Freedom;
            });
            if (this.mainView.focusScenePath) {
                this.room.setScenePath(this.mainView.focusScenePath);
                const mainViewCamera = this.viewCameraManager.getCamera("mainView");
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

    public viewCameraListener(id: string, view: View) {
        return (camera: Camera) => {
            if (view.mode === ViewVisionMode.Writable) {
                this.viewCameraManager.setCamera(id, camera);
            }
        };
    }
}
