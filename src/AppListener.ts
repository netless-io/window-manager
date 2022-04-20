import { callbacks } from "./callback";
import { emitter } from "./InternalEmitter";
import { Events, MagixEventName } from "./constants";
import { isEqual, omit } from "lodash";
import { setViewFocusScenePath } from "./Utils/Common";
import type { AnimationMode, Camera, Event } from "white-web-sdk";
import type { AppManager } from "./AppManager";
import type { TeleBoxState } from "@netless/telebox-insider";
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
}
