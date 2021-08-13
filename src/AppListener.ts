import { Displayer, Event } from "white-web-sdk";
import { TeleBox, TeleBoxState } from "telebox-insider";
import { BoxManager } from "./BoxManager";
import { Events } from "./constants";
import { WindowManager } from "./index";

export class AppListeners {

    constructor(
        private displayer: Displayer,
        private boxManager: BoxManager,
        private manager: WindowManager) {
    }

    public addListeners() {
        this.displayer.addMagixEventListener(Events.AppMove, this.appMoveListener);
        this.displayer.addMagixEventListener(Events.AppResize, this.appResizeListener);
        this.displayer.addMagixEventListener(Events.AppFocus, this.appFocusListener);
        this.displayer.addMagixEventListener(Events.AppBlur, this.appBlurListener);
        this.displayer.addMagixEventListener(Events.AppBoxStateChange, this.appBoxStateListener);
        this.displayer.addMagixEventListener(Events.AppSnapshot, this.appSnapShotListener);
    }

    public removeListeners() {
        this.displayer.removeMagixEventListener(Events.AppMove, this.appMoveListener);
        this.displayer.removeMagixEventListener(Events.AppResize, this.appResizeListener);
        this.displayer.removeMagixEventListener(Events.AppFocus, this.appFocusListener);
        this.displayer.removeMagixEventListener(Events.AppBlur, this.appBlurListener);
        this.displayer.removeMagixEventListener(Events.AppBoxStateChange, this.appBoxStateListener);
        this.displayer.removeMagixEventListener(Events.AppSnapshot, this.appSnapShotListener)
    }

    private appMoveListener = (event: Event) => {
        if (event.authorId !== this.displayer.observerId) {
            this.boxManager.moveBox(event.payload);
        }
    }

    private appFocusListener = (event: Event) => {
        if (event.authorId !== this.displayer.observerId) {
            this.boxManager.focusBox(event.payload);
        }
    }
    
    private appResizeListener = (event: Event) => {
        if (event.authorId !== this.displayer.observerId) {
            this.boxManager.resizeBox(event.payload);
        }
    }

    private appBlurListener =  (event: Event) => {
        if (event.authorId !== this.displayer.observerId) {
            const proxy = this.manager.appProxies.get(event.payload.appId);
            if (proxy) {
                proxy.appEmitter.emit("writableChange", false);
            }
            WindowManager.viewManager.switchViewToFreedom(event.payload.appId);
        }
    }

    private appBoxStateListener = (event: Event) => {
        if (event.authorId !== this.displayer.observerId) {
            this.boxManager.setBoxState(event.payload.state);
            if (event.payload === TeleBoxState.Minimized) {
                WindowManager.viewManager.switchMainViewToWriter();
            }
        }
    }

    private appSnapShotListener = (event: Event) => {
        if (event.authorId !== this.displayer.observerId) {
            const box = this.boxManager.getBox(event.payload.appId) as TeleBox;
            if (box) {
                box.setSnapshot(event.payload.rect);
            }
        }
    }
}
