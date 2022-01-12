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
import type { Room, SceneDefinition, View, EventListener as WhiteEventListener } from "white-web-sdk";
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

    /** @deprecated Use context.storage.state instead. */
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

    /** Get App writable status. */
    public getIsWritable = (): boolean => {
        return this.manager.canOperate;
    }

    /** Get the App Window UI box. */
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

    /** @deprecated Use context.storage.setState instead. */
    public setAttributes = (attributes: TAttributes) => {
        this.manager.safeSetAttributes({ [this.appId]: attributes });
    }

    /** @deprecated Use context.storage.setState instead. */
    public updateAttributes = (keys: string[], value: any) => {
        if (this.manager.attributes[this.appId]) {
            this.manager.safeUpdateAttributes([this.appId, ...keys], value);
        }
    }

    public setScenePath = async (scenePath: string): Promise<void> => {
        if (!this.appProxy.box) return;
        this.appProxy.setFullPath(scenePath);
        // 兼容 15 版本 SDK 的切页
        this.getRoom()?.setScenePath(scenePath);
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

    /** Get the local App options. */
    public getAppOptions = (): TAppOptions | undefined => {
        return typeof this.appOptions === 'function' ? (this.appOptions as () => TAppOptions)() : this.appOptions
    }

    private _storage?: Storage<TAttributes>

    /** Main Storage for attributes. */
    public get storage(): Storage<TAttributes> {
        if (!this._storage) {
            this._storage = new Storage(this);
        }
        return this._storage;
    }

    /**
     * Create separated storages for flexible state management.
     * @param storeId Namespace for the storage. Storages of the same namespace share the same data.
     * @param defaultState Default state for initial storage creation.
     * @returns 
     */
    public createStorage = <TState>(storeId: string, defaultState?: TState): Storage<TState> => {
        const storage = new Storage(this, storeId, defaultState);
        this.emitter.on("destroy", () => {
            storage.destroy();
        });
        return storage;
    }

    /** Dispatch events to other clients (and self). */
    public dispatchMagixEvent: MagixEventDispatcher<TMagixEventPayloads> = (this.manager.displayer as Room).dispatchMagixEvent.bind(this.manager.displayer)

    /** Listen to events from others clients (and self messages). */
    public addMagixEventListener: MagixEventAddListener<TMagixEventPayloads> = (event, handler, options) => {
        this.manager.displayer.addMagixEventListener(event, handler as WhiteEventListener, options);
        return () => this.manager.displayer.removeMagixEventListener(event, handler as WhiteEventListener);
    }

    /** Remove a Magix event listener. */
    public removeMagixEventListener = this.manager.displayer.removeMagixEventListener.bind(this.manager.displayer) as MagixEventRemoveListener<TMagixEventPayloads>
}
