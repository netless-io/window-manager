import Emittery from "emittery";
import { AppAttributes, AppEvents, Events, SETUP_APP_DELAY } from "../constants";
import { AppContext } from "./AppContext";
import { AppPageStateImpl } from "./AppPageStateImpl";
import { appRegister } from "../Register";
import { ViewSync } from "../View/ViewSync"
import { autorun, reaction, toJS } from "white-web-sdk";
import { boxEmitter } from "../BoxEmitter";
import { BoxManagerNotFoundError } from "../Utils/error";
import { calculateNextIndex } from "../Page";
import { combine, Val, ValManager } from "value-enhancer";
import { debounce, get, isEqual, isUndefined, omitBy } from "lodash";
import { emitter } from "../InternalEmitter";
import { Fields } from "../AttributesDelegate";
import { log } from "../Utils/log";
import { SideEffectManager } from "side-effect-manager";
import type { ICamera, ISize } from "../AttributesDelegate";
import {
    entireScenes,
    getScenePath,
    putScenes,
    removeScenes,
    setScenePath,
    setViewFocusScenePath,
} from "../Utils/Common";
import type {
    AppEmitterEvent,
    BaseInsertParams,
    setAppOptions,
    AppListenerKeys,
} from "../index";
import type { SceneState, View, SceneDefinition,  MemberState} from "white-web-sdk";
import type { AppManager } from "../AppManager";
import type { NetlessApp } from "../typings";
import type { ReadonlyTeleBox, TeleBox, TeleBoxRect } from "@netless/telebox-insider";
import type { PageRemoveService, PageState } from "../Page";
import type { AppState } from "./type";
import { callbacks } from "../callback";

export type AppEmitter = Emittery<AppEmitterEvent>;

export class AppProxy implements PageRemoveService {
    public kind: string;
    public id: string;
    public scenePath?: string;
    private appScenePath: string;
    public appEmitter: AppEmitter;
    public scenes?: SceneDefinition[];

    private appListener: any;
    private boxManager = this.manager.boxManager;
    private appProxies = this.manager.appProxies;
    private viewManager = this.manager.viewManager;
    private store = this.manager.store;
    public uid = this.manager.uid;

    public isAddApp: boolean;
    public status: "normal" | "destroyed" = "normal";
    private stateKey: string;
    public _pageState: AppPageStateImpl;

    public appResult?: NetlessApp;
    public appContext?: AppContext;

    public sideEffectManager = new SideEffectManager();
    private valManager = new ValManager();

    private fullPath$ = this.valManager.attach(new Val<string | undefined>(undefined));
    private viewSync?: ViewSync;

    public camera$ = this.valManager.attach(new Val<ICamera | undefined>(undefined));
    public size$ = this.valManager.attach(new Val<ISize | undefined>(undefined));
    public box$ = this.valManager.attach(new Val<ReadonlyTeleBox | undefined>(undefined));
    public view$ = this.valManager.attach(new Val<View | undefined>(undefined));
    public syncCamera$ = this.valManager.attach(new Val<boolean>(true));
    public whiteBoardViewCreated$ = this.valManager.attach(new Val<boolean>(false));

    constructor(
        private params: BaseInsertParams,
        private manager: AppManager,
        appId: string,
        isAddApp: boolean
    ) {
        this.kind = params.kind;
        this.id = appId;
        this.appScenePath = `/${this.id}-app-dir`;
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
        if (!this.scenePath) {
            this.scenePath = this.appScenePath;
        }
        this._pageState = new AppPageStateImpl({
            displayer: this.manager.displayer,
            scenePath: this.scenePath,
            view: this.view,
            notifyPageStateChange: this.notifyPageStateChange,
        });
        this.sideEffectManager.add(() => () => this._pageState.destroy());
        this.camera$.setValue(toJS(this.appAttributes.camera));
        this.size$.setValue(toJS(this.appAttributes.size));
        this.addCameraReaction();
        this.addSizeReaction();
        this.sideEffectManager.add(() =>
            emitter.on("memberStateChange", this.onMemberStateChange)
        );
        this.sideEffectManager.add(() => [
            this.syncCamera$.reaction(syncCamera => {
                if (!syncCamera) {
                    if (this.viewSync) {
                        this.viewSync.destroy();
                        this.viewSync = undefined;
                        this.sideEffectManager.flush("camera");
                        this.sideEffectManager.flush("size");
                    }
                }
            }),
            this.whiteBoardViewCreated$.reaction(created => {
                if (created && this.box) {
                    if (!this.syncCamera$.value) return;
                    combine([this.box$, this.view$]).subscribe(([box, view]) => {
                        if (box && view) {
                            if (!this.camera$.value) {
                                this.storeCamera({
                                    centerX: null,
                                    centerY: null,
                                    scale: 1,
                                    id: this.uid,
                                });
                                this.camera$.setValue(toJS(this.appAttributes.camera));
                            }
                            if (!this.size$.value && box.stageRect) {
                                const initialRect = this.computedInitialRect(box.stageRect);
                                const width = initialRect?.width || box.stageRect.width;
                                const height = initialRect?.height || box.stageRect.height;
                                this.storeSize({
                                    id: this.uid,
                                    width,
                                    height,
                                });
                                this.size$.setValue(toJS(this.appAttributes.size));
                            }
                            this.viewSync = new ViewSync({
                                uid: this.uid,
                                view$: this.view$,
                                camera$: this.camera$,
                                size$: this.size$,
                                stageRect$: box._stageRect$,
                                storeCamera: this.storeCamera,
                                storeSize: this.storeSize
                            });
                            this.sideEffectManager.add(() => () => this.viewSync?.destroy());
                            this.whiteBoardViewCreated$.destroy();
                        }
                    })
                }
            }),
            this.manager.members$.reaction(members => {
                this.appEmitter.emit("roomMembersChange", members);
            }),
        ]);
    }

    public fireMemberStateChange = () => {
        if (this.manager.room) {
            this.onMemberStateChange(this.manager.room.state.memberState);
        }
    }

    private onMemberStateChange = (memberState: MemberState) => {
        // clicker 教具把事件穿透给下层
        const needPointerEventsNone = memberState.currentApplianceName === "clicker";
        if (needPointerEventsNone) {
            if (this.appContext?._viewWrapper) {
                this.appContext._viewWrapper.style.pointerEvents = "none";
            }
        } else {
            if (this.appContext?._viewWrapper) {
                this.appContext._viewWrapper.style.pointerEvents = "auto";
            }
        }
    }

    private computedInitialRect = (boxRect: TeleBoxRect) => {
        const managerRect = this.manager.boxManager?.stageRect;
        if (managerRect) {
            const { width, height } = managerRect;
            const boxRatio = boxRect.height / boxRect.width;
            if (height < 480) {
                return {
                    width: 480 / boxRatio,
                    height: 480,
                };
            } else {
                return {
                    width: width * 0.65,
                    height: height * 0.65,
                };
            }
        }
    }

    public createAppDir() {
        const scenePath = this.scenePath || this.appScenePath;
        const sceneNode = this._pageState.createSceneNode(scenePath);
        if (!sceneNode) {
            putScenes(this.manager.room, scenePath, [{ name: "1" }]);
            this._pageState.createSceneNode(scenePath);
            this.setSceneIndex(0);
        }
        this.scenes = entireScenes(this.manager.displayer)[scenePath];
        const view = this.createView();
        this._pageState.setView(view);
        return view;
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
        return this.view$.value;
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
        this.store.updateAppAttributes(this.id, Fields.FullPath, path);
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
        emitter.emit("updateManagerRect");
        return {
            appId: this.id,
            app: appImpl,
        };
    }

    public get box(): ReadonlyTeleBox | undefined {
        return this.box$.value;
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
        const context = new AppContext(this.manager, appId, this, appOptions);
        this.appContext = context;
        try {
            emitter.once(`${appId}${Events.WindowCreated}` as any).then(async () => {
                let boxInitState: AppState | undefined;
                if (!skipUpdate) {
                    boxInitState = this.getAppInitState(appId);
                    this.boxManager?.updateBoxState(boxInitState);
                }
                this.appEmitter.onAny(this.appListener);
                this.appAttributesUpdateListener(appId);
                this.setViewFocusScenePath();
                setTimeout(async () => {
                    // 延迟执行 setup, 防止初始化的属性没有更新成功
                    const result = await app.setup(context);
                    this.appResult = result;
                    appRegister.notifyApp(this.kind, "created", { appId, result });
                    this.fixMobileSize();
                    if (this.isAddApp) {
                        this.setupDone();
                    }
                }, SETUP_APP_DELAY);
            });
            const box = this.boxManager?.createBox({
                appId: appId,
                app,
                options,
                canOperate: this.manager.canOperate,
                smartPosition: this.isAddApp,
            }) as TeleBox;
            const registerParams = appRegister.registered.get(this.kind);
            if (registerParams?.contentStyles) {
                box?.mountUserStyles(registerParams.contentStyles);
            }
            this.box$.setValue(box);
            if (this.isAddApp && this.box) {
                this.store.updateAppState(appId, AppAttributes.ZIndex, this.box.zIndex);
                this.store.updateAppState(appId, AppAttributes.Size, {
                    width: this.box.intrinsicWidth,
                    height: this.box.intrinsicHeight,
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
            if (!box.minimized) {
                this.boxManager?.resizeBox({
                    appId: this.id,
                    width: box.intrinsicWidth + 0.001,
                    height: box.intrinsicHeight + 0.001,
                    skipUpdate: true,
                });
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

    public getAppInitState = (id: string): AppState | undefined => {
        const attrs = this.store.getAppState(id);
        if (!attrs) return;
        const focus = this.store.focus;
        const maximized = this.attributes?.["maximized"];
        const minimized = this.attributes?.["minimized"];
        let payload = { maximized, minimized, id } as AppState;
        const state =  omitBy(attrs, isUndefined);
        if (focus === id) {
            payload = { ...payload, focus: true };
        }
        return  Object.assign(payload, state);;
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
        this.sideEffectManager.add(() => [
            this.manager.refresher.add(appId, () => {
                return autorun(() => {
                    const attrs = this.manager.attributes[appId];
                    if (attrs) {
                        this.appEmitter.emit("attributesUpdate", attrs);
                    }
                });
            }),
            this.manager.refresher.add(this.stateKey, () => {
                return autorun(() => {
                    const appState = this.appAttributes?.state;
                    if (appState?.zIndex > 0 && appState.zIndex !== this.box?.zIndex) {
                        this.boxManager?.setZIndex(appId, appState.zIndex);
                    }
                });
            }),
            this.manager.refresher.add(`${appId}-fullPath`, () => {
                return autorun(() => {
                    const fullPath = this.appAttributes?.fullPath;
                    this.setFocusScenePathHandler(fullPath);
                    if (this.fullPath$.value !== fullPath) {
                        this.notifyPageStateChange();
                        this.fullPath$.setValue(fullPath);
                    }
                });
            }),
        ]);
    };

    private setFocusScenePathHandler = debounce((fullPath: string | undefined) => {
        if (this.view && fullPath && fullPath !== this.view?.focusScenePath) {
            setViewFocusScenePath(this.view, fullPath);
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
        if (this.status === "destroyed") return;
        const fullPath = this.getFullScenePath();
        if (fullPath && this.view) {
            setViewFocusScenePath(this.view, fullPath);
        }
        return fullPath;
    }

    private createView(): View {
        const view = this.viewManager.createView(this.id);
        this.view$.setValue(view);
        this.setViewFocusScenePath();
        return view;
    }

    public notifyPageStateChange = debounce(() => {
        if (this.pageState) {
            this.appEmitter.emit("pageStateChange", this.pageState);
        }
    }, 50);

    public get pageState(): PageState {
        return this._pageState.toObject();
    }

    // PageRemoveService
    public async removeSceneByIndex(index: number) {
        const scenePath = this._pageState.getFullPath(index);
        if (scenePath && this.pageState) {
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
                setScenePath(this.manager.room, fullPath);
            }
        }
    }

    public storeCamera = (camera: ICamera) => {
        this.store.updateAppAttributes(this.id, Fields.Camera, camera);
    };

    public storeSize = (size: ISize) => {
        this.store.updateAppAttributes(this.id, Fields.Size, size);
    };

    public updateSize = (width: number, height: number) => {
        const iSize = {
            id: this.manager.uid,
            width, height
        }
        this.store.updateAppAttributes(this.id, Fields.Size, iSize);
        this.size$.setValue(iSize);
    }

    public moveCamera = (camera: Partial<ICamera>) => {
        if (!this.camera$.value) {
            return;
        }
        const nextCamera = { ...this.camera$.value, ...camera, id: this.uid };
        this.storeCamera(nextCamera);
        this.camera$.setValue(nextCamera);
    };

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
            callbacks.emit("appClose", { appId: this.id, kind: this.kind, error });
            await this.appEmitter.emit("destroy", { error });
        } catch (error) {
            console.error("[WindowManager]: notifyApp error", error.message, error.stack);
        }
        this.appEmitter.clearListeners();
        this.sideEffectManager.flushAll();
        emitter.emit(`destroy-${this.id}` as any, { error });
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

        this.viewManager.destroyView(this.id);
        this.manager.appStatus.delete(this.id);
        this.valManager.destroy();
    }

    private addCameraReaction = () => {
        this.sideEffectManager.add(() =>
            this.manager.refresher.add(`${this.id}-camera`, () =>
                reaction(
                    () => this.appAttributes?.camera,
                    camera => {
                        if (camera) {
                            const rawCamera = toJS(camera);
                            if (!isEqual(rawCamera, this.camera$.value)) {
                                this.camera$.setValue(rawCamera);
                            }
                        }
                    }
                )
            )
        , "camera");
    }

    private addSizeReaction = () => {
        this.sideEffectManager.add(() =>
            this.manager.refresher.add(`${this.id}-size`, () =>
                reaction(
                    () => this.appAttributes?.size,
                    size => {
                        if (size) {
                            const rawSize = toJS(size);
                            if (!isEqual(rawSize, this.size$.value)) {
                                this.size$.setValue(rawSize);
                            }
                        }
                    }
                )
            )
        , "size");
    }

    public onFocus = () => {
        this.setScenePath();
    }

    // 异步值设置完成通知其他端创建 app
    private setupDone = () => {
        this.store.updateAppAttributes(this.id, "setup", true);
        this.manager.dispatchInternalEvent(Events.InvokeAttributesUpdateCallback);
    }

    public close(): Promise<void> {
        return this.destroy(true, true, false);
    }
}
