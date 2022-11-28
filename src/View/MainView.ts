import { callbacks } from "../callback";
import { createView } from "./ViewManager";
import { debounce, get, isEqual } from "lodash";
import { emitter } from "../InternalEmitter";
import { Events } from "../constants";
import { Fields } from "../AttributesDelegate";
import { AnimationMode, reaction, toJS } from "white-web-sdk";
import { releaseView, setScenePath, setViewFocusScenePath } from "../Utils/Common";
import { SideEffectManager } from "side-effect-manager";
import { Val } from "value-enhancer";
import { ViewSync } from "./ViewSync";
import type { ICamera, ISize } from "../AttributesDelegate";
import type { Size, View } from "white-web-sdk";
import type { AppManager } from "../AppManager";
import type { MoveCameraParams } from "../typings";

export class MainViewProxy {
    private started = false;
    private mainViewIsAddListener = false;
    private mainView: View;
    private store = this.manager.store;

    private sideEffectManager = new SideEffectManager();

    public camera$ = new Val<ICamera | undefined>(undefined);
    public size$ = new Val<ISize | undefined>(undefined);
    public view$ = new Val<View | undefined>(undefined);
    private cameraUpdatePromise?: Promise<boolean>;

    public viewSync?: ViewSync;

    constructor(private manager: AppManager) {
        this.mainView = this.createMainView();
        emitter.once("mainViewMounted").then(() => {
            this.addMainViewListener();
            this.start();
            this.ensureCameraAndSize();
            this.startListenWritableChange();
        });
        this.sideEffectManager.add(() => [
            emitter.on("startReconnect", () => {
                releaseView(this.mainView);
            }),
        ]);
        this.createViewSync();
        this.sideEffectManager.add(() => emitter.on("focusedChange", ({ focused }) => {
            if (focused === undefined) {
                const scenePath = this.store.getMainViewScenePath();
                if (scenePath) {
                    setScenePath(this.manager.room, scenePath);
                }
            }
        }));
        this.size$.reaction(size => {
            if (size) {
                callbacks.emit("baseSizeChange", size);
            }
        });
    }

    public createViewSync = () => {
        // 滚动模式下，不需要同步
        if (this.manager.windowManger.viewMode$.value === 'scroll') return
        if (this.manager.boxManager && !this.viewSync) {
            this.viewSync = new ViewSync({
                uid: this.manager.uid,
                view$: this.view$,
                camera$: this.camera$,
                size$: this.size$,
                stageRect$: this.manager.boxManager?.stageRect$,
                viewMode$: this.manager.windowManger.viewMode$,
                storeCamera: this.storeCamera,
                storeSize: this.storeSize,
            });
        }
    };

    private startListenWritableChange = () => {
        this.sideEffectManager.add(() =>
            emitter.on("writableChange", isWritable => {
                if (isWritable) {
                    this.ensureCameraAndSize();
                }
            })
        );
    };

    public ensureCameraAndSize() {
        if (!this.mainViewCamera || !this.mainViewSize) {
            this.manager.dispatchInternalEvent(Events.InitMainViewCamera);
            this.storeCamera({
                id: this.manager.uid,
                ...this.view.camera
            });
            // FIX 没有 mainViewSize 需要初始化一个 baseSize
            const stageRect = this.manager.boxManager?.stageRect;
            if (stageRect && !this.mainViewSize) {
                this.storeSize({
                    id: this.manager.uid,
                    width: stageRect.width,
                    height: stageRect.height
                });
            }
        }
    }

    public moveCamera = (camera: MoveCameraParams) => {
        this.debouncedStoreCamera();
        this.moveCameraToPromise(camera);
    };

    public moveCameraToPromise = (camera: MoveCameraParams) => {
        const promise = new Promise<boolean>((resolve) => {
            const cameraListener = debounce(() => {
                this.mainView.callbacks.off("onCameraUpdated", cameraListener);
                this.cameraUpdatePromise = undefined;
                resolve(true);
            }, 50);
            this.mainView.callbacks.on("onCameraUpdated", cameraListener);
            this.mainView.moveCamera(camera);
        });
        this.cameraUpdatePromise = promise;
        return promise;
    }

    private debouncedStoreCamera = () => {
        this.storeCurrentSize();
        const cameraListener = debounce(() => {
            this.saveToCamera$();
            this.storeCurrentCameraSize();
            this.mainView.callbacks.off("onCameraUpdated", cameraListener);
        }, 50);
        this.mainView.callbacks.on("onCameraUpdated", cameraListener);
    }

    private storeCurrentCameraSize = debounce(async () => {
        if (this.cameraUpdatePromise) {
            await this.cameraUpdatePromise;
        }
        this.storeCurrentCamera();
        this.storeCurrentSize();
    }, 500);

    private get mainViewCamera() {
        return this.store.getMainViewCamera();
    }

    private get mainViewSize() {
        return this.store.getMainViewSize();
    }

    private get didRelease(): boolean {
        return get(this.view, ["didRelease"]);
    }

    public start() {
        if (this.started) return;
        this.removeCameraListener();
        this.addCameraListener();
        this.addCameraReaction();
        this.started = true;
    }

    public addCameraReaction = () => {
        this.manager.refresher.add(Fields.MainViewCamera, this.cameraReaction);
        this.manager.refresher.add(Fields.MainViewSize, this.sizeReaction);
    };

    public saveToCamera$ = () => {
        const camera = { ...this.view.camera, id: this.manager.uid };
        this.camera$.setValue(camera, true);
    }

    public storeCurrentCamera = () => {
        const iCamera = this.view.camera;
        this.storeCamera({
            id: this.manager.uid,
            ...iCamera
        });
    }

    public storeCurrentSize = () => {
        const rect = this.manager.boxManager?.stageRect;
        if (rect) {
            const size = {
                id: this.manager.uid,
                width: rect.width,
                height: rect.height
            }
            if (!isEqual(size, this.mainViewSize)) {
                this.storeSize(size);
            }
        }
    }

    public storeCamera = (camera: ICamera) => {
        this.store.setMainViewCamera(camera);
    };

    public storeSize = (size: ISize) => {
        this.store.setMainViewSize(size);
    };

    private cameraReaction = () => {
        return reaction(
            () => this.mainViewCamera,
            camera => {
                if (camera) {
                    const rawCamera = toJS(camera);
                    if (!isEqual(rawCamera, this.camera$.value)) {
                        this.camera$.setValue(rawCamera);
                    }
                }
            },
            { fireImmediately: true }
        );
    };

    private sizeReaction = () => {
        return reaction(
            () => this.mainViewSize,
            size => {
                if (size) {
                    const rawSize = toJS(size);
                    if (!isEqual(rawSize, this.size$.value)) {
                        this.size$.setValue(rawSize);
                    }
                }
            },
            { fireImmediately: true }
        );
    };

    public get view(): View {
        return this.mainView;
    }

    public get cameraState() {
        return { ...this.view.camera, ...this.view.size };
    }

    public createMainView(): View {
        const mainView = createView(this.manager.displayer);
        const mainViewScenePath = this.store.getMainViewScenePath();
        if (mainViewScenePath) {
            setViewFocusScenePath(mainView, mainViewScenePath);
        }
        this.view$.setValue(mainView);
        return mainView;
    }

    public onReconnect(): void {
        if (this.didRelease) {
            this.rebind();
        } else {
            const mainViewScenePath = this.store.getMainViewScenePath();
            this.setFocusScenePath(mainViewScenePath);
        }
    }

    public setFocusScenePath(path: string | undefined) {
        if (path) {
            return setViewFocusScenePath(this.view, path);
        }
    }

    public rebind(): void {
        const divElement = this.mainView.divElement;
        const disableCameraTransform = this.mainView.disableCameraTransform;
        const camera = { ...this.mainView.camera };
        this.stop();
        releaseView(this.mainView);
        this.removeMainViewListener();
        this.mainView = this.createMainView();
        this.mainView.disableCameraTransform = disableCameraTransform;
        this.mainView.divElement = divElement;
        this.mainView.moveCamera({ ...camera, animationMode: AnimationMode.Immediately });
        this.addMainViewListener();
        this.start();
    }

    public addMainViewListener(): void {
        if (this.mainViewIsAddListener) return;
        if (this.view.divElement) {
            this.view.divElement.addEventListener("click", this.mainViewClickListener);
            this.view.divElement.addEventListener("touchend", this.mainViewClickListener);
            this.mainViewIsAddListener = true;
        }
    }

    public removeMainViewListener(): void {
        if (this.view.divElement) {
            this.view.divElement.removeEventListener("click", this.mainViewClickListener);
            this.view.divElement.removeEventListener("touchend", this.mainViewClickListener);
        }
        this.mainViewIsAddListener = false;
    }

    private mainViewClickListener = () => {
        this.mainViewClickHandler();
    };

    public async mainViewClickHandler(): Promise<void> {
        if (!this.manager.canOperate) return;
        this.store.cleanFocus();
        this.manager.boxManager?.blurAllBox();
    }

    public setMainViewSize = debounce((size: Size) => {
        this.store.setMainViewSize({ ...size, id: this.manager.uid });
    }, 50);

    private addCameraListener() {
        this.view.callbacks.on("onCameraUpdated", this.onCameraOrSizeUpdated);
        this.view.callbacks.on("onSizeUpdated", this.onCameraOrSizeUpdated);
    }

    private removeCameraListener() {
        this.view.callbacks.off("onCameraUpdated", this.onCameraOrSizeUpdated);
        this.view.callbacks.off("onSizeUpdated", this.onCameraOrSizeUpdated);
    }

    private onCameraOrSizeUpdated = () => {
        callbacks.emit("cameraStateChange", this.cameraState);
    };

    public stop() {
        this.manager.refresher.remove(Fields.MainViewCamera);
        this.manager.refresher.remove(Fields.MainViewSize);
        this.started = false;
    }

    public destroy() {
        this.camera$.destroy();
        this.size$.destroy();
        this.view$.destroy();
        this.removeMainViewListener();
        this.stop();
        this.sideEffectManager.flushAll();
    }
}
