import { Camera, Room, View, ViewVisionMode } from "white-web-sdk";
import { WindowManager } from "./index";
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
        mainView.callbacks.on("onCameraUpdated", this.viewCameraListener("mainView"));
        mainView.mode = ViewVisionMode.Writable;
        return mainView;
    }

    public createView(pluginId: string): View {
        const view = this.room.views.createView();
        const listener = this.viewCameraListener(pluginId);
        this.viewListeners.set(pluginId, listener);
        view.callbacks.on("onCameraUpdated", listener);
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
        const view = this.views.get(pluginId);
        if (view) {
            this.room.views.forEach(roomView => {
                if (roomView.mode === ViewVisionMode.Writable) {
                    if (!roomView.focusScenePath) {
                        roomView.focusScenePath = this.room.state.sceneState.scenePath;
                    }
                }
                roomView.mode = ViewVisionMode.Freedom;
            });
            if (view.focusScenePath) {
                this.room.setScenePath(view.focusScenePath);
                view.mode = ViewVisionMode.Writable;
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
            this.room.views.forEach(roomView => {
                if (roomView.mode === ViewVisionMode.Writable) {
                    if (!roomView.focusScenePath) {
                        roomView.focusScenePath = this.room.state.sceneState.scenePath;
                    }
                }
                roomView.mode = ViewVisionMode.Freedom;
            });
            if (this.mainView.focusScenePath) {
                this.room.setScenePath(this.mainView.focusScenePath);
                const mainViewCamera = this.viewCameraManager.getCamera("mainView");
                if (mainViewCamera) {
                    // (this.mainView as any).moveCamera(mainViewCamera);
                }
                this.mainView.mode = ViewVisionMode.Writable;
            }
        }
    }

    public addMainViewListener() {
        if (this.mainViewIsAddListener) return;
        if (this.mainView.divElement) {
            this.mainView.divElement.addEventListener("click", () => {
                this.manager.boxManager.blurAllBox();
                this.switchMainViewToWriter();
            });
            this.mainViewIsAddListener = true;
        }
    }

    public viewCameraListener(id: string) {
        return (camera: Camera) => {
            this.viewCameraManager.setCamera(id, camera);
        };
    }
}
