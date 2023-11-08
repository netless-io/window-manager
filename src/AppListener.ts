import { callbacks } from "./callback";
import { internalEmitter } from "./InternalEmitter";
import { Events, MagixEventName } from "./constants";
import { isEqual, omit } from "lodash";
import { setViewFocusScenePath } from "./Utils/Common";
import type { AnimationMode, Camera, Event } from "white-web-sdk";
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
                case Events.MoveCamera: {
                    this.moveCameraHandler(data.payload);
                    break;
                }
                case Events.MoveCameraToContain: {
                    this.moveCameraToContainHandler(data.payload);
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

    private moveCameraHandler = (
        payload: Camera & { animationMode?: AnimationMode | undefined }
    ) => {
        if (isEqual(omit(payload, ["animationMode"]), { ...this.manager.mainView.camera })) return;
        this.manager.mainView.moveCamera(payload);
    };

    private moveCameraToContainHandler = (payload: any) => {
        this.manager.mainView.moveCameraToContain(payload);
    };

    private cursorMoveHandler = (payload: any) => {
        internalEmitter.emit("cursorMove", payload);
    };

    private rootDirRemovedHandler = () => {
        this.manager.createRootDirScenesCallback();
        this.manager.mainViewProxy.rebind();
        internalEmitter.emit("rootDirRemoved");
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
}
