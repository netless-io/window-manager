import { AnimationMode, reaction } from 'white-web-sdk';
import { Fields } from './AttributesDelegate';
import { debounce, isEmpty, isEqual } from 'lodash';
import type { Camera, Size, View } from "white-web-sdk";
import type { AppManager } from "./AppManager";
import { emitter } from './index';

export class MainViewProxy {
    private scale?: number;
    private delegate = this.manager.delegate;
    private started = false;
    private observerId = this.manager.displayer.observerId;

    constructor(
        private manager: AppManager,
    ) {
        emitter.once("mainViewMounted").then(() => {
            setTimeout(() => {
                this.start();
            }, 300); // 等待 mainView 挂载完毕再进行监听，否则会触发不必要的 onSizeUpdated
        })
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
                    this.moveCamera(this.delegate.getMainViewCamera());
                }
            },
            {
                fireImmediately: true,
            }
        )
    }

    public get view(): View {
        return this.manager.viewManager.mainView;   
    }

    private cameraListener = (camera: Camera) => {
        this.delegate.setMainViewCamera({ ...camera, id: this.observerId});
        if (this.delegate.getMainViewSize()?.id !== this.observerId) {
            this.setMainViewSize(this.view.size);
        }
    }

    private sizeListener = (size: Size) => {
        this.setMainViewSize(size);
    }

    public setMainViewSize = debounce(size => {
        this.manager.delegate.setMainViewSize({ ...size, id: this.observerId });
    }, 50);

    private addCameraListener() {
        this.view.callbacks.on("onCameraUpdatedByDevice", this.cameraListener);
    }

    private removeCameraListener() {
        this.view.callbacks.off("onCameraUpdatedByDevice", this.cameraListener);
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

    public start() {
        if (this.started) return;
        this.addCameraListener();
        this.manager.refresher?.add(Fields.MainViewCamera, this.cameraReaction);
        this.manager.refresher?.add(Fields.MainViewSize, this.sizeReaction);
        this.view.callbacks.on("onSizeUpdated", this.sizeListener);
        this.started = true;
    }

    public stop() {
        this.removeCameraListener();
        this.manager.refresher?.remove(Fields.MainViewCamera);
        this.manager.refresher?.remove(Fields.MainViewSize);
        this.view.callbacks.off("onSizeUpdated", this.sizeListener);
        this.started = false;
    }
}
