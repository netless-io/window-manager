import { Base } from "./Base";
import { callbacks, WindowManager } from "./index";
import { reaction, ViewVisionMode } from "white-web-sdk";
import { SET_SCENEPATH_DELAY } from "./constants";
import { notifyMainViewModeChange, setScenePath, setViewMode } from "./Utils/Common";
import type { View, Displayer } from "white-web-sdk";
import type { AppManager } from "./AppManager";

export class ViewManager extends Base {
    private views: Map<string, View> = new Map();
    private timer?: number;
    private appTimer?: number;

    private mainViewProxy = this.manager.mainViewProxy;
    private displayer = this.manager.displayer;

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
                            this.switchMainViewToWriter();
                            this.context.blurFocusBox();
                        }
                    },
                    { fireImmediately: true }
                );
            });
        }, 100);
    }

    public get currentScenePath(): string {
        return this.displayer.state.sceneState.scenePath;
    }

    public get mainView(): View {
        return this.mainViewProxy.view;
    }

    public createView(appId: string): View {
        const view = createView(this.displayer);
        setViewMode(view, ViewVisionMode.Freedom);
        this.views.set(appId, view);
        return view;
    }

    public destroyView(appId: string): void {
        const view = this.views.get(appId);
        if (view) {
            this.releaseView(view);
            this.views.delete(appId);
        }
    }

    private releaseView(view: View) {
        if (!(view as any).didRelease) {
            view.release();
        }
    }

    public getView(appId: string): View | undefined {
        return this.views.get(appId);
    }

    public switchMainViewToWriter(): Promise<boolean> | undefined {
        if (this.timer) {
            clearTimeout(this.timer);
        }
        if (this.mainView.mode === ViewVisionMode.Writable) return;
        this.freedomAllViews();
        return new Promise((resolve, reject) => {
            this.timer = window.setTimeout(() => {
                try {
                    const mainViewScenePath = this.store.getMainViewScenePath();
                    if (mainViewScenePath) {
                        this.freedomAllViews();
                        setScenePath(this.manager.room, mainViewScenePath);
                        this.mainViewProxy.switchViewModeToWriter();
                    }
                    resolve(true);
                } catch (error) {
                    reject(error);
                }
            }, SET_SCENEPATH_DELAY);
        });
    }

    public freedomAllViews(): void {
        this.manager.appProxies.forEach(appProxy => {
            appProxy.setViewFocusScenePath();
            if (appProxy.view) {
                setViewMode(appProxy.view, ViewVisionMode.Freedom);
            }
        });
        if (this.mainView.mode === ViewVisionMode.Writable) {
            notifyMainViewModeChange(callbacks, ViewVisionMode.Freedom);
            setViewMode(this.mainView, ViewVisionMode.Freedom);
        }
        if (!this.mainView.focusScenePath) {
            this.store.setMainViewFocusPath();
        }
    }

    public switchAppToWriter(id: string): void {
        if (this.appTimer) {
            clearTimeout(this.appTimer);
        }
        this.freedomAllViews();
        // 为了同步端不闪烁, 需要给 room setScenePath 一个延迟
        this.appTimer = setTimeout(() => {
            const appProxy = this.manager.appProxies.get(id);
            if (appProxy) {
                if (this.manager.boxManager.minimized) return;
                appProxy.setScenePath();
                appProxy.switchToWritable();
                appProxy.focusBox();
            }
        }, SET_SCENEPATH_DELAY);
    }

    public destroy(): void {
        this.mainViewProxy.removeMainViewListener();
        if (WindowManager.wrapper) {
            WindowManager.wrapper.parentNode?.removeChild(WindowManager.wrapper);
            WindowManager.wrapper = undefined;
        }
        this.releaseView(this.mainView);
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
