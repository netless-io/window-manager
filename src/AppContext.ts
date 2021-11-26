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

export class AppContext<TAttrs extends Record<string, any>, AppOptions = any> {
    public readonly emitter: Emittery<AppEmitterEvent<TAttrs>>;
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
    private boxManager: BoxManager;
    private store = this.manager.store;
    public readonly isAddApp: boolean;
    public readonly isReplay = this.manager.isReplay;

    constructor(
        private manager: AppManager,
        public appId: string,
        private appProxy: AppProxy,
        private appOptions?: AppOptions | (() => AppOptions),
    ) {
        this.emitter = appProxy.appEmitter;
        this.boxManager = this.manager.boxManager;
        this.isAddApp = appProxy.isAddApp;
    }

    public getDisplayer() {
        return this.manager.displayer;
    }

    public getAttributes(): TAttrs | undefined {
        return this.appProxy.attributes;
    }

    public getScenes(): SceneDefinition[] | undefined {
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

    public getView(): View | undefined {
        return this.appProxy.view;
    }

    public getInitScenePath() {
        return this.manager.getAppInitPath(this.appId);
    }

    public getIsWritable(): boolean {
        return this.manager.canOperate;
    }

    public getBox(): ReadonlyTeleBox {
        const box = this.boxManager.getBox(this.appId);
        if (box) {
            return box;
        } else {
            throw new BoxNotCreatedError();
        }
    }

    public getRoom(): Room | undefined {
        return this.manager.room;
    }

    public setAttributes(attributes: TAttrs) {
        this.manager.safeSetAttributes({ [this.appId]: attributes });
    }

    public updateAttributes(keys: string[], value: any) {
        if (this.manager.attributes[this.appId]) {
            this.manager.safeUpdateAttributes([this.appId, ...keys], value);
        }
    }

    public async setScenePath(scenePath: string): Promise<void> {
        if (!this.appProxy.box) return;
        this.appProxy.setFullPath(scenePath);
        this.appProxy.context.switchAppToWriter(this.appId);
    }

    public mountView(dom: HTMLDivElement): void {
        const view = this.getView();
        if (view) {
            view.divElement = dom;
            setTimeout(() => {
                // 渲染需要时间，延迟 refresh
                this.getRoom()?.refreshViewSize();
            }, 1000);
        }
    }

    public getAppOptions(): AppOptions | undefined {
        return typeof this.appOptions === 'function' ? (this.appOptions as () => AppOptions)() : this.appOptions
    }
}
