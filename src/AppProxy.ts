import Emittery from 'emittery';
import {
    AddAppOptions,
    AddAppParams,
    AppEmitterEvent,
    AppInitState,
    AppListenerKeys,
    AppSyncAttributes,
    BaseInsertParams,
    callbacks,
    emitter,
    setAppOptions,
    WindowManager
    } from './index';
import { AppManager } from "./AppManager";
import {
    AnimationMode,
    autorun,
    Camera,
    SceneDefinition,
    SceneState,
    View,
    ViewVisionMode
    } from 'white-web-sdk';
import { AppAttributes, AppEvents, Events } from './constants';
import { AppContext } from './AppContext';
import { AppCreateError, AppNotRegisterError } from './error';
import {
    genAppId,
    notifyMainViewModeChange,
    setScenePath,
    setViewFocusScenePath,
    setViewMode
    } from './Common';
import { isEqual } from 'lodash-es';
import { log } from './log';
import { NetlessApp } from './typings';
// import { loadApp } from './loader'; TODO fix localforge import


export class AppProxy {
    public id: string;
    public scenePath?: string;
    public appEmitter: Emittery<AppEmitterEvent>;
    public scenes?: SceneDefinition[];

    private appListener: any;
    private disposer: any;
    private boxManager = this.manager.boxManager;
    private appProxies = this.manager.appProxies;
    private viewManager = this.manager.viewManager;
    private lastAttrs: any;
    private kind: string;

    constructor(
        private params: BaseInsertParams,
        private manager: AppManager,
        appId: string
    ) {
        this.kind = params.kind;
        this.id = appId;
        this.appProxies.set(this.id, this);
        this.appEmitter = new Emittery();
        this.appListener = this.makeAppEventListener(this.id);
        const options = this.params.options;
        if (options) {
            this.scenePath = options.scenePath;
            const attr = this.manager.delegate.getAppAttributes(this.id)
            if (attr?.isDynamicPPT && this.scenePath) {
                this.scenes = this.manager.displayer.entireScenes()[this.scenePath];
            } else {
                this.scenes = options.scenes;
            }
        }
        if (this.params.options?.scenePath) { // 只有传入了 scenePath 的 App 才会创建 View
            this.createView();
            this.addCameraListener();
        }
    }

    public get sceneIndex() {
        return this.manager.delegate.getAppSceneIndex(this.id);
    }

    public setSceneIndex(index: number) {
        return this.manager.delegate.updateAppState(this.id, AppAttributes.SceneIndex, index);
    }

    public get view() {
        return this.manager.viewManager.getView(this.id);
    }

    public get isWritable() {
        return this.manager.canOperate && !this.box?.readonly;
    }

    public getSceneName() {
        if (this.sceneIndex !== undefined) {
            return this.scenes?.[this.sceneIndex]?.name;
        }
    }

    public getFullScenePath() {
        if (this.scenePath && this.getSceneName()) {
            return `${this.scenePath}/${this.getSceneName()}`;
        }
    }

    public appImpl(kind: string) {
        return WindowManager.appClasses.get(kind);
    }

    public async baseInsertApp(focus?: boolean) {
        const params = this.params;
        if (params.kind) {
            const appImpl = await this.getAppImpl();
            if (appImpl) {
                await this.setupApp(this.id, appImpl, params.options);
            } else {
                throw new Error(`[WindowManager]: app load failed ${params.kind} ${params.src}`);
            }
            this.boxManager.updateManagerRect();
            if (focus) {
                this.focusBox();
                this.manager.viewManager.switchAppToWriter(this.id);
                this.manager.delegate.setMainViewFocusPath();
            }
            return {
                appId: this.id, app: appImpl
            }
        } else {
            throw new Error("[WindowManager]: kind require");
        }
    }

    private get box() {
        return this.boxManager.getBox(this.id);
    }

    private focusBox() {
        this.boxManager.focusBox({ appId: this.id });
    }

    private async getAppImpl() {
        const params = this.params;
        let appImpl;
        if (params.src === undefined) {
            appImpl = WindowManager.appClasses.get(params.kind);
            if (!appImpl) {
                throw new AppNotRegisterError(params.kind);
            }
        } else if (typeof params.src === "string") {
            // appImpl = await loadApp(params.kind, params.src);
            throw new Error(`[WindowManager]: load remote script Not currently supported`);
        } else if (typeof params.src === "object") {
            appImpl = params.src;
        }
        return appImpl;
    }

    private async setupApp(appId: string, app: NetlessApp, options?: setAppOptions) {
        log("setupApp", appId, app, options);
        const context = new AppContext(this.manager, appId, this.appEmitter);
        try {
            emitter.once(`${appId}${Events.WindowCreated}`).then(async () => {
                const boxInitState = this.getAppInitState(appId);
                this.boxManager.updateBoxState(boxInitState);
                this.appEmitter.onAny(this.appListener);
                this.appAttributesUpdateListener(appId);
                this.setViewFocusScenePath();
                setTimeout(async () => { // 延迟执行 setup, 防止初始化的属性没有更新成功
                    await app.setup(context);
                    if (boxInitState) {
                        if (boxInitState.focus) {
                            this.manager.viewManager.switchAppToWriter(this.id);
                        }
                        if (!boxInitState?.x || !boxInitState.y || !boxInitState.snapshotRect) {
                            this.boxManager.setBoxInitState(appId);
                        }
                    }
                    const box = this.boxManager.getBox(appId);
                    if (box) {
                        this.boxManager.resizeBox({
                            appId,
                            width: box.width + 0.001,
                            height: box.height + 0.001
                        });
                    }
                  
                }, 50);
            });
            this.boxManager.createBox({
                appId: appId, app, options, canOperate: this.manager.canOperate
            });
        } catch (error) {
            console.error(error);
            throw new Error(`[WindowManager]: app setup error: ${error.message}`);
        }
    }

    public switchToWritable() {
        if (this.view) {
            try {
                if (this.view.mode === ViewVisionMode.Writable) return;
                if (this.manager.mainView.mode === ViewVisionMode.Writable) {
                    this.manager.delegate.setMainViewFocusPath();
                    notifyMainViewModeChange(callbacks, ViewVisionMode.Freedom);
                    setViewMode(this.manager.mainView, ViewVisionMode.Freedom);
                }
                setViewMode(this.view, ViewVisionMode.Writable);
            } catch (error) {
                log("switch view faild", error);
            }
        }
    }

    public getAppInitState = (id: string) => {
        const attrs = this.manager.delegate.getAppState(id);
        if (!attrs) return;
        const position = attrs?.[AppAttributes.Position];
        const focus = this.manager.attributes.focus;
        const size = attrs?.[AppAttributes.Size];
        const snapshotRect = attrs?.[AppAttributes.SnapshotRect];
        const sceneIndex = attrs?.[AppAttributes.SceneIndex];
        const boxState = this.manager.attributes["boxState"];
        let payload = { boxState } as AppInitState;
        if (position) {
            payload = { ...payload, id: id, x: position.x, y: position.y };
        }
        if (focus === id) {
            payload = { ...payload, focus: true };
        }
        if (size) {
            payload = { ...payload, width: size.width, height: size.height };
        }
        if (snapshotRect) {
            payload = { ...payload, snapshotRect };
        }
        if (sceneIndex) {
            payload = { ...payload, sceneIndex }
        }
        emitter.emit(Events.InitReplay, payload);
        return payload;
    }

    public emitAppSceneStateChange(sceneState: SceneState) {
        this.appEmitter.emit("sceneStateChange", sceneState!);
    }

    public emitAppIsWritableChange() {
        this.appEmitter.emit("writableChange", this.isWritable);
    }

    private makeAppEventListener(appId: string) {
        return (eventName: AppListenerKeys, data: any) => {
            switch (eventName) {
                case "setBoxSize": {
                    this.boxManager.resizeBox({
                        appId,
                        width: data.width,
                        height: data.height,
                    });
                    break;
                }
                case "setBoxMinSize": {
                    this.boxManager.setBoxMinSize({
                        appId,
                        minWidth: data.minwidth,
                        minHeight: data.minheight
                    });
                    break;
                }
                case "setBoxTitle": {
                    this.boxManager.setBoxTitle({ appId, title: data.title });
                    break;
                }
                case AppEvents.destroy: {
                    this.destroy(true, data?.error);
                    if (data?.error) {
                        console.error(data?.error);
                    }
                }
                default:
                    break;
            }
        }
    }

    private appAttributesUpdateListener = (appId: string) => {
        const disposer = autorun(() => {
            const attrs = this.manager.windowManger.attributes[appId];
            if (!isEqual(this.lastAttrs, attrs) && attrs !== undefined) {
                this.appEmitter.emit("attributesUpdate", attrs);
                this.lastAttrs = attrs;
            }
        });
        this.disposer = disposer;
    }

    public recoverCamera() {
        this.manager.cameraStore.recoverCamera(this.id, this.view);
    }

    public setScenePath() {
        const fullScenePath = this.getFullScenePath();
        if (this.manager.room && fullScenePath && this.view) {
            setScenePath(this.manager.room, fullScenePath);
        }
    }

    public switchToFreedom() {
        if (this.view && this.view.mode === ViewVisionMode.Writable) {
            const scenePath = this.getFullScenePath();
            if (scenePath) {
                setViewFocusScenePath(this.view, scenePath);
                setViewMode(this.view, ViewVisionMode.Freedom);
            }
        }
    }

    public setViewFocusScenePath() {
        const fullPath = this.getFullScenePath();
        if (fullPath && this.view) {
            setViewFocusScenePath(this.view, fullPath);
        }
    }

    public addCameraListener() {
        this.view?.callbacks.on("onCameraUpdated", this.cameraListener);
    }

    public removeCameraListener() {
        this.view?.callbacks.off("onCameraUpdated", this.cameraListener);
    }

    private createView(): View {
        const view = this.viewManager.createView(this.id);
        this.viewManager.addMainViewListener();
        this.setViewFocusScenePath();
        return view;
    }

    private cameraListener = (camera: Camera) => {
        this.manager.cameraStore.setCamera(this.id, camera);
    }

    public async destroy(needCloseBox: boolean, cleanAttrs: boolean, error?: Error) {
        await this.appEmitter.emit("destroy", { error });
        this.appEmitter.clearListeners();
        emitter.emit(`destroy-${this.id}`, { error });
        if (needCloseBox) {
            this.boxManager.closeBox(this.id);
        }
        if (this.disposer) {
            this.disposer();
        }
        if (cleanAttrs) {
            this.manager.delegate.cleanAppAttributes(this.id);
        }
        this.appProxies.delete(this.id);
        this.manager.cameraStore.deleteCamera(this.id);
        this.removeCameraListener();
        this.manager.viewManager.destroyView(this.id);
        this.manager.appStatus.delete(this.id);
    }
}
