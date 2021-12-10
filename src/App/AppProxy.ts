import Emittery from "emittery";
import { AppAttributes, AppEvents, Events } from "../constants";
import { AppContext } from "./AppContext";
import { appRegister } from "../Register";
import { autorun } from "white-web-sdk";
import { emitter } from "../index";
import { entireScenes, getScenePath, setViewFocusScenePath } from "../Utils/Common";
import { Fields } from "../AttributesDelegate";
import { get } from "lodash";
import { log } from "../Utils/log";
import type {
    AppEmitterEvent,
    AppInitState,
    BaseInsertParams,
    setAppOptions,
    AppListenerKeys,
} from "../index";
import type { SceneState, View, SceneDefinition, Displayer, Room } from "white-web-sdk";
import type { NetlessApp } from "../typings";
import type { ReadonlyTeleBox } from "@netless/telebox-insider";
import type { BoxManager } from "../BoxManager";
import type { ReconnectRefresher } from "../ReconnectRefresher";

export type AppProxyContext = {
    displayer: Displayer;
    room: Room | undefined;
    refresher?: ReconnectRefresher;
    isReplay: () => boolean;
    attributes: () => any;
    focus: () => string | undefined;
    getAppAttributes: (id: string) => any;
    setProxy: (id: string, proxy: AppProxy) => void;
    deleteProxy: (id: string) => void;
    canOperate: () => boolean;
    safeSetAttributes: (attributes: any) => void;
    safeUpdateAttributes: (keys: string[], value: any) => void;
    getAppState: (id: string) => any;
    updateAppState: (appId: string, stateName: AppAttributes, state: any) => void;
    createView: (id: string) => View;
    getView: (id: string) => View | undefined;
    destroyView: (id: string) => void;
    getAppInitPath: (id: string) => any;
    cleanAppAttributes: (id: string) => void;
    deleteStatus: (id: string) => void;
};

export class AppProxy {
    public id: string;
    public scenePath?: string;
    public appEmitter: Emittery<AppEmitterEvent>;
    public scenes?: SceneDefinition[];

    private appListener: any;
    private kind: string;
    public isAddApp: boolean;
    private status: "normal" | "destroyed" = "normal";

    constructor(
        private params: BaseInsertParams,
        private context: AppProxyContext,
        private boxManager: BoxManager,
        appId: string,
        isAddApp: boolean
    ) {
        this.kind = params.kind;
        this.id = appId;
        this.context.setProxy(appId, this);
        this.appEmitter = new Emittery();
        this.appListener = this.makeAppEventListener(this.id);
        this.isAddApp = isAddApp;

        this.initScenes();

        if (this.params.options?.scenePath) {
            // 只有传入了 scenePath 的 App 才会创建 View
            this.createView();
        }
    }

    private initScenes() {
        const options = this.params.options;
        if (options) {
            this.scenePath = options.scenePath;
            if (this.appAttributes?.isDynamicPPT && this.scenePath) {
                this.scenes = entireScenes(this.context.displayer)[this.scenePath];
            } else {
                this.scenes = options.scenes;
            }
        }
    }

    public get view(): View | undefined {
        return this.context.getView(this.id);
    }

    public get isWritable(): boolean {
        return this.context.canOperate() && !this.box?.readonly;
    }

    public get attributes() {
        return this.context.attributes()[this.id];
    }

    public get appAttributes() {
        return this.context.getAppAttributes(this.id);
    }

    public getFullScenePath(): string | undefined {
        if (this.scenePath) {
            return get(this.appAttributes, [Fields.FullPath], this.getFullScenePathFromScenes());
        }
    }

    private getFullScenePathFromScenes() {
        const sceneIndex = get(this.appAttributes, ["state", "SceneIndex"], 0);
        const fullPath = getScenePath(this.context.room, this.scenePath, sceneIndex);
        if (fullPath) {
            this.setFullPath(fullPath);
        }
        return fullPath;
    }

    public setFullPath(path: string) {
        this.context.safeUpdateAttributes(["apps", this.id, Fields.FullPath], path);
    }

    public async baseInsertApp(): Promise<{ appId: string; app: NetlessApp }> {
        const params = this.params;
        if (!params.kind) {
            throw new Error("[WindowManager]: kind require");
        }
        const appImpl = await appRegister.appClasses.get(params.kind)?.();
        const appParams = appRegister.registered.get(params.kind);
        if (appImpl) {
            await this.setupApp(this.id, appImpl, params.options, appParams?.appOptions);
        } else {
            throw new Error(`[WindowManager]: app load failed ${params.kind} ${params.src}`);
        }
        emitter.emit("updateManagerRect", undefined);
        return {
            appId: this.id,
            app: appImpl,
        };
    }

    public get box(): ReadonlyTeleBox | undefined {
        return this.boxManager.getBox(this.id);
    }

    public focusBox() {
        this.boxManager.focusBox(this.id);
    }

    private async setupApp(
        appId: string,
        app: NetlessApp,
        options?: setAppOptions,
        appOptions?: any
    ) {
        log("setupApp", appId, app, options);
        const context = new AppContext(appId, this.context, this, appOptions);
        try {
            emitter.once(`${appId}${Events.WindowCreated}` as any).then(async () => {
                const boxInitState = this.getAppInitState(appId);
                this.boxManager.updateBoxState(boxInitState);
                this.appEmitter.onAny(this.appListener);
                this.appAttributesUpdateListener(appId);
                this.initStorePosition();
                setTimeout(async () => {
                    // 延迟执行 setup, 防止初始化的属性没有更新成功
                    const result = await app.setup(context);
                    appRegister.notifyApp(app.kind, "created", { appId, result });
                    this.afterSetupApp(boxInitState);
                    this.fixMobileSize();
                }, 50);
            });
            this.boxManager.createBox({
                appId: appId,
                app,
                options,
                canOperate: this.context.canOperate(),
            });
        } catch (error: any) {
            console.error(error);
            throw new Error(`[WindowManager]: app setup error: ${error.message}`);
        }
    }

    // 兼容移动端创建时会出现 PPT 不适配的问题
    private fixMobileSize() {
        const box = this.boxManager.getBox(this.id);
        if (box) {
            this.boxManager.resizeBox({
                appId: this.id,
                width: box.intrinsicWidth + 0.001,
                height: box.intrinsicHeight + 0.001,
                skipUpdate: true,
            });
        }
    }

    private afterSetupApp(boxInitState: AppInitState | undefined): void {
        if (boxInitState) {
            if (!boxInitState?.x || !boxInitState.y) {
                this.boxManager.setBoxInitState(this.id);
            }
        }
    }

    private initStorePosition() {
        const appState = this.context.getAppState(this.id);
        if (!appState?.position.x || !appState?.position.y) {
            this.context.updateAppState(this.id, AppAttributes.Position, {
                x: this.box?.intrinsicX,
                y: this.box?.intrinsicY,
            });
        }
    }

    public onSeek(time: number) {
        this.appEmitter.emit("seek", time);
        const boxInitState = this.getAppInitState(this.id);
        this.boxManager.updateBoxState(boxInitState);
    }

    public async onReconnected() {
        this.appEmitter.emit("reconnected", undefined);
        await this.destroy(true, false);
        const params = this.params;
        const appProxy = new AppProxy(
            params,
            this.context,
            this.boxManager,
            this.id,
            this.isAddApp
        );
        await appProxy.baseInsertApp();
    }

    public focus() {
        if (!this.box?.focus) {
            appRegister.notifyApp(this.kind, "focus", { appId: this.id });
            this.focusBox();
        }
    }

    public getAppInitState = (id: string) => {
        const attrs = this.context.getAppState(id);
        if (!attrs) return;
        const position = attrs?.[AppAttributes.Position];
        const focus = this.context.focus();
        const size = attrs?.[AppAttributes.Size];
        const sceneIndex = attrs?.[AppAttributes.SceneIndex];
        const maximized = this.context.attributes()?.["maximized"];
        const minimized = this.context.attributes()?.["minimized"];
        let payload = { maximized, minimized } as AppInitState;
        if (position) {
            payload = { ...payload, id: id, x: position.x, y: position.y };
        }
        if (focus === id) {
            payload = { ...payload, focus: true };
        }
        if (size) {
            payload = { ...payload, width: size.width, height: size.height };
        }
        if (sceneIndex) {
            payload = { ...payload, sceneIndex };
        }
        return payload;
    };

    public emitAppSceneStateChange(sceneState: SceneState) {
        this.appEmitter.emit("sceneStateChange", sceneState);
    }

    public emitAppIsWritableChange() {
        this.appEmitter.emit("writableChange", this.isWritable);
    }

    private makeAppEventListener(appId: string) {
        return (eventName: AppListenerKeys, data: any) => {
            if (!this.context.canOperate()) return;
            switch (eventName) {
                case "setBoxSize": {
                    this.boxManager.resizeBox({
                        appId,
                        width: data.width,
                        height: data.height,
                        skipUpdate: false,
                    });
                    break;
                }
                case "setBoxMinSize": {
                    this.boxManager.setBoxMinSize({
                        appId,
                        minWidth: data.minwidth,
                        minHeight: data.minheight,
                    });
                    break;
                }
                case "setBoxTitle": {
                    this.boxManager.setBoxTitle({ appId, title: data.title });
                    break;
                }
                case AppEvents.destroy: {
                    if (this.status === "destroyed") return;
                    this.destroy(true, data?.error);
                    if (data?.error) {
                        console.error(data?.error);
                    }
                    break;
                }
                case "focus": {
                    this.boxManager.focusBox(this.id);
                    emitter.emit("focus", { appId: this.id });
                    break;
                }
                default: {
                    break;
                }
            }
        };
    }

    private appAttributesUpdateListener = (appId: string) => {
        this.context.refresher?.add(appId, () => {
            return autorun(() => {
                const attrs = this.context.attributes()[appId];
                if (attrs) {
                    this.appEmitter.emit("attributesUpdate", attrs);
                }
                const fullPath = this.appAttributes?.fullPath;
                if (this.view && fullPath !== this.view.focusScenePath) {
                    this.view.focusScenePath = fullPath;
                }
            });
        });
    };

    public setViewFocusScenePath() {
        const fullPath = this.getFullScenePath();
        if (fullPath && this.view) {
            setViewFocusScenePath(this.view, fullPath);
        }
    }

    private async createView(): Promise<View> {
        const view = this.context.createView(this.id);
        this.setViewFocusScenePath();
        return view;
    }

    public cleanCurrentScene(): void {
        this.view?.cleanCurrentScene();
    }

    public async destroy(needCloseBox: boolean, cleanAttrs: boolean, error?: Error) {
        if (this.status === "destroyed") return;
        this.status = "destroyed";
        await appRegister.notifyApp(this.kind, "destroy", { appId: this.id });
        await this.appEmitter.emit("destroy", { error });
        this.appEmitter.clearListeners();
        emitter.emit(`destroy-${this.id}` as any, { error });
        if (needCloseBox) {
            this.boxManager.closeBox(this.id);
        }
        if (cleanAttrs) {
            this.context.cleanAppAttributes(this.id);
        }
        this.context.deleteProxy(this.id);
        this.context.destroyView(this.id);
        this.context.deleteStatus(this.id);
        this.context.refresher?.remove(this.id);
    }

    public close(): Promise<void> {
        return this.destroy(true, true);
    }
}
