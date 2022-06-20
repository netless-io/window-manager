import { callbacks } from "../callback";
import { CameraSynchronizer } from "./CameraSynchronizer";
import { createView } from "./ViewManager";
import { debounce, get, isEqual } from "lodash";
import { emitter } from "../InternalEmitter";
import { Events } from "../constants";
import { Fields } from "../AttributesDelegate";
import { reaction } from "white-web-sdk";
import { releaseView, setViewFocusScenePath } from "../Utils/Common";
import { SideEffectManager } from "side-effect-manager";
import type { Camera, Size, View } from "white-web-sdk";
import type { AppManager } from "../AppManager";

export class MainViewProxy {
    private started = false;
    private mainViewIsAddListener = false;
    private mainView: View;
    private store = this.manager.store;
    private synchronizer: CameraSynchronizer;

    private sideEffectManager = new SideEffectManager();

    constructor(private manager: AppManager) {
        this.synchronizer = new CameraSynchronizer(camera =>
            this.store.setMainViewCamera({ ...camera, id: this.manager.uid })
        );
        this.mainView = this.createMainView();
        this.moveCameraSizeByAttributes();
        emitter.once("mainViewMounted").then(() => {
            this.addMainViewListener();
            this.start();
            this.ensureCameraAndSize();
            this.startListenWritableChange();
        });
        this.sideEffectManager.add(() => {
            return emitter.on("containerSizeRatioUpdate", this.onUpdateContainerSizeRatio);
        });
        this.sideEffectManager.add(() => {
            return emitter.on("startReconnect", () => {
                releaseView(this.mainView);
            });
        });
        const rect = this.manager.boxManager?.stageRect;
        if (rect) {
            this.synchronizer.setRect(rect);
        }
        this.sideEffectManager.add(() => {
            return emitter.on("playgroundSizeChange", rect => {
                this.synchronizer.setRect(rect);
                // this.synchronizer.onLocalSizeUpdate(rect);
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
    };

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
        this.synchronizer.onRemoteUpdate(this.mainViewCamera, this.mainViewSize);
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
        const stageSize = this.getStageSize();
        if (stageSize) {
            const camera = { ...this.mainView.camera, id: this.manager.uid };
            const size = { ...stageSize, id: this.manager.uid };
            this.store.setMainViewCameraAndSize(camera, size);
        }
    }

    private cameraReaction = () => {
        return reaction(
            () => this.mainViewCamera,
            camera => {
                if (camera && camera.id !== this.manager.uid) {
                    this.synchronizer.onRemoteUpdate(camera, this.mainViewSize);
                }
            },
            { fireImmediately: true }
        );
    };

    public sizeChangeHandler = debounce((size: Size) => {
        if (size) {
            // this.synchronizer.onLocalSizeUpdate(size);
        }
    }, 30);

    public onUpdateContainerSizeRatio = () => {
        const size = this.store.getMainViewSize();
        this.sizeChangeHandler(size);
        if (size.id === this.manager.uid) {
            this.setCameraAndSize();
        }
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
        this.synchronizer.setView(mainView);
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
        releaseView(this.mainView);
        this.removeMainViewListener();
        this.mainView = this.createMainView();
        this.mainView.disableCameraTransform = disableCameraTransform;
        this.mainView.divElement = divElement;
        this.addMainViewListener();
        this.start();
    }

    private onCameraUpdatedByDevice = (camera: Camera) => {
        this.synchronizer.onLocalCameraUpdate(camera);
        const size = this.getStageSize();
        if (size && !isEqual(size, this.mainViewSize)) {
            this.setMainViewSize(size);
        }
    };

    private getStageSize(): Size | undefined {
        const stage = this.manager.boxManager?.stageRect;
        if (stage) {
            return { width: stage.width, height: stage.height };
        }
    }

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
