import { CameraSynchronizer } from "../View/CameraSynchronizer";
import { SideEffectManager } from "side-effect-manager";
import type { Camera, View } from "white-web-sdk";
import type { AppProxy } from "./AppProxy";
import { isEqual } from "lodash";
import { combine } from "value-enhancer";

export class AppViewSync {
    private sem = new SideEffectManager();
    private synchronizer: CameraSynchronizer;

    constructor(private appProxy: AppProxy) {
        this.synchronizer = new CameraSynchronizer((camera: Camera) => {
            this.appProxy.storeCamera({
                id: this.appProxy.uid,
                ...camera,
            });
        });
        this.bindView(appProxy.view);
        this.sem.add(() => this.appProxy.camera$.subscribe(camera => {
            const size = this.appProxy.size$.value;
            if (camera && size) {
                this.synchronizer.onRemoteUpdate(camera, size);
            }
        }));
        const box = this.appProxy.box;
        if (box && box.contentStageRect) {
            this.synchronizer.setRect(box.contentStageRect);
            this.sem.add(() =>
                box._contentStageRect$.subscribe(rect => {
                    if (rect) {
                        this.synchronizer.setRect(rect);
                    }
                }),
            );
        }
        combine([this.appProxy.camera$, this.appProxy.size$]).subscribe(([camera, size]) => {
            if (camera && size) {
                this.synchronizer.onRemoteUpdate(camera, size);
            }
        });
    }

    public bindView = (view?: View) => {
        if (!view) return;
        this.synchronizer.setView(view);
        this.sem.add(() => {
            view.callbacks.on("onCameraUpdatedByDevice", this.onCameraUpdatedByDevice);
            return () =>
                view.callbacks.off("onCameraUpdatedByDevice", this.onCameraUpdatedByDevice);
        });
    };

    private onCameraUpdatedByDevice = (camera: Camera) => {
        this.synchronizer.onLocalCameraUpdate(camera);
        const stage = this.appProxy.box?.contentStageRect;
        if (stage) {
            const size = { width: stage.width, height: stage.height, id: this.appProxy.uid };
            if (!isEqual(size, this.appProxy.size$.value)) {
                this.appProxy.storeSize(size);
            }
        }
    };

    public destroy() {
        this.sem.flushAll();
    }
}
