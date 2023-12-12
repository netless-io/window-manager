import { BoxNotCreatedError } from "../Utils/error";
import { putScenes } from "../Utils/Common";
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
    EventListener as WhiteEventListener,
} from "white-web-sdk";
import type { ReadonlyTeleBox } from "@netless/telebox-insider";
import type Emittery from "emittery";
import type { BoxManager } from "../BoxManager";
import type { AppEmitterEvent } from "../index";
import type { AppManager } from "../AppManager";
import type { AppProxy } from "./AppProxy";
import type {
    MagixEventAddListener,
    MagixEventDispatcher,
    MagixEventRemoveListener,
} from "./MagixEvent";
import type { AddPageParams, PageController, PageState } from "../Page";
import { internalEmitter } from "../InternalEmitter";

export class AppContext<TAttributes extends {} = any, TMagixEventPayloads = any, TAppOptions = any>
    implements PageController
{
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

    public getDisplayer = () => {
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

    public getView = (): View | undefined => {
        return this.appProxy.view;
    };

    public mountView = (dom: HTMLElement): void => {
        const view = this.getView();
        if (view) {
            view.divElement = dom as HTMLDivElement;
            setTimeout(() => {
                // 渲染需要时间，延迟 refresh
                this.getRoom()?.refreshViewSize();
            }, 1000);
        }
    };

    public getInitScenePath = () => {
        return this.manager.getAppInitPath(this.appId);
    };

    /** Get App writable status. */
    public getIsWritable = (): boolean => {
        return this.manager.canOperate;
    };

    /** Get the App Window UI box. */
    public getBox = (): ReadonlyTeleBox => {
        const box = this.boxManager.getBox(this.appId);
        if (box) {
            return box;
        } else {
            throw new BoxNotCreatedError();
        }
    };

    public getRoom = (): Room | undefined => {
        return this.manager.room;
    };

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

    public setScenePath = async (scenePath: string): Promise<void> => {
        if (!this.appProxy.box) return;
        this.appProxy.setFullPath(scenePath);
        // 兼容 15 版本 SDK 的切页
        this.getRoom()?.setScenePath(scenePath);
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
    public createStorage = <TState extends {}>(storeId: string, defaultState?: TState): Storage<TState> => {
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

    /** PageController  */
    public nextPage = async (): Promise<boolean> => {
        const nextIndex = this.pageState.index + 1;
        if (nextIndex > this.pageState.length - 1) {
            console.warn("[WindowManager] nextPage: index out of range");
            return false;
        }
        this.appProxy.setSceneIndex(nextIndex);
        return true;
    };

    public jumpPage = async (index: number): Promise<boolean> => {
        if (!(0 <= index && index < this.pageState.length)) {
            console.warn("[WindowManager] nextPage: index out of range");
            return false;
        }
        this.appProxy.setSceneIndex(index);
        return true;
    };

    public prevPage = async (): Promise<boolean> => {
        const nextIndex = this.pageState.index - 1;
        if (nextIndex < 0) {
            console.warn("[WindowManager] prevPage: index out of range");
            return false;
        }
        this.appProxy.setSceneIndex(nextIndex);
        return true;
    };

    public addPage = async (params?: AddPageParams) => {
        const after = params?.after;
        const scene = params?.scene;
        const scenePath = this.appProxy.scenePath;
        if (!scenePath) return;
        if (after) {
            const nextIndex = this.pageState.index + 1;
            putScenes(this.manager.room, scenePath, [scene || {}], nextIndex);
        } else {
            putScenes(this.manager.room, scenePath, [scene || {}]);
        }
    };

    public removePage = async (index?: number): Promise<boolean> => {
        const needRemoveIndex = index === undefined ? this.pageState.index : index;
        if (this.pageState.length === 1) {
            console.warn(`[WindowManager]: can not remove the last page`);
            return false;
        }
        if (needRemoveIndex < 0 || needRemoveIndex >= this.pageState.length) {
            console.warn(`[WindowManager]: page index ${index} out of range`);
            return false;
        }
        return this.appProxy.removeSceneByIndex(needRemoveIndex);;
    }

    public get pageState(): PageState {
        return this.appProxy.pageState;
    }

    public get kind(): string {
        return this.appProxy.kind;
    }

    /** Dispatch a local event to `manager.onAppEvent()`. */
    public dispatchAppEvent(type: string, value?: any): void {
        internalEmitter.emit(`custom-${this.kind}` as any, { kind: this.kind, appId: this.appId, type, value });
    }
}
