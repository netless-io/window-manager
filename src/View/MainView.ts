import { AnimationMode, reaction } from "white-web-sdk";
import { callbacks } from "../callback";
import { createView } from "./ViewManager";
import { debounce, get, isEmpty, isEqual } from "lodash";
import { emitter } from "../InternalEmitter";
import { Fields } from "../AttributesDelegate";
import { setViewFocusScenePath } from "../Utils/Common";
import { SideEffectManager } from "side-effect-manager";
import type { Camera, Size, View } from "white-web-sdk";
import type { AppManager } from "../AppManager";
import { Events } from "../constants";

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
            this.start();
            this.ensureCameraAndSize();
            this.startListenWritableChange();
        });
        const playgroundSizeChangeListener = () => {
            this.sizeChangeHandler(this.mainViewSize);
        };
        this.sideEffectManager.add(() => {
            return emitter.on("playgroundSizeChange", playgroundSizeChangeListener);
        });
        this.sideEffectManager.add(() => {
            return emitter.on("containerSizeRatioUpdate", this.onUpdateContainerSizeRatio);
        });
        this.sideEffectManager.add(() => {
            return emitter.on("startReconnect", () => {
                this.mainView.release();
            });
        });
    }

    private startListenWritableChange = () => {
        this.sideEffectManager.add(() => {
            return emitter.on("writableChange", isWritable => {
                if (isWritable) {
                    this.ensureCameraAndSize();
                }
            });
        });
    }

    public ensureCameraAndSize() {
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

    public start() {
        if (this.started) return;
        this.sizeChangeHandler(this.mainViewSize);
        this.addCameraListener();
        this.addCameraReaction();
        this.started = true;
    }

    public addCameraReaction = () => {
        this.manager.refresher?.add(Fields.MainViewCamera, this.cameraReaction);
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
        }
    }, 30);

    public onUpdateContainerSizeRatio = () => {
        const size = this.store.getMainViewSize();
        this.sizeChangeHandler(size);
    }

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
        this.removeCameraListener();
        this.manager.refresher?.remove(Fields.MainViewCamera);
        this.manager.refresher?.remove(Fields.MainViewSize);
        this.started = false;
    }

    public destroy() {
        this.removeMainViewListener();
        this.stop();
        this.sideEffectManager.flushAll();
    }
}
