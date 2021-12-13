import Emittery from "emittery";
import { AppAttributes, AppEvents, Events } from "./constants";
import { AppContext } from "./AppContext";
import { appRegister } from "./Register";
import { autorun, ViewVisionMode } from "white-web-sdk";
import { callbacks, emitter } from "./index";
import { Fields } from "./AttributesDelegate";
import { get } from "lodash";
import { log } from "./Utils/log";
import {
    notifyMainViewModeChange,
    setScenePath,
    setViewFocusScenePath,
    setViewMode,
} from "./Utils/Common";
import type {
    AppEmitterEvent,
    AppInitState,
    BaseInsertParams,
    setAppOptions,
    AppListenerKeys,
} from "./index";
import type { SceneState, View, SceneDefinition } from "white-web-sdk";
import type { AppManager } from "./AppManager";
import type { NetlessApp } from "./typings";
import type { ReadonlyTeleBox } from "@netless/telebox-insider";
import { Base } from "./Base";

export class AppProxy extends Base {
    public id: string;
    public scenePath?: string;
    public appEmitter: Emittery<AppEmitterEvent>;
    public scenes?: SceneDefinition[];

    private appListener: any;
    private boxManager = this.manager.boxManager;
    private appProxies = this.manager.appProxies;
    private viewManager = this.manager.viewManager;
    private cameraStore = this.manager.cameraStore;
    private kind: string;
    public isAddApp: boolean;
    private status: "normal" | "destroyed" = "normal";

    constructor(
        private params: BaseInsertParams,
        manager: AppManager,
        appId: string,
        isAddApp: boolean
    ) {
        super(manager);
        this.kind = params.kind;
        this.id = appId;
        this.appProxies.set(this.id, this);
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
                this.scenes = this.manager.displayer.entireScenes()[this.scenePath];
            } else {
                this.scenes = options.scenes;
            }
        }
    }

    public get view(): View | undefined {
        return this.manager.viewManager.getView(this.id);
    }

    public get isWritable(): boolean {
        return this.manager.canOperate && !this.box?.readonly;
    }

    public get attributes() {
        return this.manager.attributes[this.id];
    }

    public get appAttributes() {
        return this.store.getAppAttributes(this.id);
    }

    public getFullScenePath(): string | undefined {
        if (this.scenePath) {
            return get(this.appAttributes, [Fields.FullPath], this.scenePath);
        }
    }

    public setFullPath(path: string) {
        this.manager.safeUpdateAttributes(["apps", this.id, Fields.FullPath], path);
    }

    public async baseInsertApp(
        skipUpdate = false,
        focus?: boolean
    ): Promise<{ appId: string; app: NetlessApp }> {
        const params = this.params;
        if (!params.kind) {
            throw new Error("[WindowManager]: kind require");
        }
        const appImpl = await appRegister.appClasses.get(params.kind)?.();
        const appParams = appRegister.registered.get(params.kind);
        if (appImpl) {
            await this.setupApp(this.id, skipUpdate, appImpl, params.options, appParams?.appOptions);
        } else {
            throw new Error(`[WindowManager]: app load failed ${params.kind} ${params.src}`);
        }
        this.context.updateManagerRect();
        if (focus) {
            this.focusApp();
        }
        return {
            appId: this.id,
            app: appImpl,
        };
    }

    private focusApp() {
        this.focusBox();
        this.context.switchAppToWriter(this.id);
        this.store.setMainViewFocusPath();
    }

    public get box(): ReadonlyTeleBox | undefined {
        return this.boxManager.getBox(this.id);
    }

    public focusBox() {
        this.boxManager.focusBox({ appId: this.id });
    }

    private async setupApp(
        appId: string,
        skipUpdate: boolean,
        app: NetlessApp,
        options?: setAppOptions,
        appOptions?: any
    ) {
        log("setupApp", appId, app, options);
        const context = new AppContext(this.manager, appId, this, appOptions);
        try {
            emitter.once(`${appId}${Events.WindowCreated}` as any).then(async () => {
                let boxInitState: AppInitState | undefined;
                if (!skipUpdate) {
                    boxInitState = this.getAppInitState(appId);
                    this.boxManager.updateBoxState(boxInitState);
                }
                this.appEmitter.onAny(this.appListener);
                this.appAttributesUpdateListener(appId);
                this.setViewFocusScenePath();
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
                canOperate: this.manager.canOperate,
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
            if (boxInitState.focus && this.scenePath) {
                this.context.switchAppToWriter(this.id);
            }
            if (!boxInitState?.x || !boxInitState.y) {
                this.boxManager.setBoxInitState(this.id);
            }
        }
    }

    public onSeek(time: number) {
        this.appEmitter.emit("seek", time);
        const boxInitState = this.getAppInitState(this.id);
        this.boxManager.updateBoxState(boxInitState);
    }

    public async onReconnected() {
        this.appEmitter.emit("reconnected", undefined);
        const currentAppState = this.getAppInitState(this.id);
        await this.destroy(true, false, true);
        const params = this.params;
        const appProxy = new AppProxy(params, this.manager, this.id, this.isAddApp);
        await appProxy.baseInsertApp(true, this.store.focus === this.id);
        this.boxManager.updateBoxState(currentAppState);
    }

    public switchToWritable() {
        appRegister.notifyApp(this.kind, "focus", { appId: this.id });
        this.cameraStore.switchView(this.id, this.view, () => {
            if (this.view) {
                if (this.view.mode === ViewVisionMode.Writable) return;
                try {
                    if (this.manager.mainView.mode === ViewVisionMode.Writable) {
                        this.store.setMainViewFocusPath();
                        notifyMainViewModeChange(callbacks, ViewVisionMode.Freedom);
                        setViewMode(this.manager.mainView, ViewVisionMode.Freedom);
                    }
                    setViewMode(this.view, ViewVisionMode.Writable);
                } catch (error) {
                    log("switch view failed", error);
                }
            }
        });
    }

    public getAppInitState = (id: string) => {
        const attrs = this.store.getAppState(id);
        if (!attrs) return;
        const position = attrs?.[AppAttributes.Position];
        const focus = this.store.focus;
        const size = attrs?.[AppAttributes.Size];
        const sceneIndex = attrs?.[AppAttributes.SceneIndex];
        const maximized = this.attributes?.["maximized"];
        const minimized = this.attributes?.["minimized"];
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
            if (!this.manager.canOperate) return;
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
                    this.destroy(true, false, true, data?.error);
                    if (data?.error) {
                        console.error(data?.error);
                    }
                    break;
                }
                case "focus": {
                    this.boxManager.focusBox({ appId: this.id });
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
        this.manager.refresher?.add(appId, () => {
            return autorun(() => {
                const attrs = this.manager.attributes[appId];
                if (attrs) {
                    this.appEmitter.emit("attributesUpdate", attrs);
                }
            });
        });
    };

    public setScenePath(): void {
        if (!this.manager.canOperate) return;
        const fullScenePath = this.getFullScenePath();
        if (this.manager.room && fullScenePath && this.view) {
            setScenePath(this.manager.room, fullScenePath);
        }
    }

    public setViewFocusScenePath() {
        const fullPath = this.getFullScenePath();
        if (fullPath && this.view) {
            setViewFocusScenePath(this.view, fullPath);
        }
    }

    private async createView(): Promise<View> {
        const view = await this.viewManager.createView(this.id);
        this.cameraStore.register(this.id, view);
        this.setViewFocusScenePath();
        return view;
    }

    public async destroy(
        needCloseBox: boolean,
        cleanAttrs: boolean,
        skipUpdate: boolean,
        error?: Error
    ) {
        if (this.status === "destroyed") return;
        this.status = "destroyed";
        await appRegister.notifyApp(this.kind, "destroy", { appId: this.id });
        await this.appEmitter.emit("destroy", { error });
        this.appEmitter.clearListeners();
        emitter.emit(`destroy-${this.id}` as any, { error });
        if (needCloseBox) {
            this.boxManager.closeBox(this.id, skipUpdate);
        }
        if (cleanAttrs) {
            this.store.cleanAppAttributes(this.id);
        }
        this.appProxies.delete(this.id);
        this.cameraStore.unregister(this.id, this.view);

        this.viewManager.destroyView(this.id);
        this.manager.appStatus.delete(this.id);
        this.manager.refresher?.remove(this.id);
    }

    public close(): Promise<void> {
        return this.destroy(true, true, false);
    }
}
