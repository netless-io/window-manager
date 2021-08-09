import { Room, View, ViewVisionMode } from "white-web-sdk";

export class ViewManager {
    private room: Room;
    public mainView: View;
    private views: Map<string, View> = new Map();

    constructor(room: Room) {
        this.room = room;
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
            const views = this.room.views;
            views.forEach(view => {
                if (view.mode === ViewVisionMode.Writable) {
                    if (!view.focusScenePath) {
                        view.focusScenePath = this.room.state.sceneState.scenePath;
                    }
                }
                view.mode = ViewVisionMode.Freedom;
            });
            if (view.focusScenePath) {
                this.room.setScenePath(view.focusScenePath);
                view.mode = ViewVisionMode.Writable;
            }
        }
    }
}
