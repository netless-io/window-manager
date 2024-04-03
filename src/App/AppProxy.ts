import Emittery from "emittery";
import { AppAttributes, AppEvents, Events, SETUP_APP_DELAY } from "../constants";
import { AppContext } from "./AppContext";
import { AppPageStateImpl } from "./AppPageStateImpl";
import { appRegister } from "../Register";
import { autorun } from "white-web-sdk";
import { BoxManagerNotFoundError } from "../Utils/error";
import { debounce, get } from "lodash";
import { internalEmitter } from "../InternalEmitter";
import { Fields } from "../AttributesDelegate";
import { log } from "../Utils/log";
import {
    entireScenes,
    getScenePath,
    removeScenes,
    setScenePath,
    setViewFocusScenePath,
} from "../Utils/Common";
import type {
    AppEmitterEvent,
    AppInitState,
    BaseInsertParams,
    setAppOptions,
    AppListenerKeys,
} from "../index";
import type { SceneState, View, SceneDefinition } from "white-web-sdk";
import type { AppManager } from "../AppManager";
import type { NetlessApp } from "../typings";
import type { ReadonlyTeleBox } from "@netless/telebox-insider";
import type { PageRemoveService, PageState } from "../Page";
import { calculateNextIndex } from "../Page";
import { boxEmitter } from "../BoxEmitter";
import { WindowManager } from "../index";
import { callbacks } from "../callback";

export type AppEmitter = Emittery<AppEmitterEvent>;

export class AppProxy implements PageRemoveService {
    public kind: string;
    public id: string;
    public scenePath?: string;
    public appEmitter: AppEmitter;
    public scenes?: SceneDefinition[];

    private appListener: any;
    private boxManager = this.manager.boxManager;
    private appProxies = this.manager.appProxies;
    private viewManager = this.manager.viewManager;
    private store = this.manager.store;

    public isAddApp: boolean;
    private status: "normal" | "destroyed" = "normal";
    private stateKey: string;
    private _pageState: AppPageStateImpl;
    private _prevFullPath: string | undefined;

    public appResult?: NetlessApp<any>;
    public appContext?: AppContext<any, any>;

    constructor(
        private params: BaseInsertParams,
        private manager: AppManager,
        appId: string,
        isAddApp: boolean
    ) {
        this.kind = params.kind;
        this.id = appId;
        this.stateKey = `${this.id}_state`;
        this.appProxies.set(this.id, this);
        this.appEmitter = new Emittery();
        this.appListener = this.makeAppEventListener(this.id);
        this.isAddApp = isAddApp;

        this.initScenes();

        if (this.params.options?.scenePath) {
            // 只有传入了 scenePath 的 App 才会创建 View
            this.createView();
        }
        this._pageState = new AppPageStateImpl({
            displayer: this.manager.displayer,
            scenePath: this.scenePath,
            view: this.view,
            notifyPageStateChange: this.notifyPageStateChange,
        });
    }

    private initScenes() {
        const options = this.params.options;
        if (options) {
            this.scenePath = options.scenePath;
            if (this.appAttributes?.isDynamicPPT && this.scenePath) {
                this.scenes = entireScenes(this.manager.displayer)[this.scenePath];
            } else {
                this.scenes = options.scenes;
            }
        }
    }

    public get view(): View | undefined {
        return this.manager.viewManager.getView(this.id);
    }

    public get viewIndex(): number | undefined {
        return this.view?.focusSceneIndex;
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
            return get(this.appAttributes, [Fields.FullPath]) || this.getFullScenePathFromScenes();
        }
    }

    private getFullScenePathFromScenes() {
        const sceneIndex = get(this.appAttributes, ["state", "SceneIndex"], 0);
        const fullPath = getScenePath(this.manager.room, this.scenePath, sceneIndex);
        if (fullPath) {
            this.setFullPath(fullPath);
        }
        return fullPath;
    }

    public setFullPath(path: string) {
        this.manager.safeUpdateAttributes(["apps", this.id, Fields.FullPath], path);
    }

    public async baseInsertApp(skipUpdate = false): Promise<{ appId: string; app: NetlessApp }> {
        const params = this.params;
        if (!params.kind) {
            throw new Error("[WindowManager]: kind require");
        }
        const appImpl = await appRegister.appClasses.get(params.kind)?.();
        const appParams = appRegister.registered.get(params.kind);
        if (appImpl) {
            await this.setupApp(
                this.id,
                skipUpdate,
                appImpl,
                params.options,
                appParams?.appOptions
            );
        } else {
            throw new Error(`[WindowManager]: app load failed ${params.kind} ${params.src}`);
        }
        internalEmitter.emit("updateManagerRect");
        return {
            appId: this.id,
            app: appImpl,
        };
    }

    public get box(): ReadonlyTeleBox | undefined {
        return this.boxManager?.getBox(this.id);
    }

    private async setupApp(
        appId: string,
        skipUpdate: boolean,
        app: NetlessApp,
        options?: setAppOptions,
        appOptions?: any
    ) {
        log("setupApp", appId, app, options);
        if (!this.boxManager) {
            throw new BoxManagerNotFoundError();
        }
        const context = new AppContext(this.manager, this.boxManager, appId, this, appOptions);
        this.appContext = context;
        try {
            internalEmitter.once(`${appId}${Events.WindowCreated}` as any).then(async () => {
                let boxInitState: AppInitState | undefined;
                if (!skipUpdate) {
                    boxInitState = this.getAppInitState(appId);
                    this.boxManager?.updateBoxState(boxInitState);
                }
                this.appEmitter.onAny(this.appListener);
                this.appAttributesUpdateListener(appId);
                this.setViewFocusScenePath();
                setTimeout(async () => {
                    // 延迟执行 setup, 防止初始化的属性没有更新成功
                    console.log("setup app", app);
                    const result = await app.setup(context);
                    this.appResult = result;
                    appRegister.notifyApp(this.kind, "created", { appId, result });
                    this.afterSetupApp(boxInitState);
                    this.fixMobileSize();
                    if (WindowManager.supportTeachingAidsPlugin) {
                        callbacks.emit("onAppSetup", appId);
                    }
                }, SETUP_APP_DELAY);
            });
            this.boxManager?.createBox({
                appId: appId,
                app,
                options,
                canOperate: this.manager.canOperate,
                smartPosition: this.isAddApp,
            });
            if (this.isAddApp && this.box) {
                this.store.updateAppState(appId, AppAttributes.ZIndex, this.box.zIndex);
                this.store.updateAppState(appId, AppAttributes.Size, {
                    width: this.box.intrinsicWidth,
                    height: this.box.intrinsicHeight
                });
                this.boxManager.focusBox({ appId }, false);
            }
        } catch (error: any) {
            console.error(error);
            throw new Error(`[WindowManager]: app setup error: ${error.message}`);
        }
    }

    // 兼容移动端创建时会出现 PPT 不适配的问题
    private fixMobileSize() {
        const box = this.boxManager?.getBox(this.id);
        if (box) {
            this.boxManager?.resizeBox({
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
                this.boxManager?.setBoxInitState(this.id);
            }
        }
    }

    public async onSeek(time: number) {
        this.appEmitter.emit("seek", time).catch(err => {
            console.log(`[WindowManager]: emit seek error: ${err.message}`);
        });
        const boxInitState = this.getAppInitState(this.id);
        this.boxManager?.updateBoxState(boxInitState);
    }

    public async onReconnected() {
        const isExist = Boolean(this.manager.attributes.apps[this.id]);
        if (!isExist) {
            await this.destroy(true, false, true);
            return;
        }
        this.appEmitter.emit("reconnected", undefined);
        const currentAppState = this.getAppInitState(this.id);
        await this.destroy(true, false, true);
        const params = this.params;
        const appProxy = new AppProxy(params, this.manager, this.id, this.isAddApp);
        await appProxy.baseInsertApp(true);
        this.boxManager?.updateBoxState(currentAppState);
    }

    public async onRemoveScene(scenePath: string) {
        if (this.scenePath && scenePath.startsWith(this.scenePath + "/")) {
            let nextIndex = this.pageState.index;
            let fullPath = this._pageState.getFullPath(nextIndex);
            if (!fullPath) {
                nextIndex = 0;
                fullPath = this._pageState.getFullPath(nextIndex);
            }
            if (fullPath) {
                this.setFullPath(fullPath);
            }
            this.setViewFocusScenePath();
            if (this.view) {
                this.view.focusSceneIndex = nextIndex;
            }
        }
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
        const zIndex = attrs?.zIndex;
        let payload = { maximized, minimized, zIndex } as AppInitState;
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
                    this.boxManager?.resizeBox({
                        appId,
                        width: data.width,
                        height: data.height,
                        skipUpdate: false,
                    });
                    break;
                }
                case "setBoxMinSize": {
                    this.boxManager?.setBoxMinSize({
                        appId,
                        minWidth: data.minwidth,
                        minHeight: data.minheight,
                    });
                    break;
                }
                case "setBoxTitle": {
                    this.boxManager?.setBoxTitle({ appId, title: data.title });
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
                    this.boxManager?.focusBox({ appId: this.id });
                    boxEmitter.emit("focus", { appId: this.id });
                    break;
                }
                default: {
                    break;
                }
            }
        };
    }

    private appAttributesUpdateListener = (appId: string) => {
        this.manager.refresher.add(appId, () => {
            return autorun(() => {
                const attrs = this.manager.attributes[appId];
                if (attrs) {
                    this.appEmitter.emit("attributesUpdate", attrs);
                }
            });
        });
        this.manager.refresher.add(this.stateKey, () => {
            return autorun(() => {
                const appState = this.appAttributes?.state;
                if (appState?.zIndex > 0 && appState.zIndex !== this.box?.zIndex) {
                    this.boxManager?.setZIndex(appId, appState.zIndex);
                    this.boxManager?.focusBox({ appId });
                }
            });
        });
        this.manager.refresher.add(`${appId}-fullPath`, () => {
            return autorun(() => {
                const fullPath = this.appAttributes?.fullPath;
                this.setFocusScenePathHandler(fullPath);
                if (this._prevFullPath !== fullPath) {
                    this.notifyPageStateChange();
                    this._prevFullPath = fullPath;
                }
            });
        });
    };

    private setFocusScenePathHandler = debounce((fullPath: string | undefined) => {
        if (this.view && fullPath && fullPath !== this.view?.focusScenePath) {
            setViewFocusScenePath(this.view, fullPath);
            if (WindowManager.supportTeachingAidsPlugin) {
                callbacks.emit("onAppScenePathChange", {appId: this.id, view:this.view});
            }
        }
    }, 50);

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
        return fullPath;
    }

    private async createView(): Promise<View> {
        const view = await this.viewManager.createView(this.id);
        this.setViewFocusScenePath();
        return view;
    }

    public notifyPageStateChange = debounce(() => {
        this.appEmitter.emit("pageStateChange", this.pageState);
    }, 50);

    public get pageState(): PageState {
        return this._pageState.toObject();
    }

    // PageRemoveService
    public async removeSceneByIndex(index: number) {
        const scenePath = this._pageState.getFullPath(index);
        if (scenePath) {
            const nextIndex = calculateNextIndex(index, this.pageState);
            // 只修改 focus path 不修改 FullPath
            this.setSceneIndexWithoutSync(nextIndex);
            this.manager.dispatchInternalEvent(Events.SetAppFocusIndex, {
                type: "app",
                appID: this.id,
                index: nextIndex,
            });
            // 手动添加一个延迟, 让 app 切换场景后再删除以避免闪烁
            setTimeout(() => {
                removeScenes(this.manager.room, scenePath, index);
            }, 100);
            return true;
        } else {
            return false;
        }
    }

    public setSceneIndexWithoutSync(index: number) {
        if (this.view) {
            this.view.focusSceneIndex = index;
        }
    }
    // PageRemoveService end

    public setSceneIndex(index: number) {
        if (this.view) {
            this.view.focusSceneIndex = index;
            const fullPath = this._pageState.getFullPath(index);
            if (fullPath) {
                this.setFullPath(fullPath);
            }
        }
    }

    public async destroy(
        needCloseBox: boolean,
        cleanAttrs: boolean,
        skipUpdate: boolean,
        error?: Error
    ) {
        if (this.status === "destroyed") return;
        this.status = "destroyed";
        try {
            await appRegister.notifyApp(this.kind, "destroy", { appId: this.id });
            await this.appEmitter.emit("destroy", { error });
        } catch (error) {
            console.error("[WindowManager]: notifyApp error", error.message, error.stack);
        }
        this.appEmitter.clearListeners();
        internalEmitter.emit(`destroy-${this.id}` as any, { error });
        if (needCloseBox) {
            this.boxManager?.closeBox(this.id, skipUpdate);
        }
        if (cleanAttrs) {
            this.store.cleanAppAttributes(this.id);
            if (this.scenePath) {
                removeScenes(this.manager.room, this.scenePath);
            }
        }
        this.appProxies.delete(this.id);
        this._pageState.destroy();

        this.viewManager.destroyView(this.id);
        this.manager.appStatus.delete(this.id);
        this.manager.refresher.remove(this.id);
        this.manager.refresher.remove(this.stateKey);
        this.manager.refresher.remove(`${this.id}-fullPath`);
        this._prevFullPath = undefined;
    }

    public close(): Promise<void> {
        return this.destroy(true, true, false);
    }
}
