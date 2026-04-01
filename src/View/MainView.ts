import { AnimationMode, reaction, ViewMode } from "white-web-sdk";
import { callbacks } from "../callback";
import { createView } from "./ViewManager";
import { debounce, get, isEmpty, isEqual } from "lodash";
import { internalEmitter } from "../InternalEmitter";
import { Fields } from "../AttributesDelegate";
import { setViewFocusScenePath } from "../Utils/Common";
import { SideEffectManager } from "side-effect-manager";
import type { Camera, Room, Size, View } from "white-web-sdk";
import type { AppManager } from "../AppManager";
import { Events } from "../constants";
import { LocalConsole } from "../Utils/log";

export class MainViewProxy {
    /** Refresh the view's camera in an interval of 1.5s. */
    public polling = false;

    private scale?: number;
    private started = false;
    private mainViewIsAddListener = false;
    private isForcingMainViewDivElement = false;
    private wrapperRectWorkaroundFrame = 0;
    private pendingWrapperRectChange?: { width: number; height: number; origin?: string };
    private mainView: View;
    private store = this.manager.store;
    private viewMode = this.manager.windowManger.viewMode;

    private sideEffectManager = new SideEffectManager();

    private playgroundSizeChangeListenerLocalConsole = new LocalConsole("playgroundSizeChangeListener", 30);
    private sizeUpdatedLocalConsole = new LocalConsole("sizeUpdated", 30);
    private cameraUpdatedLocalConsole = new LocalConsole("cameraUpdated", 30);

    constructor(private manager: AppManager) {
        this.mainView = this.createMainView();
        this.moveCameraSizeByAttributes();
        internalEmitter.once("mainViewMounted").then(() => {
            this.addMainViewListener();
            this.start();
            this.ensureCameraAndSize();
            this.startListenWritableChange();
        });
        const playgroundSizeChangeListener = () => {
            this.playgroundSizeChangeListenerLocalConsole.log(
                JSON.stringify(this.mainView.camera),
                JSON.stringify(this.mainView.size), 
                JSON.stringify(this.mainViewSize), 
                JSON.stringify(this.mainViewCamera),
                window.outerHeight, window.outerWidth, 
                window.visualViewport?.width ?? "null", window.visualViewport?.height ?? "null",
                window.visualViewport?.offsetLeft ?? "null", window.visualViewport?.offsetTop ?? "null",
            );
            this.sizeChangeHandler(this.mainViewSize);
        };
        this.sideEffectManager.add(() => {
            return internalEmitter.on("playgroundSizeChange", playgroundSizeChangeListener);
        });
        this.sideEffectManager.add(() => {
            return internalEmitter.on("containerSizeRatioUpdate", this.onUpdateContainerSizeRatio);
        });
        this.sideEffectManager.add(() => {
            return internalEmitter.on("wrapperRectChange", this.onWrapperRectChange);
        });
        this.sideEffectManager.add(() => {
            return internalEmitter.on("startReconnect", () => {
                if (!this.didRelease) {
                    this.mainView.release();
                }
            });
        });
        this.sideEffectManager.setInterval(this.syncCamera, 1500);
    }

    // Guard function when the camera is not synced
    private syncCamera = () => {
        if (!this.polling || this.viewMode !== ViewMode.Broadcaster) return;
        const { mainViewCamera } = this;
        if (mainViewCamera && mainViewCamera.id !== this.manager.uid) {
            this.moveCameraSizeByAttributes();
        }
    };

    private startListenWritableChange = () => {
        this.sideEffectManager.add(() => {
            return internalEmitter.on("writableChange", isWritable => {
                if (isWritable) {
                    this.ensureCameraAndSize();
                }
                if (this.manager.room) this.syncMainView(this.manager.room);
            });
        });
    };

    public ensureCameraAndSize() {
        if (this.viewMode !== ViewMode.Broadcaster) return;
        if (!this.mainViewCamera || !this.mainViewSize) {
            this.manager.dispatchInternalEvent(Events.InitMainViewCamera);
            this.setCameraAndSize();
        }
    }

    private get mainViewCamera() {
        return this.store.getMainViewCamera();
    }

    private get mainViewSize() {
        return this.store.getMainViewSize();
    }

    private get didRelease(): boolean {
        return get(this.view, ["didRelease"]);
    }

    private moveCameraSizeByAttributes() {
        this.moveCameraToContian(this.mainViewSize);
        this.moveCamera(this.mainViewCamera);
    }

    private onWrapperRectChange = (payload: { width: number; height: number; origin?: string }) => {
        this.pendingWrapperRectChange = payload;
        if (this.wrapperRectWorkaroundFrame) {
            cancelAnimationFrame(this.wrapperRectWorkaroundFrame);
        }
        this.wrapperRectWorkaroundFrame = requestAnimationFrame(this.runWrapperRectWorkaround);
    };

    private runWrapperRectWorkaround = () => {
        this.wrapperRectWorkaroundFrame = 0;
        const payload = this.pendingWrapperRectChange;
        const element = this.mainView.divElement;
        this.pendingWrapperRectChange = undefined;
        if (!payload || !element) return;

        const rect = element.getBoundingClientRect();
        const observedSize = { width: rect.width, height: rect.height };
        const wrapperMatchesDom =
            Math.abs(payload.width - observedSize.width) <= 0.5 &&
            Math.abs(payload.height - observedSize.height) <= 0.5;
        const viewIsStale =
            Math.abs(this.mainView.size.width - observedSize.width) > 0.5 ||
            Math.abs(this.mainView.size.height - observedSize.height) > 0.5;

        if (wrapperMatchesDom && viewIsStale) {
            this.forceSyncMainViewDivElement(
                `wrapperRectChange:${payload.origin || "unknown"}`,
                observedSize,
                element
            );
        }
    };

    private forceSyncMainViewDivElement(
        reason: string,
        observedSize: Pick<Size, "width" | "height">,
        element: HTMLDivElement
    ) {
        const { width: viewWidth, height: viewHeight } = this.mainView.size;
        if (
            Math.abs(viewWidth - observedSize.width) <= 0.5 &&
            Math.abs(viewHeight - observedSize.height) <= 0.5
        ) {
            return;
        }
        if (this.isForcingMainViewDivElement) {
            console.log("[window-manager] skipForceSyncMainViewDivElement " + JSON.stringify({
                reason,
                observedSize,
                viewSize: this.mainView.size,
            }));
            return;
        }
        this.isForcingMainViewDivElement = true;
        console.log("[window-manager] forceSyncMainViewDivElement " + JSON.stringify({
            reason,
            observedSize,
            viewSize: this.mainView.size,
            mainViewSize: this.mainViewSize,
            mainViewCamera: this.mainViewCamera,
        }));
        this.mainView.divElement = null;
        this.mainView.divElement = element;
        queueMicrotask(() => {
            const rect = element.getBoundingClientRect();
            console.log("[window-manager] forceSyncMainViewDivElementResult " + JSON.stringify({
                reason,
                viewSize: this.mainView.size,
                rect: { width: rect.width, height: rect.height },
            }));
            this.isForcingMainViewDivElement = false;
        });
    }

    public start() {
        console.log("[window-manager] start attributes size:" + JSON.stringify(this.mainViewSize));
        this.sizeChangeHandler(this.mainViewSize);
        if (this.started) return;
        this.addCameraListener();
        this.addCameraReaction();
        if (this.manager.room) this.syncMainView(this.manager.room);
        this.started = true;
        if(this.mainView.focusScenePath) {
            this.manager.windowManger.onMainViewScenePathChangeHandler(this.mainView.focusScenePath);
        }
        console.log("[window-manager] start end mainView size:" + JSON.stringify(this.mainView.size));
    }

    public addCameraReaction = () => {
        this.manager.refresher.add(Fields.MainViewCamera, this.cameraReaction);
    };

    public setCameraAndSize(): void {
        const camera = { ...this.mainView.camera, id: this.manager.uid };
        const size = { ...this.mainView.size, id: this.manager.uid };
        this.store.setMainViewCameraAndSize(camera, size);
    }

    private cameraReaction = () => {
        return reaction(
            () => this.mainViewCamera,
            camera => {
                if (camera && camera.id !== this.manager.uid) {
                    console.log("[window-manager] cameraReaction  " + JSON.stringify(camera) + JSON.stringify(this.mainViewSize));
                    this.moveCameraToContian(this.mainViewSize);
                    this.moveCamera(camera);
                }
            },
            { fireImmediately: true }
        );
    };

    public sizeChangeHandler = debounce((size: Size) => {
        if (size) {
            this.moveCameraToContian(size);
            this.moveCamera(this.mainViewCamera);
            console.log("[window-manager] sizeChangeHandler current size and camera" + JSON.stringify(size) + JSON.stringify(this.mainViewCamera) +
            JSON.stringify(this.mainView.camera) + JSON.stringify(this.mainView.size));
        }
        this.ensureMainViewSize();
    }, 30);

    public onUpdateContainerSizeRatio = () => {
        const size = this.store.getMainViewSize();
        console.log("[window-manager] onUpdateContainerSizeRatio  " + JSON.stringify(size));
        this.sizeChangeHandler(size);
    };

    public get view(): View {
        return this.mainView;
    }

    public get cameraState() {
        return { ...this.view.camera, ...this.view.size };
    }

    public createMainView(): View {
        const mainView = createView(this.manager.displayer);
        const mainViewScenePath = this.store.getMainViewScenePath();
        if (mainViewScenePath) {
            setViewFocusScenePath(mainView, mainViewScenePath);
        }
        return mainView;
    }

    public onReconnect(): void {
        if (this.didRelease) {
            this.rebind();
        } else {
            const mainViewScenePath = this.store.getMainViewScenePath();
            this.setFocusScenePath(mainViewScenePath);
        }
    }

    public setFocusScenePath(path: string | undefined) {
        if (path) {
            return setViewFocusScenePath(this.view, path);
        }
    }

    public rebind(): void {
        const divElement = this.mainView.divElement;
        const disableCameraTransform = this.mainView.disableCameraTransform;
        this.stop();
        if (!this.didRelease) {
            this.mainView.release();
        }
        this.removeMainViewListener();
        this.mainView = this.createMainView();
        this.mainView.disableCameraTransform = disableCameraTransform;
        this.mainView.divElement = divElement;
        this.addMainViewListener();
        this.start();
        callbacks.emit("onMainViewRebind", this.mainView);
    }

    private onCameraUpdatedByDevice = (camera: Camera) => {
        if (this.viewMode === ViewMode.Follower) return;
        this.store.setMainViewCamera({ ...camera, id: this.manager.uid });
        if (!isEqual(this.mainViewSize, { ...this.mainView.size, id: this.manager.uid })) {
            this.setMainViewSize(this.view.size);
        }
    };

    public addMainViewListener(): void {
        if (this.mainViewIsAddListener) return;
        if (this.view.divElement) {
            this.view.divElement.addEventListener("click", this.mainViewClickListener);
            this.view.divElement.addEventListener("touchend", this.mainViewClickListener);
            this.mainViewIsAddListener = true;
        }
    }

    public removeMainViewListener(): void {
        if (this.view.divElement) {
            this.view.divElement.removeEventListener("click", this.mainViewClickListener);
            this.view.divElement.removeEventListener("touchend", this.mainViewClickListener);
        }
        this.mainViewIsAddListener = false;
    }

    private mainViewClickListener = () => {
        this.mainViewClickHandler();
    };

    public async mainViewClickHandler(): Promise<void> {
        if (!this.manager.canOperate) return;
        this.store.cleanFocus();
        this.manager.boxManager?.blurAllBox();
    }

    public setMainViewSize = debounce((size: Size) => {
        this.store.setMainViewSize({ ...size, id: this.manager.uid });
    }, 50);

    private addCameraListener() {
        this.view.callbacks.on("onCameraUpdatedByDevice", this.onCameraUpdatedByDevice);
        this.view.callbacks.on("onCameraUpdated", this.onCameraUpdated);
        this.view.callbacks.on("onSizeUpdated", this.onSizeUpdated);
    }

    private removeCameraListener() {
        this.view.callbacks.off("onCameraUpdatedByDevice", this.onCameraUpdatedByDevice);
        this.view.callbacks.off("onCameraUpdated", this.onCameraUpdated);
        this.view.callbacks.off("onSizeUpdated", this.onSizeUpdated);
    }

    private _syncMainViewTimer = 0;
    private handleCameraOrSizeUpdated = () => {
        callbacks.emit("cameraStateChange", this.cameraState);
        // sdk >= 2.16.43 的 syncMainView() 可以写入当前 main view 的 camera, 以修复复制粘贴元素的位置
        // 注意到这个操作会发送信令，应当避免频繁调用
        if (this.manager.room && (this.manager.room as any).syncMainView) {
            clearTimeout(this._syncMainViewTimer);
            this._syncMainViewTimer = setTimeout(this.syncMainView, 100, this.manager.room);
        }
        this.ensureMainViewSize();
    };

    private onCameraUpdated = (camera: Camera) => {
        this.cameraUpdatedLocalConsole.log(JSON.stringify(camera));
        this.handleCameraOrSizeUpdated();
    };

    private onSizeUpdated = (size: Size) => {
        this.sizeUpdatedLocalConsole.log(JSON.stringify(size));
        this.handleCameraOrSizeUpdated();
    };

    private ensureMainViewSize() {
        if (
            (!this.mainViewSize ||
                this.mainViewSize.width === 0 ||
                this.mainViewSize.height === 0) &&
            this.mainView.size.width > 0 &&
            this.mainView.size.height > 0
        ) {
            this.setMainViewSize(this.mainView.size);
        }
    }

    private syncMainView = (room: Room) => {
        if (room.isWritable) {
            console.log("[window-manager] syncMainView ");
            room.syncMainView(this.mainView);
        }
    };

    public moveCameraToContian(size: Size): void {
        if (!isEmpty(size)) {
            this.view.moveCameraToContain({
                width: size.width,
                height: size.height,
                originX: -size.width / 2,
                originY: -size.height / 2,
                animationMode: AnimationMode.Immediately,
            });
            this.scale = this.view.camera.scale;
        }
    }

    public moveCamera(camera: Camera): void {
        if (!isEmpty(camera)) {
            if (isEqual(camera, this.view.camera)) return;
            const { centerX, centerY, scale } = camera;
            const needScale = scale * (this.scale || 1);
            this.view.moveCamera({
                centerX: centerX,
                centerY: centerY,
                scale: needScale,
                animationMode: AnimationMode.Immediately,
            });
        }
    }

    public stop() {
        this.removeCameraListener();
        this.manager.refresher.remove(Fields.MainViewCamera);
        this.manager.refresher.remove(Fields.MainViewSize);
        this.started = false;
    }

    public setViewMode = (mode: ViewMode) => {
        this.viewMode = mode;
    };

    public destroy() {
        console.log("[window-manager] destroy  ");
        if (this.wrapperRectWorkaroundFrame) {
            cancelAnimationFrame(this.wrapperRectWorkaroundFrame);
            this.wrapperRectWorkaroundFrame = 0;
        }
        this.removeMainViewListener();
        this.stop();
        this.sideEffectManager.flushAll();
    }
}
