import { AnimationMode } from "white-web-sdk";
import { isEmpty, isEqual, pick, throttle } from "lodash";
import type { TeleBoxRect } from "@netless/telebox-insider";
import type { View, Size } from "white-web-sdk";
import type { ICamera, ISize } from "../AttributesDelegate";

export type SaveCamera = (camera: ICamera) => void;

export class CameraSynchronizer {
    public remoteCamera?: ICamera;
    public remoteSize?: ISize;
    protected rect?: TeleBoxRect;
    protected view?: View;
    protected scale = 1;

    constructor(protected saveCamera: SaveCamera) {}

    public setRect = (rect: TeleBoxRect, updateCamera = true) => {
        this.rect = rect;
        if (this.remoteCamera && this.remoteSize && updateCamera) {
            this.onRemoteUpdate(this.remoteCamera, this.remoteSize);
        }
    }

    public setView(view: View) {
        this.view = view;
    }

    // 远端 Camera 或者 size 更新
    public onRemoteUpdate = throttle((camera: ICamera, size: ISize) => {
        this.remoteCamera = camera;
        this.remoteSize = size;
        if (this.remoteSize && this.rect) {
            requestAnimationFrame(() => {
                this.moveCameraToContian(size);
                this.moveCamera(camera);
            });
        }
    }, 32);

    public onRemoteSizeUpdate(size: ISize) {
        this.remoteSize = size;
        const needMoveCamera = !isEqual(pick(this.rect, ["width", "height"]), pick(size, ["width", "height"]));
        if (this.rect && this.remoteCamera && needMoveCamera) {
            if (!this.view) return;
            const currentCamera = this.view.camera;
            this.view?.moveCameraToContain({
                width: size.width,
                height: size.height,
                originX: currentCamera.centerX - (size.width / 2),
                originY: currentCamera.centerY - (size.height / 2),
            });
        }
    }

    public onLocalCameraUpdate(camera: ICamera) {
        this.saveCamera(camera);
        this.remoteCamera = camera;
    }

    private moveCameraToContian(size: Size): void {
        if (!isEmpty(size) && this.view) {
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

    private moveCamera(camera: ICamera): void {
        if (!isEmpty(camera) && this.view && camera.centerX && camera.centerY) {
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

