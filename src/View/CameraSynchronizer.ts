import { AnimationMode } from "white-web-sdk";
import { debounce, delay, isEqual, pick, throttle } from "lodash";
import type { TeleBoxRect } from "@netless/telebox-insider";
import type { Camera, View } from "white-web-sdk";
import type { ISize } from "../AttributesDelegate";

export type SaveCamera = (camera: Camera) => void;

export class CameraSynchronizer {
    public remoteCamera?: Camera;
    public remoteSize?: ISize;
    protected rect?: TeleBoxRect;
    protected view?: View;

    constructor(protected saveCamera: SaveCamera) {}

    public setRect = debounce((rect: TeleBoxRect) => {
        this.rect = rect;
        if (this.remoteCamera && this.remoteSize) {
            this.onRemoteUpdate(this.remoteCamera, this.remoteSize);
        }
    }, 10);

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
            const moveCamera = () => {
                this.view?.moveCamera({
                    centerX: camera.centerX,
                    centerY: camera.centerY,
                    scale: nextScale,
                    animationMode: AnimationMode.Immediately,
                });
            }
            moveCamera(); 
            // TODO 直接调用 moveCamera 依然会出现 camera 错误的情况,这里暂时加一个 delay 保证 camera 是对的, 后续需要 SDK 进行修改
            delay(moveCamera, 50);
        }
    }, 10);

    public onRemoteSizeUpdate(size: ISize) {
        this.remoteSize = size;
        const needMoveCamera = !isEqual(pick(this.rect, ["width", "height"]), pick(size, ["width", "height"]));
        if (this.rect && this.remoteCamera && needMoveCamera) {
            const scale = this.rect.width / size.width;
            const nextScale = this.remoteCamera.scale * scale;
            const moveCamera = () => {
                this.view?.moveCamera({
                    scale: nextScale,
                    animationMode: AnimationMode.Immediately,
                })
            };
            moveCamera();
            delay(moveCamera, 50);
        }
    }

    public onLocalCameraUpdate(camera: Camera) {
        this.saveCamera(camera);
        this.remoteCamera = camera;
    }
}
