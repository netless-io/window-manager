import { AnimationMode, Camera, Size } from "white-web-sdk";
import { AppManager } from "./AppManager";
import { isEqual } from "lodash-es";

export class MainViewProxy {
    private scale?: number;
    private size?: Size;

    constructor(
        private manager: AppManager
    ) {}

    public get view() {
        return this.manager.viewManager.mainView;
    }

    public moveCameraToContian(size: Size) {
        if (!isEqual(size, this.size)) {
            this.view.moveCameraToContain({
                width: size.width,
                height: size.height,
                originX: -size.width / 2,
                originY: -size.height / 2,
                animationMode: AnimationMode.Immediately
            });
            this.size = size;
            this.scale = this.view.camera.scale;
        }
    }

    public moveCamera(camera: Camera) {
        if (camera && !isEqual(camera, this.view.camera)) {
            const scale = camera.scale * (this.scale || 1);
            this.view.moveCamera({
                centerX: camera.centerX,
                centerY: camera.centerY,
                scale,
                animationMode: AnimationMode.Immediately
            });
        }
    }
}
