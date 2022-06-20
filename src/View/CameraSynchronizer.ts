import { AnimationMode } from "white-web-sdk";
import { delay, throttle } from "lodash";
import type { TeleBoxRect } from "@netless/telebox-insider";
import type { Camera, View, Size } from "white-web-sdk";
import type { ISize } from "../AttributesDelegate";

export type SaveCamera = (camera: Camera) => void;

export class CameraSynchronizer {
    protected remoteCamera?: Camera;
    protected remoteSize?: ISize;
    protected rect?: TeleBoxRect;
    protected view?: View;

    constructor(protected saveCamera: SaveCamera) {}

    public setRect(rect: TeleBoxRect) {
        this.rect = rect;
        if (this.remoteCamera && this.remoteSize) {
            this.onRemoteUpdate(this.remoteCamera, this.remoteSize);
        }
    }

    public setView(view: View) {
        this.view = view;
    }

    // 远端 Camera 或者 size 更新
    public onRemoteUpdate = throttle((camera: Camera, size: ISize) => {
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
            const moveCamera = () => this.view?.moveCamera({
                centerX: camera.centerX,
                centerY: camera.centerY,
                scale: nextScale,
                animationMode: AnimationMode.Immediately,
            });
            // TODO 直接调用 moveCamera 依然会出现 camera 错误的情况,这里暂时加一个 delay 保证 camera 是对的, 后续需要 SDK 进行修改
            delay(moveCamera, 50);
        }
    }, 50);


    public onLocalCameraUpdate(camera: Camera) {
        this.saveCamera(camera);
        this.remoteCamera = camera;
    }

    // 本地 Size 更新, 先匹配 camera 到新的 size 然后再发送 camera 数据到远端
    public onLocalSizeUpdate = (size: Size) => {
        if (this.rect && this.view) {
            let scale: number;
            if (size.width < size.height) {
                scale = this.rect.width / size.width;
            } else {
                scale = this.rect.height / size.height;
            }
            const nextScale = this.view.camera.scale / scale;
            console.log("onLocalSizeUpdate", nextScale.toFixed(3), scale.toFixed(3));
            this.view.moveCamera({
                scale: nextScale,
                animationMode: AnimationMode.Immediately
            });
        }
    }
}
