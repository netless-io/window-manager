import type { View, Displayer } from "white-web-sdk";

export class ViewManager {
    public views: Map<string, View> = new Map();

    constructor(private displayer: Displayer) {}

    public createView(id: string): View {
        const view = createView(this.displayer);
        this.views.set(id, view);
        return view;
    }

    public getView(id: string): View | undefined {
        return this.views.get(id);
    }

    public destroyView(id: string): void {
        const view = this.views.get(id);
        if (view) {
            try {
                view.release();
            } catch {
                // ignore
            }
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
            try {
                view.release();
            } catch {
                // ignore
            }
        });
        this.views.clear();
    }
}

export const createView = (displayer: Displayer): View => {
    const view = displayer.views.createView();
    setDefaultCameraBound(view);
    return view;
};

export const setDefaultCameraBound = (view: View) => {
    view.setCameraBound({
        maxContentMode: () => 10,
        minContentMode: () => 0.1,
    });
};
