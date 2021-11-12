import { AnimationMode, reaction, ViewVisionMode } from 'white-web-sdk';
import { Fields } from './AttributesDelegate';
import { debounce, isEmpty, isEqual } from 'lodash';
import type { Camera, Size, View } from "white-web-sdk";
import type { AppManager } from "./AppManager";
import { callbacks, emitter } from './index';
import { notifyMainViewModeChange, setViewFocusScenePath, setViewMode } from './Utils/Common';

export class MainViewProxy {
    private scale?: number;
    private store = this.manager.store;
    private started = false;
    private mainViewIsAddListener = false;
    private mainView: View;

    constructor(
        private manager: AppManager,
    ) {
        this.mainView = this.createMainView();
        emitter.once("mainViewMounted").then(() => {
            this.view.callbacks.on("onCameraUpdated", this.mainViewCameraListener);
            setTimeout(() => {
                this.start();
            }, 300); // 等待 mainView 挂载完毕再进行监听，否则会触发不必要的 onSizeUpdated
        })
    }

    public start() {
        if (this.started) return;
        this.addCameraListener();
        this.manager.refresher?.add(Fields.MainViewCamera, this.cameraReaction);
        this.manager.refresher?.add(Fields.MainViewSize, this.sizeReaction);
        this.view.callbacks.on("onSizeUpdated", this.sizeListener);
        this.started = true;
    }


    private get observerId() {
        return this.manager.displayer.observerId;
    }

    private cameraReaction = () => {
        return reaction(
            () => this.manager.attributes?.[Fields.MainViewCamera],
            camera => {
                if (camera && camera.id !== this.observerId) {
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
            () => this.manager.attributes?.[Fields.MainViewSize],
            size => {
                if (size && size.id !== this.observerId) {
                    this.moveCameraToContian(size);
                    this.moveCamera(this.store.getMainViewCamera());
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
        this.manager.cameraStore.setCamera("mainView", mainView.camera);
        mainView.callbacks.on("onSizeUpdated", () => {
            this.manager.boxManager.updateManagerRect();
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
        this.store.setMainViewCamera({ ...camera, id: this.observerId});
        if (this.store.getMainViewSize()?.id !== this.observerId) {
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
        this.manager.boxManager.blurFocusBox();
    }

    private sizeListener = (size: Size) => {
        this.setMainViewSize(size);
    }

    public setMainViewSize = debounce(size => {
        this.store.setMainViewSize({ ...size, id: this.observerId });
    }, 50);

    private addCameraListener() {
        this.view.callbacks.on("onCameraUpdatedByDevice", this.cameraListener);
    }

    private removeCameraListener() {
        this.view.callbacks.off("onCameraUpdatedByDevice", this.cameraListener);
    }

    private mainViewCameraListener = (camera: Camera) => {
        this.manager.cameraStore.setCamera("mainView", camera);
    };

    public switchViewModeToWriter(): void {
        if (!this.manager.canOperate) return;
        if (this.view) {
            if (this.view.mode === ViewVisionMode.Writable) return;
            this.view.callbacks.off("onCameraUpdated", this.mainViewCameraListener);
            notifyMainViewModeChange(callbacks, ViewVisionMode.Writable);
            setViewMode(this.view, ViewVisionMode.Writable);
            this.manager.cameraStore.recoverCamera("mainView", this.view);
            this.view.callbacks.on("onCameraUpdated", this.mainViewCameraListener);
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
}
