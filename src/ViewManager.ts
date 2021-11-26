import { Base } from "./Base";
import { reaction } from "white-web-sdk";
import { WindowManager } from "./index";
import type { View } from "white-web-sdk";
import type { AppManager } from "./AppManager";

export class ViewManager extends Base {
    private views: Map<string, View> = new Map();

    constructor(manager: AppManager) {
        super(manager);
        setTimeout(() => {
            // 延迟初始化 focus 的 reaction
            this.manager.refresher?.add("focus", () => {
                return reaction(
                    () => this.store.focus,
                    focus => {
                        if (focus) {
                            this.switchAppToWriter(focus);
                        } else {
                            this.context.blurFocusBox();
                        }
                    },
                    { fireImmediately: true }
                );
            });
        }, 100);
    }

    public createView(id: string): View {
        const view = this.manager.displayer.views.createView();
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

    public cleanCurrentScene(id: string): void {
        const view = this.views.get(id);
        if (view) {
            (view as any).cleanCurrentScene();
        }
    }

    public setViewScenePath(id: string, scenePath: string): void {
        const view = this.views.get(id);
        if (view) {
            view.focusScenePath = scenePath;
        }
    }

    public switchAppToWriter(id: string): void {
        const appProxy = this.manager.appProxies.get(id);
        if (appProxy) {
            if (this.manager.boxManager.minimized) return;
            appProxy.focusBox();
        }
    }

    public destroy() {
        this.views.forEach(view => {
            view.release();
        });
        this.views.clear();
    }
}

export const setupWrapper = (
    root: HTMLElement
): {
    playground: HTMLDivElement;
    wrapper: HTMLDivElement;
    sizer: HTMLDivElement;
    mainViewElement: HTMLDivElement;
} => {
    const playground = document.createElement("div");
    playground.className = "netless-window-manager-playground";

    const sizer = document.createElement("div");
    sizer.className = "netless-window-manager-sizer";

    const wrapper = document.createElement("div");
    wrapper.className = "netless-window-manager-wrapper";

    const mainViewElement = document.createElement("div");
    mainViewElement.className = "netless-window-manager-main-view";

    playground.appendChild(sizer);
    sizer.appendChild(wrapper);
    wrapper.appendChild(mainViewElement);
    root.appendChild(playground);
    WindowManager.wrapper = wrapper;

    return { playground, wrapper, sizer, mainViewElement };
};
