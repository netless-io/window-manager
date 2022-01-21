import { AnimationMode, reaction } from "white-web-sdk";
import { callbacks, emitter } from "../index";
import { createView } from "./ViewManager";
import { debounce, isEmpty, isEqual } from "lodash";
import { Fields } from "../AttributesDelegate";
import { setViewFocusScenePath } from "../Utils/Common";
import { SideEffectManager } from "side-effect-manager";
import type { Camera, Size, View } from "white-web-sdk";
import type { AppManager } from "../AppManager";

export class MainViewProxy {
    private scale?: number;
    private started = false;
    private mainViewIsAddListener = false;
    private mainView: View;
    private store = this.manager.store;

    private sideEffectManager = new SideEffectManager();

    constructor(private manager: AppManager) {
        this.mainView = this.createMainView();
        this.moveCameraSizeByAttributes();
        emitter.once("mainViewMounted").then(() => {
            this.addMainViewListener();
            setTimeout(() => {
                this.start();
                if (!this.mainViewCamera || !this.mainViewSize) {
                    this.setCameraAndSize();
                }
            }, 200); // 等待 mainView 挂载完毕再进行监听，否则会触发不必要的 onSizeUpdated
        });
        const playgroundSizeChangeListener = () => {
            this.sizeChangeHandler(this.mainViewSize);
        };
        this.sideEffectManager.add(() => {
            emitter.on("playgroundSizeChange", playgroundSizeChangeListener);
            return () => emitter.off("playgroundSizeChange", playgroundSizeChangeListener);
        });
    }

    private get mainViewCamera() {
        return this.store.getMainViewCamera();
    }

    private get mainViewSize() {
        return this.store.getMainViewSize();
    }

    private moveCameraSizeByAttributes() {
        this.moveCameraToContian(this.mainViewSize);
        this.moveCamera(this.mainViewCamera);
    }

    public start() {
        if (this.started) return;
        this.sizeChangeHandler(this.mainViewSize);
        this.addCameraListener();
        this.manager.refresher?.add(Fields.MainViewCamera, this.cameraReaction);
        this.started = true;
    }

    public setCameraAndSize(): void {
        this.store.setMainViewCamera({ ...this.mainView.camera, id: this.manager.uid });
        this.store.setMainViewSize({ ...this.mainView.size, id: this.manager.uid });
    }

    private cameraReaction = () => {
        return reaction(
            () => this.mainViewCamera,
            camera => {
                if (camera && camera.id !== this.manager.uid) {
                    this.moveCameraToContian(this.mainViewSize);
                    this.moveCamera(camera);
                }
            },
            {
                fireImmediately: true,
            }
        );
    };

    private sizeChangeHandler = debounce((size: Size) => {
        if (size) {
            this.moveCameraToContian(size);
            this.moveCamera(this.mainViewCamera);
        }
    }, 30);

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
        const mainViewScenePath = this.store.getMainViewScenePath();
        if (mainViewScenePath) {
            setViewFocusScenePath(this.view, mainViewScenePath);
        }
    }

    private onCameraUpdatedByDevice = (camera: Camera) => {
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
    }

    private mainViewClickListener = () => {
        this.mainViewClickHandler();
    };

    public async mainViewClickHandler(): Promise<void> {
        if (!this.manager.canOperate) return;
        this.store.cleanFocus();
        this.manager.boxManager?.blurAllBox();
    }

    public setMainViewSize = debounce(size => {
        this.store.setMainViewSize({ ...size, id: this.manager.uid });
    }, 50);

    private addCameraListener() {
        this.view.callbacks.on("onCameraUpdatedByDevice", this.onCameraUpdatedByDevice);
        this.view.callbacks.on("onCameraUpdated", this.onCameraOrSizeUpdated);
        this.view.callbacks.on("onSizeUpdated", this.onCameraOrSizeUpdated);
    }

    private removeCameraListener() {
        this.view.callbacks.off("onCameraUpdatedByDevice", this.onCameraUpdatedByDevice);
        this.view.callbacks.off("onCameraUpdated", this.onCameraOrSizeUpdated);
        this.view.callbacks.off("onSizeUpdated", this.onCameraOrSizeUpdated);
    }

    private onCameraOrSizeUpdated = () => {
        callbacks.emit("cameraStateChange", this.cameraState);
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
        this.removeMainViewListener();
        this.removeCameraListener();
        this.manager.refresher?.remove(Fields.MainViewCamera);
        this.manager.refresher?.remove(Fields.MainViewSize);
        this.started = false;
    }

    public destroy() {
        this.stop();
        this.sideEffectManager.flushAll();
    }
}
