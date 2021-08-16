import debounce from "lodash.debounce";
import get from "lodash.get";
import { AnimationMode, Camera, Room, Size, View, ViewVisionMode } from "white-web-sdk";
import { AppManager, WindowManager } from "./index";
import { log } from "./log";
import { CameraStore } from "./CameraStore";

export class ViewManager {
    public static root: HTMLElement | null;
    public static lastSize: Size | null;
    public static centerArea: HTMLElement | null;
    public mainView: View;
    private views: Map<string, View> = new Map();
    private viewListeners: Map<string, any> = new Map();
    private mainViewIsAddListener = false;

    constructor(
        private room: Room, 
        private manager: AppManager,
        private cameraStore: CameraStore) {
        this.mainView = this.createMainView();
    }

    public createMainView(): View {
        const mainView = this.room.views.createView();
        this.cameraStore.setCamera("mainView", mainView.camera);
        mainView.callbacks.on("onCameraUpdated", this.cameraListener("mainView", mainView));
        mainView.callbacks.on("onSizeUpdated", () => this.manager.boxManager.updateManagerRect());
        mainView.mode = ViewVisionMode.Writable;
        return mainView;
    }

    public createView(appId: string): View {
        const view = this.room.views.createView();
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
                view.focusScenePath === this.room.state.sceneState.scenePath) return;
            this.room.views.forEach(roomView => {
                if (roomView.mode === ViewVisionMode.Writable) {
                    roomView.focusScenePath = this.room.state.sceneState.scenePath;
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
                this.room.setScenePath(view.focusScenePath);
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
            view.focusScenePath = this.room.state.sceneState.scenePath;
        }
        view.mode = ViewVisionMode.Freedom;
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
        if (ViewManager.root) {
            if (ViewManager.centerArea) {
                ViewManager.root.removeChild(ViewManager.centerArea);
            }
            ViewManager.root = null;
            ViewManager.lastSize = null;
            ViewManager.centerArea = null;
        }
    }
}


export const setupWrapper = (root: HTMLElement) => {
    const wrapper = createWrapper();
    const mainViewElement = initMaiViewElement();
    const centerArea = document.createElement("div");
    centerArea.className = "netless-window-manager";
    centerArea.appendChild(wrapper);
    wrapper.appendChild(mainViewElement);
    root.appendChild(centerArea);
    ViewManager.centerArea = centerArea;
    ViewManager.root = root;
    WindowManager.wrapper = wrapper;
    const rootSize = getClientSize(root);
    ViewManager.lastSize = rootSize;
    updateWrapperSize(rootSize);
    rootResizeObserver.observe(root);
    return { wrapper, mainViewElement };
}

const getClientSize = (dom: HTMLElement) => {
    return { width: dom.clientWidth, height: dom.clientHeight };
}

export const createWrapper = () => {
    const wrapper = document.createElement("div");
    wrapper.className = "wrapper";
    return wrapper;
}

export const initMaiViewElement = () => {
    const element = document.createElement("div");
    element.className = "main-view";
    return element;
}

// 保证挂载区域是一个 16:9 的区域
const updateWrapperSize = (size: { width: number, height: number }) => {
    let width = size.width;
    let height = (width / 16) * 9;
    if (height > size.height) {
        width =  (size.height / 9) * 16;
        height = size.height;
    }
    if (WindowManager.wrapper && width > 0 && height > 0) {
        const widthPx = Math.floor(width) + "px";
        const heightPx = Math.floor(height) + "px";
        WindowManager.wrapper.style.width = widthPx;
        WindowManager.wrapper.style.height = heightPx;
    }
};

export const rootResizeObserver = new ResizeObserver(entries => {
    for (const entry of entries) {
        const rect = entry.contentRect;
        const width = Math.ceil(rect.width);
        const height = Math.ceil(rect.height);
        if (width !== ViewManager.lastSize?.width || height !== ViewManager.lastSize?.height) {
            updateWrapperSize({ width, height });
            ViewManager.lastSize = { width, height };
        }
    }
});
