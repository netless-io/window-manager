import type { View , Displayer} from "white-web-sdk";
import type { AppManager } from "./AppManager";

export class ViewManager {
    public views: Map<string, View> = new Map();

    constructor(manager: AppManager, private displayer: Displayer) {
        manager.addReaction("focus", () => manager.store.focus, (focus) => {
            if (focus) {
                manager.switchAppToWriter(focus);
            } else {
                manager.boxManager.blurFocusBox();
            }
        })
    }

    public createView(id: string): View {
        const view = this.displayer.views.createView();
        this.views.set(id, view);
        return view;
    }

    public getView(id: string): View | undefined {
        return this.views.get(id);
    }

    public destroyView(id: string): void {
        const view = this.views.get(id);
        if (view) {
            view.release();
            this.views.delete(id);
        }
    }

    public setViewScenePath(id: string, scenePath: string): void {
        const view = this.views.get(id);
        if (view) {
            view.focusScenePath = scenePath;
        }
    }

    public destroy() {
        this.views.forEach(view => {
            view.release();
        });
        this.views.clear();
    }
}

