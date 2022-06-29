import { AnimationMode } from "white-web-sdk";
import { isEqual, pick, throttle } from "lodash";
import type { TeleBoxRect } from "@netless/telebox-insider";
import type { Camera, View } from "white-web-sdk";
import type { ICamera, ISize } from "../AttributesDelegate";

export type SaveCamera = (camera: ICamera) => void;

export class CameraSynchronizer {
    public remoteCamera?: ICamera;
    public remoteSize?: ISize;
    protected rect?: TeleBoxRect;
    protected view?: View;

    constructor(protected saveCamera: SaveCamera) {}

    public setRect = (rect: TeleBoxRect) => {
        this.rect = rect;
        if (this.remoteCamera && this.remoteSize) {
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
            let scale: number;
            if (size.width < size.height) {
                scale = this.rect.width / size.width;
            } else {
                scale = this.rect.height / size.height;
            }
            const nextScale = camera.scale * scale;
            const config: Partial<Camera> & { animationMode: AnimationMode } = {
                scale: nextScale,
                animationMode: AnimationMode.Continuous,
            }
            if (camera.centerX !== null) {
                config.centerX = camera.centerX;
            }
            if (camera.centerY !== null) {
                config.centerY = camera.centerY;
            }
            this.view?.moveCamera(config);
        }
    }, 10);

    public onRemoteSizeUpdate(size: ISize) {
        this.remoteSize = size;
        const needMoveCamera = !isEqual(pick(this.rect, ["width", "height"]), pick(size, ["width", "height"]));
        if (this.rect && this.remoteCamera && needMoveCamera) {
            const scale = this.rect.width / size.width;
            const nextScale = this.remoteCamera.scale * scale;
            this.view?.moveCamera({
                scale: nextScale,
                animationMode: AnimationMode.Continuous,
            })
        }
    }

    public onLocalCameraUpdate(camera: ICamera) {
        this.saveCamera(camera);
        this.remoteCamera = camera;
    }
}
