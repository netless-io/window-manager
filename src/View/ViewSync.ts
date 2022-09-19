import { ViewMode, AnimationMode } from "white-web-sdk";
import { CameraSynchronizer, computedMinScale } from "./CameraSynchronizer";
import { combine } from "value-enhancer";
import { SideEffectManager } from "side-effect-manager";
import type { Camera, View } from "white-web-sdk";
import type { Val, ReadonlyVal } from "value-enhancer";
import type { ICamera, ISize } from "../AttributesDelegate";
import type { TeleBoxRect } from "@netless/telebox-insider";

export type ViewSyncContext = {
    uid: string;
    // 远端 camera
    camera$: Val<ICamera | undefined, boolean>;
    // 远端 size
    size$: Val<ISize | undefined>;

    stageRect$: ReadonlyVal<TeleBoxRect>;

    viewMode$?: Val<ViewMode>;

    storeCamera: (camera: ICamera) => void;

    storeSize: (size: ISize) => void;

    view$: Val<View | undefined>;
};

export class ViewSync {
    private sem = new SideEffectManager();
    private synchronizer: CameraSynchronizer;

    constructor(private context: ViewSyncContext) {
        this.synchronizer = this.createSynchronizer();
        this.bindView(this.context.view$.value);
        this.sem.add(() => [
            this.subscribeView(),
            this.subscribeCamera(),
            this.subscribeSize(),
            this.subscribeStageRect(),
        ]);
        const camera$size$ = combine([this.context.camera$, this.context.size$]);
        camera$size$.reaction(([camera, size]) => {
            if (camera && size) {
                this.synchronizer.onRemoteUpdate(camera, size);
                camera$size$.destroy();
            }
        });
    }

    private get isBroadcastMode() {
        return this.context.viewMode$?.value === ViewMode.Broadcaster;
    }

    private createSynchronizer = () => {
        return new CameraSynchronizer((camera: ICamera) => {
            this.context.camera$.setValue(camera, true);
            const notStoreCamera =
                this.context.viewMode$ && this.context.viewMode$.value === ViewMode.Freedom;
            if (notStoreCamera) {
                return;
            } else {
                this.context.storeCamera(camera);
            }
        });
    }

    private subscribeView = () => {
        return this.context.view$.subscribe(view => {
            const currentCamera = this.context.camera$.value;
            if (currentCamera && this.context.size$.value) {
                view?.moveCamera({
                    scale: 1,
                    animationMode: AnimationMode.Immediately,
                });
                this.synchronizer.onRemoteUpdate(currentCamera, this.context.size$.value);
            }
            this.bindView(view);
        });
    }

    private subscribeCamera = () => {
        return this.context.camera$.subscribe((camera, skipUpdate) => {
            if (skipUpdate) return;
            const size = this.context.size$.value;
            if (camera && size) {
                this.synchronizer.onRemoteUpdate(camera, size);
            }
        });
    }

    private subscribeSize = () => {
        return this.context.size$.subscribe(size => {
            if (size && this.isBroadcastMode) {
                this.synchronizer.onRemoteSizeUpdate(size);
            }
        });
    }

    private subscribeStageRect = () => {
        return this.context.stageRect$.subscribe(rect => {
            if (rect) {
                this.synchronizer.setRect(rect, this.isBroadcastMode);
            }
        });
    }

    public bindView = (view?: View) => {
        if (!view) return;
        this.synchronizer.setView(view);
        this.sem.flush("view");
        this.sem.add(() => {
            view.callbacks.on("onCameraUpdatedByDevice", this.onCameraUpdatedByDevice);
            return () =>
                view.callbacks.off("onCameraUpdatedByDevice", this.onCameraUpdatedByDevice);
        }, "view");
    };

    private onCameraUpdatedByDevice = (camera: Camera) => {
        if (!camera) return;
        if (!this.isBroadcastMode) return;
        if (this.context.size$.value && this.context.stageRect$.value) {
            // 始终以远端的 size 为标准, 设置到 attributes 时根据尺寸的大小还原回去
            const diffScale = computedMinScale(this.context.size$.value, this.context.stageRect$.value);
            const remoteScale = camera.scale / diffScale;
            this.synchronizer.onLocalCameraUpdate({ ...camera, scale: remoteScale, id: this.context.uid });
        }
    };

    public destroy() {
        this.sem.flushAll();
    }
}
