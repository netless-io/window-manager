import { AnimationMode, reaction, ViewVisionMode } from 'white-web-sdk';
import { Base } from './Base';
import { callbacks, emitter } from './index';
import { debounce, isEmpty, isEqual } from 'lodash';
import { Fields } from './AttributesDelegate';
import { notifyMainViewModeChange, setViewFocusScenePath, setViewMode } from './Utils/Common';
import type { Camera, Size, View } from "white-web-sdk";
import type { AppManager } from "./AppManager";

export class MainViewProxy extends Base {
    private scale?: number;
    private cameraStore = this.manager.cameraStore;
    private started = false;
    private mainViewIsAddListener = false;
    private mainView: View;
    private viewId = "mainView";

    constructor(manager: AppManager) {
        super(manager);
        this.mainView = this.createMainView();
        this.moveCameraSizeByAttributes();
        this.cameraStore.register(this.viewId, this.mainView);
        emitter.once("mainViewMounted").then(() => {
            setTimeout(() => {
                this.start();
            }, 200); // 等待 mainView 挂载完毕再进行监听，否则会触发不必要的 onSizeUpdated
        })
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
        this.addCameraListener();
        this.manager.refresher?.add(Fields.MainViewCamera, this.cameraReaction);
        this.manager.refresher?.add(Fields.MainViewSize, this.sizeReaction);
        this.view.callbacks.on("onSizeUpdated", this.sizeListener);
        this.started = true;
    }

    public setCameraAndSize(): void {
        this.store.setMainViewCamera({ ...this.mainView.camera, id: this.context.uid  });
        this.store.setMainViewSize({ ...this.mainView.size, id: this.context.uid });
    }

    private cameraReaction = () => {
        return reaction(
            () => this.mainViewCamera,
            camera => {
                if (camera && camera.id !== this.context.uid) {
                    this.moveCamera(camera);
                }
            },
            {
                fireImmediately: true,
            }
        )
    }

    private sizeReaction = () => {
        return reaction(
            () => this.mainViewSize,
            size => {
                if (size && size.id !== this.context.uid) {
                    this.moveCameraToContian(size);
                    this.moveCamera(this.mainViewCamera);
                }
            },
            {
                fireImmediately: true,
            }
        )
    }

    public get view(): View {
        return this.mainView;
    }

    public createMainView(): View {
        const mainView = this.manager.displayer.views.createView();
        mainView.callbacks.on("onSizeUpdated", () => {
            this.context.updateManagerRect();
        });
        const mainViewScenePath = this.store.getMainViewScenePath();
        if (mainViewScenePath) {
            setViewFocusScenePath(mainView, mainViewScenePath);
        }
        if (!this.store.focus) {
            this.switchViewModeToWriter();
        }
        return mainView;
    }

    private cameraListener = (camera: Camera) => {
        this.store.setMainViewCamera({ ...camera, id: this.context.uid});
        if (this.store.getMainViewSize()?.id !== this.context.uid) {
            this.setMainViewSize(this.view.size);
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
    }

    private mainViewClickListener = () => {
        this.mainViewClickHandler();
    };

    public async mainViewClickHandler(): Promise<void> {
        if (!this.manager.canOperate) return;
        if (this.view.mode === ViewVisionMode.Writable) return;
        this.store.cleanFocus();
        this.context.blurFocusBox();
    }

    private sizeListener = (size: Size) => {
        this.setMainViewSize(size);
    }

    public setMainViewSize = debounce(size => {
        this.store.setMainViewSize({ ...size, id: this.context.uid });
    }, 50);

    private addCameraListener() {
        this.view.callbacks.on("onCameraUpdatedByDevice", this.cameraListener);
    }

    private removeCameraListener() {
        this.view.callbacks.off("onCameraUpdatedByDevice", this.cameraListener);
    }

    public switchViewModeToWriter(): void {
        if (!this.manager.canOperate) return;
        if (this.view) {
            if (this.view.mode === ViewVisionMode.Writable) return;
            this.cameraStore.switchView(this.viewId, this.mainView, () => {
                notifyMainViewModeChange(callbacks, ViewVisionMode.Writable);
                setViewMode(this.view, ViewVisionMode.Writable);
            });
        }
    }

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
        this.view.callbacks.off("onSizeUpdated", this.sizeListener);
        this.started = false;
    }

    public destroy() {
        this.stop();
        this.cameraStore.unregister(this.viewId, this.mainView);
    }
}
