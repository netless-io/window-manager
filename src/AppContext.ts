import {
    autorun,
    listenDisposed,
    listenUpdated,
    reaction,
    unlistenDisposed,
    unlistenUpdated,
    toJS
} from 'white-web-sdk';
import { BoxNotCreatedError } from './Utils/error';
import type { Room, SceneDefinition, View } from "white-web-sdk";
import type { ReadonlyTeleBox } from "@netless/telebox-insider";
import type Emittery from "emittery";
import type { BoxManager } from "./BoxManager";
import type { AppEmitterEvent } from "./index";
import type { AppManager } from "./AppManager";
import type { AppProxy } from "./AppProxy";
import { Storage } from './App/Storage';
import type { MagixEventAddListener, MagixEventDispatcher, MagixEventRemoveListener } from './App/MagixEvent';

export class AppContext<TAttributes = any, TMagixEventPayloads = any, TAppOptions = any> {
    public readonly emitter: Emittery<AppEmitterEvent<TAttributes>>;
    public readonly mobxUtils = {
        autorun,
        reaction,
        toJS
    };
    public readonly objectUtils = {
        listenUpdated,
        unlistenUpdated,
        listenDisposed,
        unlistenDisposed
    };

    private store = this.manager.store;
    public readonly isAddApp: boolean;
    public readonly isReplay = this.manager.isReplay;

    constructor(
        private manager: AppManager,
        private boxManager: BoxManager,
        public appId: string,
        private appProxy: AppProxy,
        private appOptions?: TAppOptions | (() => TAppOptions),
    ) {
        this.emitter = appProxy.appEmitter;
        this.isAddApp = appProxy.isAddApp;
    }

    public getDisplayer = () => {
        return this.manager.displayer;
    }

    public getAttributes = (): TAttributes | undefined => {
        return this.appProxy.attributes;
    }

    public getScenes = (): SceneDefinition[] | undefined => {
        const appAttr = this.store.getAppAttributes(this.appId);
        if (appAttr?.isDynamicPPT) {
            const appProxy = this.manager.appProxies.get(this.appId);
            if (appProxy) {
                return appProxy.scenes;
            }
        } else {
            return appAttr?.options["scenes"];
        }
    }

    public getView = (): View | undefined => {
        return this.appProxy.view;
    }

    public getInitScenePath = () => {
        return this.manager.getAppInitPath(this.appId);
    }

    public getIsWritable = (): boolean => {
        return this.manager.canOperate;
    }

    public getBox = (): ReadonlyTeleBox => {
        const box = this.boxManager.getBox(this.appId);
        if (box) {
            return box;
        } else {
            throw new BoxNotCreatedError();
        }
    }

    public getRoom = (): Room | undefined => {
        return this.manager.room;
    }

    public setAttributes = (attributes: TAttributes) => {
        this.manager.safeSetAttributes({ [this.appId]: attributes });
    }

    public updateAttributes = (keys: string[], value: any) => {
        if (this.manager.attributes[this.appId]) {
            this.manager.safeUpdateAttributes([this.appId, ...keys], value);
        }
    }

    public setScenePath = async (scenePath: string): Promise<void> => {
        if (!this.appProxy.box) return;
        this.appProxy.setFullPath(scenePath);
    }

    public mountView = (dom: HTMLDivElement): void => {
        const view = this.getView();
        if (view) {
            view.divElement = dom;
            setTimeout(() => {
                // 渲染需要时间，延迟 refresh
                this.getRoom()?.refreshViewSize();
            }, 1000);
        }
    }

    public getAppOptions = (): TAppOptions | undefined => {
        return typeof this.appOptions === 'function' ? (this.appOptions as () => TAppOptions)() : this.appOptions
    }

    public createStorage = <TState>(storeId: string, defaultState?: TState): Storage<TState> => {
        const storage = new Storage(this, storeId, defaultState);
        this.emitter.on("destroy", () => {
            storage.destroy();
        });
        return storage;
    }
    
    public dispatchMagixEvent: MagixEventDispatcher<TMagixEventPayloads> = (this.manager.displayer as Room).dispatchMagixEvent.bind(this.manager.displayer)
    
    public addMagixEventListener: MagixEventAddListener<TMagixEventPayloads> = this.manager.displayer.addMagixEventListener.bind(this.manager.displayer)
    
    public removeMagixEventListener = this.manager.displayer.removeMagixEventListener.bind(this.manager.displayer) as MagixEventRemoveListener<TMagixEventPayloads>
}
