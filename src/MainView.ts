import { AnimationMode, reaction } from "white-web-sdk";
import { Base } from "./Base";
import { debounce, isEmpty, isEqual } from "lodash";
import { emitter } from "./index";
import { Fields } from "./AttributesDelegate";
import type { Camera, Size, View } from "white-web-sdk";
import type { AppManager } from "./AppManager";
import { log } from "./Utils/log";

export class MainViewProxy extends Base {
    private scale?: number;
    private started = false;
    private mainView?: View;
    private viewId = "mainView";

    constructor(manager: AppManager) {
        super(manager);
        emitter.once("mainViewMounted").then(() => {
            setTimeout(() => {
                this.start();
            }, 200); // 等待 mainView 挂载完毕再进行监听，否则会触发不必要的 onSizeUpdated
        });
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
        this.store.setMainViewCamera({ ...this.mainView?.camera, id: this.context.uid });
        this.store.setMainViewSize({ ...this.mainView?.size, id: this.context.uid });
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
        );
    };

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
        );
    };

    public get view(): View {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return this.mainView!;
    }

    public createMainView(): View {
        const mainView = this.manager.viewManager.createView(this.viewId);
        this.mainView = mainView;
        this.moveCameraSizeByAttributes();
        mainView.callbacks.on("onSizeUpdated", () => {
            this.context.updateManagerRect();
        });
        this.setFocusScenePath(mainView);
        return mainView;
    }

    private setFocusScenePath(view: View) {
        const mainViewScenePath = this.store.getMainViewScenePath();
        if (view.focusScenePath !== mainViewScenePath) {
            view.focusScenePath = mainViewScenePath;
        }
    }

    public onReconnected() {
        log("MainViewProxy onReconnected");
        this.setFocusScenePath(this.view);
    }

    private cameraListener = (camera: Camera) => {
        this.store.setMainViewCamera({ ...camera, id: this.context.uid });
        if (this.store.getMainViewSize()?.id !== this.context.uid) {
            this.setMainViewSize(this.view.size);
        }
    };

    private sizeListener = (size: Size) => {
        this.setMainViewSize(size);
    };

    public setMainViewSize = debounce(size => {
        this.store.setMainViewSize({ ...size, id: this.context.uid });
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

    public stop() {
        this.removeCameraListener();
        this.manager.refresher?.remove(Fields.MainViewCamera);
        this.manager.refresher?.remove(Fields.MainViewSize);
        this.view.callbacks.off("onSizeUpdated", this.sizeListener);
        this.started = false;
    }

    public destroy() {
        this.stop();
    }
}
