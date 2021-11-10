import { callbacks, WindowManager } from './index';
import { debounce } from 'lodash';
import { reaction, ViewVisionMode } from 'white-web-sdk';
import { SET_SCENEPATH_DELAY } from './constants';
import { TELE_BOX_STATE } from '@netless/telebox-insider';
import {
    notifyMainViewModeChange,
    setScenePath,
    setViewFocusScenePath,
    setViewMode,
} from "./Utils/Common";
import type { Camera, Displayer, View } from "white-web-sdk";
import type { AppManager } from "./AppManager";
import type { CameraStore } from "./Utils/CameraStore";
import { Base } from './Base';

export class ViewManager extends Base {
    public mainView: View;
    private views: Map<string, View> = new Map();
    private mainViewIsAddListener = false;
    private timer?: number;

    constructor(
        private displayer: Displayer,
        manager: AppManager,
        private cameraStore: CameraStore
    ) {
        super(manager);
        this.mainView = this.createMainView();
        this.addMainViewCameraListener();
        setTimeout(() => { // 延迟初始化 focus 的 reaction
            this.manager.refresher?.add("focus", () => {
                return reaction(
                    () => this.store.focus,
                    focus => {
                        if (focus) {
                            this.switchAppToWriter(focus);
                        } else {
                            this.switchMainViewToWriter();
                        }
                    },
                    { fireImmediately: true }
                )
            });
        }, 100)
    }

    public get currentScenePath(): string {
        return this.displayer.state.sceneState.scenePath;
    }

    public createMainView(): View {
        const mainView = this.displayer.views.createView();
        this.cameraStore.setCamera("mainView", mainView.camera);
        mainView.callbacks.on("onSizeUpdated", () => {
            this.manager.boxManager.updateManagerRect();
        });
        const mainViewScenePath = this.store.getMainViewScenePath();
        if (mainViewScenePath) {
            setViewFocusScenePath(mainView, mainViewScenePath);
        }
        if (!this.store.focus) {
            this.switchMainViewModeToWriter();
        }
        return mainView;
    }

    public setMainViewSize = debounce(size => {
        this.store.setMainViewSize({ ...size });
    }, 200);

    public createView(appId: string): View {
        const view = this.displayer.views.createView();
        this.cameraStore.setCamera(appId, view.camera);
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

    private addMainViewCameraListener() {
        this.mainView.callbacks.on("onCameraUpdated", this.mainViewCameraListener);
    }

    private removeMainViewCameraListener() {
        this.mainView.callbacks.off("onCameraUpdated", this.mainViewCameraListener);
    }

    public switchMainViewToFreedom(): void {
        this.store.setMainViewFocusPath();
        notifyMainViewModeChange(callbacks, ViewVisionMode.Freedom);
        setViewMode(this.mainView, ViewVisionMode.Freedom);
    }

    public switchMainViewModeToWriter(): void {
        if (!this.manager.canOperate) return;
        if (this.mainView) {
            if (this.mainView.mode === ViewVisionMode.Writable) return;
            notifyMainViewModeChange(callbacks, ViewVisionMode.Writable);
            setViewMode(this.mainView, ViewVisionMode.Writable);
        }
    }

    public addMainViewListener(): void {
        if (this.mainViewIsAddListener) return;
        if (this.mainView.divElement) {
            this.mainView.divElement.addEventListener("click", this.mainViewClickListener);
            this.mainView.divElement.addEventListener("touchend", this.mainViewClickListener);
            this.mainViewIsAddListener = true;
        }
    }

    public removeMainViewListener(): void {
        if (this.mainView.divElement) {
            this.mainView.divElement.removeEventListener("click", this.mainViewClickListener);
            this.mainView.divElement.removeEventListener("touchend", this.mainViewClickListener);
        }
    }

    private mainViewClickListener = () => {
        this.mainViewClickHandler();
    };

    public async mainViewClickHandler(): Promise<void> {
        if (!this.manager.canOperate) return;
        if (this.mainView.mode === ViewVisionMode.Writable) return;
        this.store.cleanFocus();
        this.manager.boxManager.blurFocusBox();
    }

    private mainViewCameraListener = (camera: Camera) => {
        this.cameraStore.setCamera("mainView", camera);
    };

    public switchMainViewToWriter(): Promise<boolean> | undefined {
        if (this.timer) {
            clearTimeout(this.timer);
        }
        if (this.mainView.mode === ViewVisionMode.Writable) return;
        return new Promise((resolve, reject) => {
            this.timer = window.setTimeout(() => {
                try {
                    const mainViewScenePath = this.store.getMainViewScenePath();
                    if (mainViewScenePath) {
                        this.freedomAllViews();
                        this.removeMainViewCameraListener();
                        setScenePath(this.manager.room, mainViewScenePath);
                        this.switchMainViewModeToWriter();
                        this.manager.cameraStore.recoverCamera("mainView", this.mainView);
                        this.addMainViewCameraListener();
                    }
                    resolve(true);
                } catch (error) {
                    reject(error);
                }
            }, SET_SCENEPATH_DELAY);
        });
    }

    public refreshViews(): void {
        const focus = this.store.focus;
        this.setMainViewFocusScenePath();
        if (focus) {
            const appProxy = this.manager.appProxies.get(focus);
            if (appProxy) {
                if (appProxy.view?.mode === ViewVisionMode.Writable) return;
                appProxy.removeCameraListener();
                appProxy.switchToWritable();
                appProxy.recoverCamera();
                appProxy.addCameraListener();
            }
        } else {
            if (this.manager.mainView.mode === ViewVisionMode.Writable) return;
            this.switchMainViewToWriter();
        }
    }

    public setMainViewFocusScenePath() {
        const mainViewScenePath = this.store.getMainViewScenePath();
        if (mainViewScenePath) {
            setViewFocusScenePath(this.manager.mainView, mainViewScenePath);
        }
    }

    public freedomAllViews(): void {
        this.manager.appProxies.forEach(appProxy => {
            appProxy.setViewFocusScenePath();
            if (appProxy.view) {
                setViewMode(appProxy.view, ViewVisionMode.Freedom)
            }
        });
        if (this.mainView.mode === ViewVisionMode.Writable) {
            notifyMainViewModeChange(callbacks, ViewVisionMode.Freedom);
            this.mainView.mode = ViewVisionMode.Freedom;
        }
        if (!this.manager.viewManager.mainView.focusScenePath) {
            this.store.setMainViewFocusPath();
        }
    }

    public switchAppToWriter(id: string): void {
        this.freedomAllViews();
        // 为了同步端不闪烁, 需要给 room setScenePath 一个延迟
        setTimeout(() => {
            const appProxy = this.manager.appProxies.get(id);
            if (appProxy) {
                const boxState = this.store.getBoxState();
                if (boxState && boxState === TELE_BOX_STATE.Minimized) {
                    return;
                }
                appProxy.removeCameraListener();
                appProxy.setScenePath();
                appProxy.switchToWritable();
                appProxy.recoverCamera();
                appProxy.addCameraListener();
                appProxy.focusBox();
            }
        }, SET_SCENEPATH_DELAY);
    }

    public destroy(): void {
        this.removeMainViewListener();
        if (WindowManager.wrapper) {
            WindowManager.wrapper.parentNode?.removeChild(WindowManager.wrapper);
            WindowManager.wrapper = undefined;
        }
        this.releaseView(this.mainView);
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
