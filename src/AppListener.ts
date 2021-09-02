import { Event, ViewVisionMode } from "white-web-sdk";
import { TeleBox, TELE_BOX_STATE } from "@netless/telebox-insider";
import { Events, MagixEventName } from "./constants";
import type { ViewManager } from "./ViewManager";
import type { AppProxy } from "./AppProxy";
import type { AppManager } from "./AppManager";
import type { WindowManager } from "./index";

export class AppListeners {
    private displayer = this.manager.displayer;
    private boxManager = this.manager.boxManager;

    constructor(
        private manager: AppManager,
        private windowManager: WindowManager,
        private viewManager: ViewManager,
        private appProxies: Map<string, AppProxy>) {
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
                    this.appMoveHandler(data.payload)
                    break;
                }
                case Events.AppFocus: {
                    this.appFocusHandler(data.payload);
                    break;
                }
                case Events.AppResize: {
                    this.appResizeHandler(data.payload);
                    break;
                }
                case Events.AppBlur: {
                    this.appBlurHandler(data.payload);
                    break;
                }
                case Events.AppBoxStateChange: {
                    this.appBoxStateHandler(data.payload);
                    break;
                }
                case Events.AppSnapshot: {
                    this.appSnapshotHandler(data.payload);
                    break;
                }
                case Events.AppClose: {
                    this.appCloseHandler(data.payload);
                    break;
                }
                case Events.MainViewFocus: {
                    this.mainViewFocusHandler();
                    break;
                }
                case Events.SwitchViewsToFreedom: {
                    this.switchViewsToFreedomHandler();
                    break;
                }
                default:
                    break;
            }
        }
    }

    private appMoveHandler = (payload: any) => {
        this.boxManager.moveBox(payload);
    }

    private appFocusHandler = (payload: any) => {
        this.boxManager.focusBox(payload);
        this.manager.viewManager.refreshViews();
    }

    private appResizeHandler = (payload: any) => {
        this.boxManager.resizeBox(payload);
        this.manager.room?.refreshViewSize();
    }

    private appBlurHandler = (payload: any) => {
        const proxy = this.appProxies.get(payload.appId);
        if (proxy) {
            proxy.appEmitter.emit("writableChange", false);
            if (proxy.view?.mode === ViewVisionMode.Writable) {
                this.manager.viewManager.refreshViews();
            }
        }
    }

    private appBoxStateHandler = (payload: any) => {
        this.boxManager.setBoxState(payload.state);
        if (payload.state === TELE_BOX_STATE.Minimized) {
            this.manager.viewManager.refreshViews();
            this.viewManager.switchMainViewToWriter();
        }
    }

    private appSnapshotHandler = (payload: any) => {
        const box = this.boxManager.getBox(payload.appId) as TeleBox;
        if (box) {
            box.setSnapshot(payload.rect);
        }
    }

    private appCloseHandler = (payload: any) => {
        this.boxManager.closeBox(payload.appId);
        const appProxy = this.manager.appProxies.get(payload.appId);
        if (appProxy) {
            appProxy.destroy(true, true);
        }
    }

    private mainViewFocusHandler = () => {
        this.manager.boxManager.blurFocusBox();
        this.manager.viewManager.freedomAllViews();
    }

    private switchViewsToFreedomHandler = () => {
        this.manager.viewManager.freedomAllViews();
    }
}
