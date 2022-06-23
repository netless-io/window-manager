import { AnimationMode, ViewMode } from "white-web-sdk";
import { CameraSynchronizer } from "./CameraSynchronizer";
import { combine } from "value-enhancer";
import { isEqual } from "lodash";
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
        this.synchronizer = new CameraSynchronizer((camera: Camera) => {
            const iCamera = {
                id: this.context.uid,
                ...camera,
            }
            this.context.camera$.setValue(iCamera, true);
            const notStoreCamera = this.context.viewMode$ && this.context.viewMode$.value === ViewMode.Freedom;
            if (notStoreCamera) {
                return;
            } else {
                this.context.storeCamera(iCamera);
            }
        });
        this.bindView(this.context.view$.value);
        this.sem.add(() =>
            this.context.view$.subscribe(view => {
                const currentCamera = this.context.camera$.value;
                if (currentCamera && this.context.size$.value) {
                    view?.moveCamera({
                        scale: 1,
                        animationMode: AnimationMode.Immediately,
                    });
                    this.synchronizer.onRemoteUpdate(currentCamera, this.context.size$.value);
                }   
              
                this.bindView(view);
            })
        );
        this.sem.add(() =>
            this.context.camera$.subscribe((camera, skipUpdate) => {
                const size = this.context.size$.value;
                if (camera && size && !skipUpdate) {
                    this.synchronizer.onRemoteUpdate(camera, size);
                }
            })
        );
        this.sem.add(() =>
            this.context.size$.subscribe(size => {
                if (size) {
                    this.synchronizer.onRemoteSizeUpdate(size);
                }
            })
        );
        if (this.context.stageRect$.value) {
            this.synchronizer.setRect(this.context.stageRect$.value);
            this.sem.add(() =>
                this.context.stageRect$.subscribe(rect => {
                    if (rect) {
                        this.synchronizer.setRect(rect);
                    }
                })
            );
        }
        const camera$size$ = combine([this.context.camera$, this.context.size$]);
        camera$size$.subscribe(([camera, size]) => {
            if (camera && size) {
                this.synchronizer.onRemoteUpdate(camera, size);
                camera$size$.destroy();
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
        this.synchronizer.onLocalCameraUpdate(camera);
        const stage = this.context.stageRect$.value;
        if (stage) {
            const size = { width: stage.width, height: stage.height, id: this.context.uid };
            if (!isEqual(size, this.context.size$.value)) {
                this.context.storeSize(size);
            }
        }
    };

    public destroy() {
        this.sem.flushAll();
    }
}
