import { BoxNotCreatedError } from "../Utils/error";
import {
    autorun,
    listenDisposed,
    listenUpdated,
    reaction,
    unlistenDisposed,
    unlistenUpdated,
    toJS,
} from "white-web-sdk";
import type { Room, SceneDefinition, View } from "white-web-sdk";
import type { ReadonlyTeleBox } from "@netless/telebox-insider";
import type Emittery from "emittery";
import type { AppEmitterEvent } from "../index";
import type { AppProxy, AppProxyContext } from "./AppProxy";

export class AppContext<TAttrs extends Record<string, any>, AppOptions = any> {
    public readonly emitter: Emittery<AppEmitterEvent<TAttrs>>;
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
    public readonly isAddApp: boolean;
    public readonly isReplay = this.context.isReplay();

    constructor(
        public appId: string,
        private context: AppProxyContext,
        private appProxy: AppProxy,
        private appOptions?: AppOptions | (() => AppOptions)
    ) {
        this.emitter = appProxy.appEmitter;
        this.isAddApp = appProxy.isAddApp;
    }

    public getDisplayer() {
        return this.context.displayer;
    }

    public getAttributes(): TAttrs | undefined {
        return this.appProxy.attributes;
    }

    public getScenes(): SceneDefinition[] | undefined {
        const appAttr = this.appProxy.appAttributes;
        if (appAttr?.isDynamicPPT) {
            return this.appProxy.scenes;
        } else {
            return appAttr?.options["scenes"];
        }
    }

    public getView(): View | undefined {
        return this.appProxy.view;
    }

    public getInitScenePath() {
        return this.context.getAppInitPath(this.appId);
    }

    public getIsWritable(): boolean {
        return this.context.canOperate();
    }

    public getBox(): ReadonlyTeleBox {
        const box = this.appProxy.box;
        if (box) {
            return box;
        } else {
            throw new BoxNotCreatedError();
        }
    }

    public getRoom(): Room | undefined {
        return this.context.room;
    }

    public setAttributes(attributes: TAttrs) {
        this.context.safeSetAttributes({ [this.appId]: attributes });
    }

    public updateAttributes(keys: string[], value: any) {
        if (this.context.attributes()[this.appId]) {
            this.context.safeUpdateAttributes([this.appId, ...keys], value);
        }
    }

    public async setScenePath(scenePath: string): Promise<void> {
        if (!this.appProxy.box) return;
        this.appProxy.setFullPath(scenePath);
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
        return typeof this.appOptions === "function"
            ? (this.appOptions as () => AppOptions)()
            : this.appOptions;
    }
}
