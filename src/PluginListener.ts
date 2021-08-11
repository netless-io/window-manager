import { Displayer, Event } from "white-web-sdk";
import { TeleBoxState } from "telebox-insider";
import { BoxManager } from "./BoxManager";
import { Events } from "./constants";
import { WindowManager } from "./index";

export class PluginListeners {

    constructor(
        private displayer: Displayer,
        private boxManager: BoxManager) {
    }

    public addListeners() {
        this.displayer.addMagixEventListener(Events.PluginMove, this.pluginMoveListener);
        this.displayer.addMagixEventListener(Events.PluginResize, this.pluginResizeListener);
        this.displayer.addMagixEventListener(Events.PluginFocus, this.pluginFocusListener);
        this.displayer.addMagixEventListener(Events.PluginBlur, this.pluginBlurListener);
        this.displayer.addMagixEventListener(Events.PluginBoxStateChange, this.pluginBoxStateListener);
    }

    public removeListeners() {
        this.displayer.removeMagixEventListener(Events.PluginMove, this.pluginMoveListener);
        this.displayer.removeMagixEventListener(Events.PluginResize, this.pluginResizeListener);
        this.displayer.removeMagixEventListener(Events.PluginFocus, this.pluginFocusListener);
        this.displayer.removeMagixEventListener(Events.PluginBlur, this.pluginBlurListener);
        this.displayer.removeMagixEventListener(Events.PluginBoxStateChange, this.pluginBoxStateListener);
    }

    private pluginMoveListener = (event: Event) => {
        if (event.authorId !== this.displayer.observerId) {
            this.boxManager.moveBox(event.payload);
        }
    }

    private pluginFocusListener = (event: Event) => {
        if (event.authorId !== this.displayer.observerId) {
            this.boxManager.focusBox(event.payload);
        }
    }
    
    private pluginResizeListener = (event: Event) => {
        if (event.authorId !== this.displayer.observerId) {
            this.boxManager.resizeBox(event.payload);
        }
    }

    private pluginBlurListener =  (event: Event) => {
        if (event.authorId !== this.displayer.observerId) {
            const pluginEmitter = WindowManager.emitterMap.get(event.payload.pluginId);
            if (pluginEmitter) {
                pluginEmitter.emit("writableChange", false);
            }
            WindowManager.viewManager.switchViewToFreedom(event.payload.pluginId);
        }
    }

    private pluginBoxStateListener = (event: Event) => {
        if (event.authorId === this.displayer.observerId) {
            this.boxManager.setBoxState(event.payload);
            if (event.payload === TeleBoxState.Minimized) {
                WindowManager.viewManager.switchMainViewToWriter();
            }
        }
    }
}
