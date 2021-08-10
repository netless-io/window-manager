import { Room, View, ViewVisionMode } from "white-web-sdk";
import { WindowManager } from "./index";

export class ViewManager {

    public mainView: View;
    private views: Map<string, View> = new Map();
    private mainViewIsAddListener = false;

    constructor(
        private room: Room, 
        private manager: WindowManager) {
        this.mainView = this.createMainView();
    }

    public createMainView(): View {
        const mainView = this.room.views.createView();
        mainView.mode = ViewVisionMode.Writable;
        return mainView;
    }

    public createView(pluginId: string): View {
        const view = this.room.views.createView();
        view.mode = ViewVisionMode.Freedom;
        this.views.set(pluginId, view);
        return view;
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
                this.mainView.mode = ViewVisionMode.Writable;
            }
        }
    }

    public addMainViewListener() {
        if (this.mainViewIsAddListener) return;
        if (this.mainView.divElement) {
            this.mainView.divElement.addEventListener("click", () => {
                this.switchMainViewToWriter();
                this.manager.boxManager.blurAllBox();
            });
            this.mainViewIsAddListener = true;
        }
    }
}
