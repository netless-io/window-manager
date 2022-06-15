import { BoxNotCreatedError } from "../Utils/error";
import { Storage } from "./Storage";
import {
    autorun,
    listenDisposed,
    listenUpdated,
    reaction,
    unlistenDisposed,
    unlistenUpdated,
    toJS,
} from "white-web-sdk";
import type {
    Room,
    SceneDefinition,
    View,
    EventListener as WhiteEventListener
} from "white-web-sdk";
import type { ReadonlyTeleBox } from "@netless/telebox-insider";
import type Emittery from "emittery";
import type { BoxManager } from "../BoxManager";
import type { AppEmitterEvent, Member } from "../index";
import type { AppManager } from "../AppManager";
import type { AppProxy } from "./AppProxy";
import type {
    MagixEventAddListener,
    MagixEventDispatcher,
    MagixEventRemoveListener,
} from "./MagixEvent";
import { WhiteBoardView } from "./WhiteBoardView";
import { findMemberByUid } from "../Helper";
import { MAX_PAGE_SIZE } from "../constants";
import { putScenes } from "../Utils/Common";
import { isNumber } from "lodash";

export class AppContext<TAttributes = any, TMagixEventPayloads = any, TAppOptions = any> {
    public readonly emitter: Emittery<AppEmitterEvent<TAttributes>>;
    public readonly mobxUtils = {
        autorun,
        reaction,
        toJS,
    };
    public readonly objectUtils = {
        listenUpdated,
        unlistenUpdated,
        listenDisposed,
        unlistenDisposed,
    };

    private store = this.manager.store;
    public readonly isAddApp: boolean;
    public readonly isReplay = this.manager.isReplay;
    private whiteBoardView?: WhiteBoardView;

    constructor(
        private manager: AppManager,
        private boxManager: BoxManager,
        public appId: string,
        private appProxy: AppProxy,
        private appOptions?: TAppOptions | (() => TAppOptions)
    ) {
        this.emitter = appProxy.appEmitter;
        this.isAddApp = appProxy.isAddApp;
    }

    public get displayer(){
        return this.manager.displayer;
    };

    /** @deprecated Use context.storage.state instead. */
    public getAttributes = (): TAttributes | undefined => {
        return this.appProxy.attributes;
    };

    public getScenes = (): SceneDefinition[] | undefined => {
        const appAttr = this.store.getAppAttributes(this.appId);
        if (appAttr?.isDynamicPPT) {
            return this.appProxy.scenes;
        } else {
            return appAttr?.options["scenes"];
        }
    };

    public get view(): View | undefined {
        return this.appProxy.view;
    };

    public createWhiteBoardView = (size?: number): WhiteBoardView => {
        if (this.whiteBoardView) {
            return this.whiteBoardView;
        }
        let view = this.view;
        if (!view) {
            view = this.appProxy.createAppDir();
        }
        view.divElement = this.box.$content as HTMLDivElement;
        this.initPageSize(size);
        this.whiteBoardView = new WhiteBoardView(this, this.appProxy);
        return this.whiteBoardView;
    }

    private initPageSize = (size?: number) => {
        if (!isNumber(size)) return;
        if (!this.appProxy.scenePath) return;
        if (this.appProxy.pageState.length >= size) return;
        if (size <= 0 || size >= MAX_PAGE_SIZE) {
            throw Error(`[WindowManager]: size ${size} muse be in range [1, ${MAX_PAGE_SIZE}]`);
        }
        const needInsert = size - this.appProxy.pageState.length;
        const startPageNumber = this.appProxy.pageState.length;
        const scenes = new Array(needInsert).fill({}).map((_, index) => {
            return { name: `${startPageNumber + index + 1}` };
        });
        putScenes(this.room, this.appProxy.scenePath, scenes);
    }

    public getInitScenePath = () => {
        return this.manager.getAppInitPath(this.appId);
    };

    /** Get App writable status. */
    public get isWritable(): boolean {
        return this.manager.canOperate;
    };

    /** Get the App Window UI box. */
    public get box(): ReadonlyTeleBox {
        const box = this.boxManager.getBox(this.appId);
        if (box) {
            return box;
        } else {
            throw new BoxNotCreatedError();
        }
    };

    public get room(): Room | undefined {
        return this.manager.room;
    };

    public get members() {
        return this.manager.members;
    }

    public get memberState(): Member {
        const self = findMemberByUid(this.room, this.manager.uid);
        if (!self) {
            throw new Error(`Member ${this.manager.uid} not found.`);
        }
        return {
            uid: this.manager.uid,
            ...self,
        }
    }

    /** @deprecated Use context.storage.setState instead. */
    public setAttributes = (attributes: TAttributes) => {
        this.manager.safeSetAttributes({ [this.appId]: attributes });
    };

    /** @deprecated Use context.storage.setState instead. */
    public updateAttributes = (keys: string[], value: any) => {
        if (this.manager.attributes[this.appId]) {
            this.manager.safeUpdateAttributes([this.appId, ...keys], value);
        }
    };

    /** @deprecated Use Pages api instead. */
    public setScenePath = async (scenePath: string): Promise<void> => {
        if (!this.appProxy.box) return;
        this.appProxy.setFullPath(scenePath);
        // 兼容 15 版本 SDK 的切页
        this.room?.setScenePath(scenePath);
    };

    /** Get the local App options. */
    public getAppOptions = (): TAppOptions | undefined => {
        return typeof this.appOptions === "function"
            ? (this.appOptions as () => TAppOptions)()
            : this.appOptions;
    };

    private _storage?: Storage<TAttributes>;

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
    };

    /** Dispatch events to other clients (and self). */
    public dispatchMagixEvent: MagixEventDispatcher<TMagixEventPayloads> = (...args) => {
        // can't dispatch events on replay mode
        const appScopeEvent = `${this.appId}:${args[0]}`;
        return this.manager.room?.dispatchMagixEvent(appScopeEvent, args[1]);
    };

    /** Listen to events from others clients (and self messages). */
    public addMagixEventListener: MagixEventAddListener<TMagixEventPayloads> = (
        event,
        handler,
        options
    ) => {
        const appScopeEvent = `${this.appId}:${event}`;
        this.manager.displayer.addMagixEventListener(
            appScopeEvent,
            handler as WhiteEventListener,
            options
        );
        return () =>
            this.manager.displayer.removeMagixEventListener(
                appScopeEvent,
                handler as WhiteEventListener
            );
    };

    /** Remove a Magix event listener. */
    public removeMagixEventListener = this.manager.displayer.removeMagixEventListener.bind(
        this.manager.displayer
    ) as MagixEventRemoveListener<TMagixEventPayloads>;
}
