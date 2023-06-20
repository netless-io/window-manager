import { callbacks } from "./callback";
import { emitter } from "./InternalEmitter";
import { Events, MagixEventName } from "./constants";
import { setViewFocusScenePath } from "./Utils/Common";
import type { AnimationMode, Camera, Event, Rectangle } from "white-web-sdk";
import type { AppManager } from "./AppManager";
import type { TeleBoxState } from "@netless/telebox-insider";

type SetAppFocusIndex = {
    type: "main" | "app";
    appID?: string;
    index: number;
}

export class AppListeners {
    private displayer = this.manager.displayer;

    constructor(private manager: AppManager) {}

    private get boxManager() {
        return this.manager.boxManager;
    }

    public addListeners() {
        this.displayer.addMagixEventListener(MagixEventName, this.mainMagixEventListener);
    }

    public removeListeners() {
        this.displayer.removeMagixEventListener(MagixEventName, this.mainMagixEventListener);
    }

    private mainMagixEventListener = (event: Event) => {
        if (event.authorId !== this.displayer.observerId) {
            const data = event.payload;
            switch (data.eventName) {
                case Events.AppMove: {
                    this.appMoveHandler(data.payload);
                    break;
                }
                case Events.AppResize: {
                    this.appResizeHandler(data.payload);
                    break;
                }
                case Events.AppBoxStateChange: {
                    this.boxStateChangeHandler(data.payload);
                    break;
                }
                case Events.SetMainViewScenePath: {
                    this.setMainViewScenePathHandler(data.payload);
                    break;
                }
                case Events.CursorMove: {
                    this.cursorMoveHandler(data.payload);
                    break;
                }
                case Events.RootDirRemoved: {
                    this.rootDirRemovedHandler();
                    break;
                }
                case Events.Refresh: {
                    this.refreshHandler();
                    break;
                }
                case Events.InitMainViewCamera: {
                    this.initMainViewCameraHandler();
                    break;
                }
                case Events.SetAppFocusIndex: {
                    this.setAppFocusViewIndexHandler(data.payload);
                    break;
                }
                case Events.InvokeAttributesUpdateCallback: {
                    this.manager.attributesUpdateCallback(this.manager.attributes.apps);
                    break;
                }
                case Events.MoveCamera: {
                    this.moveCameraHandler(data.payload);
                    break;
                }
                case Events.MoveCameraToContain: {
                    this.moveCameraToContainHandler(data.payload);
                    break;
                }
                default:
                    break;
            }
        }
    };

    private appMoveHandler = (payload: any) => {
        this.boxManager?.moveBox(payload);
    };

    private appResizeHandler = (payload: any) => {
        this.boxManager?.resizeBox(Object.assign(payload, { skipUpdate: true }));
        this.manager.room?.refreshViewSize();
    };

    private boxStateChangeHandler = (state: TeleBoxState) => {
        callbacks.emit("boxStateChange", state);
    };

    private setMainViewScenePathHandler = ({ nextScenePath }: { nextScenePath: string }) => {
        setViewFocusScenePath(this.manager.mainView, nextScenePath);
        callbacks.emit("mainViewScenePathChange", nextScenePath);
    };

    private cursorMoveHandler = (payload: any) => {
        emitter.emit("cursorMove", payload);
    };

    private rootDirRemovedHandler = () => {
        this.manager.createRootDirScenesCallback();
        this.manager.mainViewProxy.rebind();
        emitter.emit("rootDirRemoved");
    }

    private refreshHandler = () => {
        this.manager.windowManger._refresh();
    }

    private initMainViewCameraHandler = () => {
        this.manager.mainViewProxy.addCameraReaction();
    }

    private setAppFocusViewIndexHandler = (payload: SetAppFocusIndex) => {
        if (payload.type === "main") {
            this.manager.setSceneIndexWithoutSync(payload.index);
        } else if (payload.type === "app" && payload.appID) {
            const app = this.manager.appProxies.get(payload.appID);
            if (app) {
                app.setSceneIndexWithoutSync(payload.index);
            }
        }
    }

    private moveCameraHandler = (payload: Partial<Camera>) => {
        const size$ = this.manager.mainViewProxy.size$;
        // 'size' 存在表示白板已经可见，此时 moveCamera 才有意义
        if (size$.value) {
            const nextCamera = { ...payload };

            // 如果远端移动视角带有缩放，调整以符合本地视角
            if (nextCamera.scale) {
                const size = this.manager.mainView.size;
                const diff = Math.max(size.height / size$.value.height, size.width / size$.value.width);
                nextCamera.scale *= diff;
            }

            // 有可能传了个 scale = 0, 规避这些无效值
            else {
                delete nextCamera.scale;
            }

            this.manager.mainView.moveCamera(nextCamera);
        }
    }

    private moveCameraToContainHandler = (payload: Rectangle & { animationMode?: AnimationMode }) => {
        this.manager.mainView.moveCameraToContain(payload);
    }
}
