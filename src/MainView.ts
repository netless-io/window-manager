import { AnimationMode, reaction } from 'white-web-sdk';
import { Fields } from './AttributesDelegate';
import { isEmpty, isEqual } from 'lodash';
import type { Camera, Size, View } from "white-web-sdk";
import type { AppManager } from "./AppManager";
import type { CameraStore } from './Utils/CameraStore';

export class MainViewProxy {
    private scale?: number;
    private displayer = this.manager.displayer;
    private delegate = this.manager.delegate;

    constructor(
        private manager: AppManager,
        private cameraStore: CameraStore,
    ) {
        this.manager.refresher?.add(Fields.MainViewCamera, () => {
            return reaction(
                () => this.manager.attributes?.[Fields.MainViewCamera],
                camera => {
                    if (this.delegate.broadcaster !== this.displayer.observerId && camera) {
                        this.moveCamera(camera);
                    }
                },
                {
                    fireImmediately: true,
                }
            )
        });

        this.manager.refresher?.add(Fields.MainViewSize, () => {
            return reaction(
                () => this.manager.attributes?.[Fields.MainViewSize],
                size => {
                    if (this.delegate.broadcaster !== this.displayer.observerId && size) {
                        this.moveCameraToContian(size);
                        this.moveCamera(this.delegate.getMainViewCamera());
                    }
                },
                {
                    fireImmediately: true,
                }
            )
        });

        this.view.callbacks.on("onSizeUpdated", (size: Size) => {
            if (this.delegate.broadcaster && this.delegate.broadcaster !== this.displayer.observerId && size) {
                this.moveCameraToContian(this.delegate.getMainViewSize());
                this.moveCamera(this.delegate.getMainViewCamera());
            }
        });
    }

    public get view(): View {
        return this.manager.viewManager.mainView;   
    }

    private mainViewCameraListener = (camera: Camera) => {
        this.cameraStore.setCamera("mainView", camera);
        if (this.delegate.broadcaster === this.displayer.observerId) {
            this.delegate.setMainViewCamera({ ...camera });
        }
    };

    private addMainViewCameraListener() {
        this.view.callbacks.on("onCameraUpdated", this.mainViewCameraListener);
    }

    private removeMainViewCameraListener() {
        this.view.callbacks.off("onCameraUpdated", this.mainViewCameraListener);
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
}
