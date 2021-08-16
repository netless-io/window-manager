import { Displayer, Event } from "white-web-sdk";
import { TeleBox, TELE_BOX_STATE } from "telebox-insider";
import { BoxManager } from "./BoxManager";
import { Events } from "./constants";
import { ViewManager } from "./ViewManager";
import { AppProxy } from "./AppProxy";

export class AppListeners {

    constructor(
        private displayer: Displayer,
        private boxManager: BoxManager,
        private viewManager: ViewManager,
        private appProxies: Map<string, AppProxy>) {
    }

    public addListeners() {
        this.displayer.addMagixEventListener(Events.AppMove, this.appMoveListener);
        this.displayer.addMagixEventListener(Events.AppResize, this.appResizeListener);
        this.displayer.addMagixEventListener(Events.AppFocus, this.appFocusListener);
        this.displayer.addMagixEventListener(Events.AppBlur, this.appBlurListener);
        this.displayer.addMagixEventListener(Events.AppBoxStateChange, this.appBoxStateListener);
        this.displayer.addMagixEventListener(Events.AppSnapshot, this.appSnapshotListener);
        this.displayer.addMagixEventListener(Events.AppClose, this.appCloseListener);
    }

    public removeListeners() {
        this.displayer.removeMagixEventListener(Events.AppMove, this.appMoveListener);
        this.displayer.removeMagixEventListener(Events.AppResize, this.appResizeListener);
        this.displayer.removeMagixEventListener(Events.AppFocus, this.appFocusListener);
        this.displayer.removeMagixEventListener(Events.AppBlur, this.appBlurListener);
        this.displayer.removeMagixEventListener(Events.AppBoxStateChange, this.appBoxStateListener);
        this.displayer.removeMagixEventListener(Events.AppSnapshot, this.appSnapshotListener);
        this.displayer.removeMagixEventListener(Events.AppClose, this.appCloseListener);
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
            const proxy = this.appProxies.get(event.payload.appId);
            if (proxy) {
                proxy.appEmitter.emit("writableChange", false);
            }
            this.viewManager.switchViewToFreedom(event.payload.appId);
        }
    }

    private appBoxStateListener = (event: Event) => {
        if (event.authorId !== this.displayer.observerId) {
            this.boxManager.setBoxState(event.payload.state);
            if (event.payload === TELE_BOX_STATE.Minimized) {
                this.viewManager.switchMainViewToWriter();
            }
        }
    }

    private appSnapshotListener = (event: Event) => {
        if (event.authorId !== this.displayer.observerId) {
            const box = this.boxManager.getBox(event.payload.appId) as TeleBox;
            if (box) {
                box.setSnapshot(event.payload.rect);
            }
        }
    }

    private appCloseListener = (event: Event) => {
        if (event.authorId !== this.displayer.observerId) {
            this.boxManager.closeBox(event.payload.appId);
        }
    }
}
