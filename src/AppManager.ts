import { AppAttributes, AppStatus, Events, INIT_DIR, MagixEventName, ROOT_DIR } from "./constants";
import { AppCreateQueue } from "./Utils/AppCreateQueue";
import { AppListeners } from "./AppListener";
import { AppProxy } from "./App";
import { appRegister } from "./Register";
import { autorun, isPlayer, isRoom, ScenePathType } from "white-web-sdk";
import { boxEmitter } from "./BoxEmitter";
import { calculateNextIndex } from "./Page";
import { callbacks } from "./callback";
import { debounce, get, isInteger, orderBy } from "lodash";
import { internalEmitter } from "./InternalEmitter";
import { Fields, store } from "./AttributesDelegate";
import { log } from "./Utils/log";
import { MainViewProxy } from "./View/MainView";
import { onObjectRemoved, safeListenPropsUpdated } from "./Utils/Reactive";
import { reconnectRefresher, WindowManager } from "./index";
import { RedoUndo } from "./RedoUndo";
import { SideEffectManager } from "side-effect-manager";
import { ViewManager } from "./View/ViewManager";
import type { SyncRegisterAppPayload } from "./Register";
import type { RemoveSceneParams } from "./InternalEmitter";
import {
    entireScenes,
    genAppId,
    isRootDirPage,
    makeValidScenePath,
    parseSceneDir,
    removeScenes,
    setScenePath,
    setViewFocusScenePath,
} from "./Utils/Common";
import type { ReconnectRefresher } from "./ReconnectRefresher";
import type { BoxManager } from "./BoxManager";
import type {
    Displayer,
    Room,
    ScenesCallbacksNode,
    SceneState,
    RoomState,
} from "white-web-sdk";
import type { AddAppParams, BaseInsertParams, TeleBoxRect } from "./index";
import type {
    BoxClosePayload,
    BoxFocusPayload,
    BoxMovePayload,
    BoxResizePayload,
    BoxStateChangePayload,
} from "./BoxEmitter";


export class AppManager {
    public displayer: Displayer;
    public viewManager: ViewManager;
    public appProxies: Map<string, AppProxy> = new Map();
    public appStatus: Map<string, AppStatus> = new Map();
    public store = store;
    public mainViewProxy: MainViewProxy;
    public refresher?: ReconnectRefresher;
    public isReplay = this.windowManger.isReplay;
    public mainViewScenesLength = 0;

    private appListeners: AppListeners;
    public boxManager?: BoxManager;

    private _prevSceneIndex: number | undefined;
    private _prevFocused: string | undefined;
    private callbacksNode: ScenesCallbacksNode | null = null;
    private appCreateQueue = new AppCreateQueue();

    private sideEffectManager = new SideEffectManager();

    public sceneState: SceneState | null = null;

    public rootDirRemoving = false;

    constructor(public windowManger: WindowManager) {
        this.displayer = windowManger.displayer;
        this.store.setContext({
            getAttributes: () => this.attributes,
            safeSetAttributes: attributes => this.safeSetAttributes(attributes),
            safeUpdateAttributes: (keys, val) => this.safeUpdateAttributes(keys, val),
        });

        this.mainViewProxy = new MainViewProxy(this);
        this.viewManager = new ViewManager(this.displayer);
        this.appListeners = new AppListeners(this);
        this.displayer.callbacks.on(this.eventName, this.displayerStateListener);
        this.appListeners.addListeners();

        this.refresher = reconnectRefresher;
        this.refresher.setRoom(this.room);
        this.refresher.setContext({ emitter: internalEmitter });

        this.sideEffectManager.add(() => {
            return () => {
                this.appCreateQueue.destroy();
                this.mainViewProxy.destroy();
                this.refresher?.destroy();
                this.viewManager.destroy();
                this.boxManager?.destroy();
                this.callbacksNode?.dispose();
            };
        });

        internalEmitter.once("onCreated").then(() => this.onCreated());
        internalEmitter.on("onReconnected", () => this.onReconnected());

        if (isPlayer(this.displayer)) {
            internalEmitter.on("seekStart", this.onPlayerSeekStart);
            internalEmitter.on("seek", this.onPlayerSeekDone);
        }

        internalEmitter.on("removeScenes", this.onRemoveScenes);
        internalEmitter.on("setReadonly", this.onReadonlyChanged);

        this.createRootDirScenesCallback();

        appRegister.setSyncRegisterApp(payload => {
            this.safeUpdateAttributes([Fields.Registered, payload.kind], payload);
        });
    }

    private onRemoveScenes = async (params: RemoveSceneParams) => {
        const { scenePath } = params;
        // 如果移除根目录就把 scenePath 设置为初始值
        if (scenePath === ROOT_DIR) {
            await this.onRootDirRemoved();
            this.dispatchInternalEvent(Events.RootDirRemoved);
            return;
        }
        if (isRootDirPage(scenePath)) {
            let nextIndex = this.mainView.focusSceneIndex || 0;
            let sceneName = this.callbacksNode?.scenes[nextIndex];
            if (!sceneName) {
                nextIndex = 0;
                sceneName = this.callbacksNode?.scenes[nextIndex];
            }
            if (sceneName) {
                this.setMainViewScenePath(`${ROOT_DIR}${sceneName}`);
            }
            await this.setMainViewSceneIndex(nextIndex);
        } else {
            this.appProxies.forEach(app => {
                app.onRemoveScene(scenePath);
            });
        }
    };

    /**
     * 根目录被删除时所有的 scene 都会被删除.
     * 所以需要关掉所有开启了 view 的 app
     */
    public async onRootDirRemoved(needClose = true) {
        this.setMainViewScenePath(INIT_DIR);
        this.createRootDirScenesCallback();

        for (const [id, appProxy] of this.appProxies.entries()) {
            if (appProxy.view) {
                await this.closeApp(id, needClose);
            }
        }
        // 删除了根目录的 scenes 之后 mainview 需要重新绑定, 否则主白板会不能渲染
        this.mainViewProxy.rebind();
        internalEmitter.emit("rootDirRemoved");
        this.updateRootDirRemoving(false);
    }

    private onReadonlyChanged = () => {
        this.appProxies.forEach(appProxy => {
            appProxy.emitAppIsWritableChange();
        });
    };

    private onPlayerSeekStart = async () => {
        await this.closeAll();
    };

    private onPlayerSeekDone = async (time: number) => {
        await this.attributesUpdateCallback(this.attributes.apps);
        this.appProxies.forEach(appProxy => {
            appProxy.onSeek(time);
        });
    };

    public createRootDirScenesCallback = () => {
        let isRecreate = false;
        if (this.callbacksNode) {
            this.callbacksNode.dispose();
            isRecreate = true;
        }
        this.callbacksNode = this.displayer.createScenesCallback(ROOT_DIR, {
            onAddScene: this.onSceneChange,
            onRemoveScene: async (node, name) => {
                await this.onSceneChange(node);
                internalEmitter.emit("rootDirSceneRemoved", name);
            },
        });
        if (this.callbacksNode) {
            this.updateSceneState(this.callbacksNode);
            this.mainViewScenesLength = this.callbacksNode.scenes.length;
            if (isRecreate) {
                this.emitMainViewScenesChange(this.callbacksNode.scenes.length);
            }
        }
    };

    public removeSceneByIndex = async (index: number) => {
        const nextIndex = calculateNextIndex(index, this.windowManger.pageState);
        this.setSceneIndexWithoutSync(nextIndex);
        this.dispatchInternalEvent(Events.SetAppFocusIndex, { type: "main", index: nextIndex });
        const scene = this.callbacksNode?.scenes[index];
        setTimeout(() => {
            if (scene) {
                removeScenes(this.room, `${ROOT_DIR}${scene}`, index);
            }
        }, 100);
        return new Promise<boolean>((resolve, reject) => {
            internalEmitter
                .once("rootDirSceneRemoved")
                .then(name => {
                    if (name === scene) {
                        resolve(true);
                    }
                })
                .catch(e => {
                    console.log(`[WindowManager]: removePage error: ${e}`);
                    reject(false);
                });
        });
    };

    public setSceneIndexWithoutSync = (index: number) => {
        const sceneName = this.callbacksNode?.scenes[index];
        if (sceneName) {
            this.mainViewProxy.setFocusScenePath(`${ROOT_DIR}${sceneName}`);
        }
    };

    private onSceneChange = (node: ScenesCallbacksNode) => {
        this.mainViewScenesLength = node.scenes.length;
        this.updateSceneState(node);
        return this.emitMainViewScenesChange(this.mainViewScenesLength);
    };

    private emitMainViewScenesChange = (length: number) => {
        return Promise.all([
            callbacks.emit("mainViewScenesLengthChange", length),
            internalEmitter.emit("changePageState"),
        ]);
    };

    private updateSceneState = (node: ScenesCallbacksNode) => {
        const currentIndex = this.store.getMainViewSceneIndex() || 0;
        let sceneName = node.scenes[currentIndex];
        if (!sceneName) {
            sceneName = node.scenes[this.mainView.focusSceneIndex || 0];
        }
        this.sceneState = {
            scenePath: `${ROOT_DIR}${sceneName}`,
            contextPath: node.path,
            index: currentIndex,
            scenes: node.scenes.map(scene => {
                return {
                    name: scene,
                };
            }),
            sceneName: sceneName,
        };
        callbacks.emit("sceneStateChange", this.sceneState);
    };

    private get eventName() {
        return isRoom(this.displayer) ? "onRoomStateChanged" : "onPlayerStateChanged";
    }

    public get attributes() {
        return this.windowManger.attributes;
    }

    public get canOperate() {
        return this.windowManger.canOperate;
    }

    public get room() {
        return isRoom(this.displayer) ? (this.displayer as Room) : undefined;
    }

    public get mainView() {
        return this.mainViewProxy.view;
    }

    public get focusApp() {
        if (this.store.focus) {
            return this.appProxies.get(this.store.focus);
        }
    }

    public get uid() {
        return this.room?.uid || "";
    }

    public getMainViewSceneDir() {
        const scenePath = this.store.getMainViewScenePath();
        if (scenePath) {
            return parseSceneDir(scenePath);
        } else {
            throw new Error("[WindowManager]: mainViewSceneDir not found");
        }
    }

    private async onCreated() {
        await this.attributesUpdateCallback(this.attributes.apps);
        internalEmitter.emit("updateManagerRect");
        boxEmitter.on("move", this.onBoxMove);
        boxEmitter.on("resize", this.onBoxResize);
        boxEmitter.on("focus", this.onBoxFocus);
        boxEmitter.on("close", this.onBoxClose);
        boxEmitter.on("boxStateChange", this.onBoxStateChange);

        this.addAppsChangeListener();
        this.addAppCloseListener();
        this.refresher?.add("maximized", () => {
            return autorun(() => {
                const maximized = this.attributes.maximized;
                this.boxManager?.setMaximized(Boolean(maximized));
            });
        });
        this.refresher?.add("minimized", () => {
            return autorun(() => {
                const minimized = this.attributes.minimized;
                this.onMinimized(minimized);
            });
        });
        this.refresher?.add("mainViewIndex", () => {
            return autorun(() => {
                const mainSceneIndex = get(this.attributes, "_mainSceneIndex");
                this.onMainViewIndexChange(mainSceneIndex);
            });
        });
        this.refresher?.add("focusedChange", () => {
            return autorun(() => {
                const focused = get(this.attributes, "focus");
                this.onFocusChange(focused);
            });
        });
        this.refresher?.add("registeredChange", () => {
            return autorun(() => {
                const registered = get(this.attributes, Fields.Registered);
                this.onRegisteredChange(registered);
            });
        });
        if (!this.attributes.apps || Object.keys(this.attributes.apps).length === 0) {
            const mainScenePath = this.store.getMainViewScenePath();
            if (!mainScenePath) return;
            this.resetScenePath(mainScenePath);
        }
        this.displayerWritableListener(!this.room?.isWritable);
        this.displayer.callbacks.on("onEnableWriteNowChanged", this.displayerWritableListener);
        this._prevFocused = this.attributes.focus;

        this.sideEffectManager.add(() => {
            const redoUndo = new RedoUndo({
                mainView: () => this.mainViewProxy.view,
                focus: () => this.attributes.focus,
                getAppProxy: id => this.appProxies.get(id),
            });
            return () => redoUndo.destroy();
        });
    }

    private onBoxMove = (payload: BoxMovePayload) => {
        this.dispatchInternalEvent(Events.AppMove, payload);
        this.store.updateAppState(payload.appId, AppAttributes.Position, {
            x: payload.x,
            y: payload.y,
        });
    };

    private onBoxResize = (payload: BoxResizePayload) => {
        if (payload.width && payload.height) {
            this.dispatchInternalEvent(Events.AppResize, payload);
            this.store.updateAppState(payload.appId, AppAttributes.Size, {
                width: payload.width,
                height: payload.height,
            });
        }
    };

    private onBoxFocus = (payload: BoxFocusPayload) => {
        this.windowManger.safeSetAttributes({ focus: payload.appId });
    };

    private onBoxClose = (payload: BoxClosePayload) => {
        const appProxy = this.appProxies.get(payload.appId);
        if (appProxy) {
            appProxy.destroy(false, true, true, payload.error);
        }
    };

    private onBoxStateChange = (payload: BoxStateChangePayload) => {
        this.dispatchInternalEvent(Events.AppBoxStateChange, payload);
    };

    public addAppsChangeListener = () => {
        this.refresher?.add("apps", () => {
            return safeListenPropsUpdated(
                () => this.attributes.apps,
                () => {
                    this.attributesUpdateCallback(this.attributes.apps);
                }
            );
        });
    };

    public addAppCloseListener = () => {
        this.refresher?.add("appsClose", () => {
            return onObjectRemoved(this.attributes.apps, () => {
                this.onAppDelete(this.attributes.apps);
            });
        });
    };

    private onMainViewIndexChange = (index: number) => {
        if (index !== undefined && this._prevSceneIndex !== index) {
            callbacks.emit("mainViewSceneIndexChange", index);
            internalEmitter.emit("changePageState");
            if (this.callbacksNode) {
                this.updateSceneState(this.callbacksNode);
            }
            this._prevSceneIndex = index;
        }
    };

    private onFocusChange = (focused: string | undefined) => {
        if (this._prevFocused !== focused) {
            callbacks.emit("focusedChange", focused);
            internalEmitter.emit("focusedChange", { focused, prev: this._prevFocused });
            this._prevFocused = focused;
            if (focused !== undefined) {
                this.boxManager?.focusBox({ appId: focused });
                // 确保 focus 修改的时候, appProxy 已经创建
                setTimeout(() => {
                    const appProxy = this.appProxies.get(focused);
                    if (appProxy) {
                        appRegister.notifyApp(appProxy.kind, "focus", { appId: focused });
                    }
                }, 0);
            }
        }
    };

    public attributesUpdateCallback = debounce(
        (apps: any) => this._attributesUpdateCallback(apps),
        100
    );

    private _appIds: string[] = [];
    public notifyAppsChange(appIds: string[]): void {
        if (this._appIds.length !== appIds.length || !this._appIds.every(id => appIds.includes(id))) {
            this._appIds = appIds;
            callbacks.emit("appsChange", appIds);
        }
    }

    /**
     * 插件更新 attributes 时的回调
     *
     * @param {*} attributes
     * @memberof WindowManager
     */
    public async _attributesUpdateCallback(apps: any) {
        if (apps && WindowManager.container) {
            const appIds = Object.keys(apps);
            if (appIds.length === 0) {
                this.appCreateQueue.emitReady();
            }
            const appsWithCreatedAt = orderBy(appIds.map(appId => {
                return {
                    id: appId,
                    createdAt: apps[appId].createdAt,
                };
            }), "createdAt", "asc");
            const orderedAppIds = appsWithCreatedAt.map(({ id }) => id);
            this.notifyAppsChange(orderedAppIds);
            for (const id of orderedAppIds) {
                if (!this.appProxies.has(id) && !this.appStatus.has(id)) {
                    const app = apps[id];
                    try {
                        const appAttributes = this.attributes[id];
                        if (!appAttributes) {
                            throw new Error("appAttributes is undefined");
                        }
                        this.appCreateQueue.push<AppProxy>(() => {
                            this.appStatus.set(id, AppStatus.StartCreate);
                            return this.baseInsertApp(
                                {
                                    kind: app.kind,
                                    options: app.options,
                                    isDynamicPPT: app.isDynamicPPT,
                                },
                                id,
                                false
                            );
                        });
                        this.focusByAttributes(apps);
                    } catch (error) {
                        console.warn(`[WindowManager]: Insert App Error`, error);
                    }
                }
            }
        }
    }

    private onRegisteredChange = (registered: Record<string, SyncRegisterAppPayload>) => {
        if (!registered) return;
        Object.entries(registered).forEach(([kind, payload]) => {
            if (!appRegister.appClasses.has(kind)) {
                appRegister.register({
                    kind,
                    src: payload.src,
                    name: payload.name,
                });
            }
        });
    };

    private onMinimized = (minimized: boolean | undefined) => {
        if (this.boxManager?.minimized !== minimized) {
            if (minimized === true) {
                this.boxManager?.blurAllBox();
            }
            setTimeout(() => {
                this.boxManager?.setMinimized(Boolean(minimized));
            }, 0);
        }
    };

    public refresh() {
        this.attributesUpdateCallback(this.attributes.apps);
    }

    public setBoxManager(boxManager: BoxManager) {
        this.boxManager = boxManager;
    }

    public resetMaximized() {
        this.boxManager?.setMaximized(Boolean(this.store.getMaximized()));
    }

    public resetMinimized() {
        this.boxManager?.setMinimized(Boolean(this.store.getMinimized()));
    }

    private onAppDelete = async (apps: any) => {
        const ids = Object.keys(apps);
        for (const [id, appProxy] of this.appProxies.entries()) {
            if (!ids.includes(id)) {
                await appProxy.destroy(true, false, true);
            }
        }
    };

    private closeAll = async () => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for (const [_, appProxy] of this.appProxies.entries()) {
            await appProxy.destroy(true, false, true);
        }
    };

    public bindMainView(divElement: HTMLDivElement, disableCameraTransform: boolean) {
        const mainView = this.mainViewProxy.view;
        mainView.disableCameraTransform = disableCameraTransform;
        mainView.divElement = divElement;
        if (!mainView.focusScenePath) {
            this.setMainViewFocusPath();
        }
        internalEmitter.emit("mainViewMounted");
    }

    public setMainViewFocusPath(scenePath?: string) {
        const focusScenePath = scenePath || this.store.getMainViewScenePath();
        if (focusScenePath) {
            setViewFocusScenePath(this.mainView, focusScenePath);
            return this.mainView?.focusScenePath === focusScenePath;
        }
    }

    private resetScenePath(scenePath: string) {
        const sceneState = this.displayer.state.sceneState;
        if (sceneState.scenePath !== scenePath) {
            setScenePath(this.room, scenePath);
        }
    }

    public async addApp(params: AddAppParams, isDynamicPPT: boolean): Promise<string | undefined> {
        log("addApp", params);
        const { appId, needFocus } = await this.beforeAddApp(params, isDynamicPPT);
        const appProxy = await this.baseInsertApp(params, appId, true, needFocus);
        this.afterAddApp(appProxy);
        return appProxy?.id;
    }

    private async beforeAddApp(params: AddAppParams, isDynamicPPT: boolean) {
        const appId = await genAppId(params.kind);
        this.appStatus.set(appId, AppStatus.StartCreate);
        const attrs = params.attributes ?? {};
        this.safeUpdateAttributes([appId], attrs);
        this.store.setupAppAttributes(params, appId, isDynamicPPT);
        const needFocus = !this.boxManager?.minimized;
        if (needFocus) {
            this.store.setAppFocus(appId, true);
        }
        return { appId, needFocus };
    }

    private afterAddApp(appProxy: AppProxy | undefined) {
        if (appProxy && appProxy.box) {
            const box = appProxy.box;
            boxEmitter.emit("move", {
                appId: appProxy.id,
                x: box?.intrinsicX,
                y: box?.intrinsicY,
            });
            this.store.updateAppState(appProxy.id, AppAttributes.ZIndex, box.zIndex);
        }
        if (this.boxManager?.minimized) {
            this.boxManager?.setMinimized(false, false);
        }
    }

    public async closeApp(appId: string, needClose = true) {
        const appProxy = this.appProxies.get(appId);
        if (appProxy) {
            appProxy.destroy(true, needClose, false);
        }
    }

    private async baseInsertApp(
        params: BaseInsertParams,
        appId: string,
        isAddApp: boolean,
        focus?: boolean
    ) {
        if (this.appProxies.has(appId)) {
            console.warn("[WindowManager]: app duplicate exists and cannot be created again");
            return;
        }
        const appProxy = new AppProxy(params, this, appId, isAddApp);
        if (appProxy) {
            await appProxy.baseInsertApp(focus);
            this.appStatus.delete(appId);
            return appProxy;
        } else {
            this.appStatus.delete(appId);
            throw new Error("[WindowManger]: initialize AppProxy failed");
        }
    }

    private displayerStateListener = (state: Partial<RoomState>) => {
        const sceneState = state.sceneState;
        if (sceneState) {
            const scenePath = sceneState.scenePath;
            this.appProxies.forEach(appProxy => {
                if (appProxy.scenePath && scenePath.startsWith(appProxy.scenePath)) {
                    appProxy.emitAppSceneStateChange(sceneState);
                    appProxy.setFullPath(scenePath);
                }
            });
        }
        this.appProxies.forEach(appProxy => {
            appProxy.appEmitter.emit("roomStateChange", state);
        });
        internalEmitter.emit("observerIdChange", this.displayer.observerId);
    };

    public displayerWritableListener = (isReadonly: boolean) => {
        const isWritable = !isReadonly;
        const isManualWritable =
            this.windowManger.readonly === undefined || this.windowManger.readonly === false;
        if (this.windowManger.readonly === undefined) {
            this.boxManager?.setReadonly(isReadonly);
        } else {
            this.boxManager?.setReadonly(!(isWritable && isManualWritable));
        }
        this.appProxies.forEach(appProxy => {
            appProxy.emitAppIsWritableChange();
        });
        internalEmitter.emit("writableChange", isWritable);
    };

    public safeSetAttributes(attributes: any) {
        this.windowManger.safeSetAttributes(attributes);
    }

    public safeUpdateAttributes(keys: string[], value: any) {
        this.windowManger.safeUpdateAttributes(keys, value);
    }

    public async setMainViewScenePath(scenePath: string) {
        if (this.room) {
            const scenePathType = this.displayer.scenePathType(scenePath);
            const sceneDir = parseSceneDir(scenePath);
            if (sceneDir !== ROOT_DIR) {
                throw new Error(`[WindowManager]: main view scenePath must in root dir "/"`);
            }
            if (scenePathType === ScenePathType.None) {
                throw new Error(`[WindowManager]: ${scenePath} not valid scene`);
            } else if (scenePathType === ScenePathType.Page) {
                await this._setMainViewScenePath(scenePath);
            } else if (scenePathType === ScenePathType.Dir) {
                const validScenePath = makeValidScenePath(this.displayer, scenePath);
                if (validScenePath) {
                    await this._setMainViewScenePath(validScenePath);
                }
            }
        }
    }

    private async _setMainViewScenePath(scenePath: string) {
        const success = this.setMainViewFocusPath(scenePath);
        if (success) {
            this.safeSetAttributes({ _mainScenePath: scenePath });
            this.store.setMainViewFocusPath(this.mainView);
            this.updateSceneIndex();
            this.dispatchSetMainViewScenePath(scenePath);
        }
    }

    private updateSceneIndex = () => {
        const scenePath = this.store.getMainViewScenePath() as string;
        const sceneDir = parseSceneDir(scenePath);
        const scenes = entireScenes(this.displayer)[sceneDir];
        if (scenes.length) {
            // "/ppt3/1" -> "1"
            const pageName = scenePath.replace(sceneDir, "").replace("/", "");
            const index = scenes.findIndex(scene => scene.name === pageName);
            if (isInteger(index) && index >= 0) {
                this.safeSetAttributes({ _mainSceneIndex: index });
            }
        }
    };

    public async setMainViewSceneIndex(index: number) {
        if (this.room) {
            if (this.store.getMainViewSceneIndex() === index) return;
            const sceneName = this.callbacksNode?.scenes[index];
            const scenePath = `${ROOT_DIR}${sceneName}`;
            if (sceneName) {
                const success = this.setMainViewFocusPath(scenePath);
                if (success) {
                    this.store.setMainViewScenePath(scenePath);
                    this.store.setMainViewSceneIndex(index);
                    this.dispatchSetMainViewScenePath(scenePath);
                }
            } else {
                throw new Error(`[WindowManager]: ${index} not valid index`);
            }
        }
    }

    private dispatchSetMainViewScenePath(scenePath: string): void {
        this.dispatchInternalEvent(Events.SetMainViewScenePath, { nextScenePath: scenePath });
        callbacks.emit("mainViewScenePathChange", scenePath);
        // 兼容 15 的 SDK, 需要 room 的当前 ScenePath
        setScenePath(this.room, scenePath);
    }

    public getAppInitPath(appId: string): string | undefined {
        const attrs = this.store.getAppAttributes(appId);
        if (attrs) {
            return attrs?.options?.scenePath;
        }
    }

    public safeDispatchMagixEvent(event: string, payload: any) {
        if (this.canOperate) {
            (this.displayer as Room).dispatchMagixEvent(event, payload);
        }
    }

    public focusByAttributes(apps: any) {
        if (apps && Object.keys(apps).length === this.boxManager?.boxSize) {
            const focusAppId = this.store.focus;
            if (focusAppId) {
                this.boxManager.focusBox({ appId: focusAppId });
            }
        }
    }

    public async onReconnected() {
        this.attributesUpdateCallback(this.attributes.apps);
        const appProxies = Array.from(this.appProxies.values());
        const reconnected = appProxies.map(appProxy => {
            return appProxy.onReconnected();
        });
        this.mainViewProxy.onReconnect();
        await Promise.all(reconnected);
        if (this.callbacksNode) {
            this.onSceneChange(this.callbacksNode);
        }
    }

    public notifyContainerRectUpdate(rect: TeleBoxRect) {
        this.appProxies.forEach(appProxy => {
            appProxy.appEmitter.emit("containerRectUpdate", rect);
        });
    }

    public updateRootDirRemoving = (removing: boolean) => {
        this.rootDirRemoving = removing;
    };

    public dispatchInternalEvent(event: Events, payload?: any) {
        this.safeDispatchMagixEvent(MagixEventName, {
            eventName: event,
            payload: payload,
        });
    }

    public destroy() {
        this.displayer.callbacks.off(this.eventName, this.displayerStateListener);
        this.displayer.callbacks.off("onEnableWriteNowChanged", this.displayerWritableListener);
        this.appListeners.removeListeners();
        boxEmitter.clearListeners();
        internalEmitter.clearListeners();
        if (this.appProxies.size) {
            this.appProxies.forEach(appProxy => {
                appProxy.destroy(true, false, true);
            });
        }
        callbacks.clearListeners();
        this.sideEffectManager.flushAll();
        this._prevFocused = undefined;
        this._prevSceneIndex = undefined;
    }
}
