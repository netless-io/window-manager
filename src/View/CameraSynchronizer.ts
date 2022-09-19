import { AnimationMode } from "white-web-sdk";
import { isEqual, pick, throttle } from "lodash";
import type { TeleBoxRect } from "@netless/telebox-insider";
import type { Camera, View, Size } from "white-web-sdk";
import type { ICamera, ISize } from "../AttributesDelegate";

export type SaveCamera = (camera: ICamera) => void;

export class CameraSynchronizer {
    public remoteCamera?: ICamera;
    public remoteSize?: ISize;
    protected rect?: TeleBoxRect;
    protected view?: View;

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
            const nextScale = camera.scale * computedMinScale(size, this.rect);
            const config: Partial<Camera> = {
                scale: nextScale,
            }
            if (camera.centerX !== null) {
                config.centerX = camera.centerX;
            }
            if (camera.centerY !== null) {
                config.centerY = camera.centerY;
            }
            console.trace("moveCamera");
            this.moveCamera(config);
        }
    }, 10);

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

    private moveCamera(camera: Partial<Camera>) {
        this.view?.moveCamera({ ...camera, animationMode: AnimationMode.Immediately });
    }
}

export const computedMinScale = (remoteSize: Size, currentSize: Size) => {
    const wScale = currentSize.width / remoteSize.width;
    const hScale = currentSize.height / remoteSize.height;
    return Math.min(wScale, hScale);
}
