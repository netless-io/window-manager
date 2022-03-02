import { AppAttributes, AppStatus, Events, MagixEventName, ROOT_DIR } from "./constants";
import { AppCreateQueue } from "./Utils/AppCreateQueue";
import { AppListeners } from "./AppListener";
import { AppProxy } from "./AppProxy";
import { appRegister } from "./Register";
import { autorun, isPlayer, isRoom, ScenePathType } from "white-web-sdk";
import { callbacks } from "./callback";
import { emitter } from "./InternalEmitter";
import { get, isInteger, orderBy } from "lodash";
import { log } from "./Utils/log";
import { MainViewProxy } from "./View/MainView";
import { onObjectRemoved, safeListenPropsUpdated } from "./Utils/Reactive";
import { reconnectRefresher, WindowManager } from "./index";
import { RedoUndo } from "./RedoUndo";
import { SideEffectManager } from "side-effect-manager";
import { store } from "./AttributesDelegate";
import { ViewManager } from "./View/ViewManager";
import type { EmitterEvent } from "./InternalEmitter";
import {
    entireScenes,
    genAppId,
    makeValidScenePath,
    parseSceneDir,
    setScenePath,
    setViewFocusScenePath,
} from "./Utils/Common";
import type { ReconnectRefresher } from "./ReconnectRefresher";
import type { BoxManager } from "./BoxManager";
import type {
    Displayer,
    DisplayerState,
    Room,
    ScenesCallbacksNode,
    SceneState,
} from "white-web-sdk";
import type { AddAppParams, BaseInsertParams, TeleBoxRect } from "./index";
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
        this.refresher.setContext({ emitter });

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

        emitter.once("onCreated").then(() => this.onCreated());
        emitter.on("onReconnected", () => this.onReconnected());

        if (isPlayer(this.displayer)) {
            emitter.on("seek", this.onPlayerSeek);
        }

        emitter.on("removeScenes", this.onRemoveScenes);
        emitter.on("setReadonly", this.onReadonlyChanged);

        this.createRootDirScenesCallback();
    }

    private onRemoveScenes = (scenePath: string) => {
        if (scenePath === ROOT_DIR) {
            this.setMainViewScenePath(ROOT_DIR);
            this.createRootDirScenesCallback();
            this.onRootDirRemoved();
            emitter.emit("rootDirRemoved");
            return;
        }
        const mainViewScenePath = this.store.getMainViewScenePath();
        if (this.room && mainViewScenePath) {
            if (mainViewScenePath === scenePath) {
                this.setMainViewScenePath(ROOT_DIR);
            }
        }
    }

    /**
     * 根目录被删除时所有的 scene 都会被删除.
     * 所以需要关掉所有开启了 view 的 app
     */
    private onRootDirRemoved() {
        this.appProxies.forEach(appProxy => {
            if (appProxy.view) {
                this.closeApp(appProxy.id);
            }
        });
        // 删除了根目录的 scenes 之后 mainview 需要重新绑定, 否则主白板会不能渲染
        this.mainViewProxy.rebind();
    }

    private onReadonlyChanged = () => {
        this.appProxies.forEach(appProxy => {
            appProxy.emitAppIsWritableChange();
        });
    }

    private onPlayerSeek = (time: number) => {
        this.appProxies.forEach(appProxy => {
            appProxy.onSeek(time);
        });
        this.attributesUpdateCallback(this.attributes.apps);
        this.onAppDelete(this.attributes.apps);
    }

    private createRootDirScenesCallback = () => {
        let isRecreate = false;
        if (this.callbacksNode) {
            this.callbacksNode.dispose();
            isRecreate = true;
        }
        this.callbacksNode = this.displayer.createScenesCallback(ROOT_DIR, {
            onAddScene: this.onSceneChange,
            onRemoveScene: this.onSceneChange,
        });
        if (this.callbacksNode) {
            this.updateSceneState(this.callbacksNode);
            this.mainViewScenesLength = this.callbacksNode.scenes.length;
            if (isRecreate) {
                callbacks.emit("mainViewScenesLengthChange", this.callbacksNode.scenes.length);
            }
        }
    };

    private onSceneChange = (node: ScenesCallbacksNode) => {
        this.mainViewScenesLength = node.scenes.length;
        this.updateSceneState(node);
        callbacks.emit("mainViewScenesLengthChange", this.mainViewScenesLength);
    };

    private updateSceneState = (node: ScenesCallbacksNode) => {
        const currentIndex = this.store.getMainViewSceneIndex() || 0;
        const sceneName = node.scenes[currentIndex];
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
        emitter.emit("updateManagerRect");
        emitter.onAny(this.boxEventListener);
        this.refresher?.add("apps", () => {
            return safeListenPropsUpdated(
                () => this.attributes.apps,
                () => {
                    this.attributesUpdateCallback(this.attributes.apps);
                }
            );
        });
        this.refresher?.add("appsClose", () => {
            return onObjectRemoved(this.attributes.apps, () => {
                this.onAppDelete(this.attributes.apps);
            });
        });
        this.refresher?.add("maximized", () => {
            return autorun(() => {
                const maximized = this.attributes.maximized;
                this.boxManager?.setMaximized(Boolean(maximized));
            });
        });
        this.refresher?.add("minimized", () => {
            return autorun(() => {
                const minimized = this.attributes.minimized;
                if (this.boxManager?.minimized !== minimized) {
                    if (minimized === true) {
                        this.boxManager?.blurAllBox();
                    }
                    setTimeout(() => {
                        this.boxManager?.setMinimized(Boolean(minimized));
                    }, 0);
                }
            });
        });
        this.refresher?.add("mainViewIndex", () => {
            return autorun(() => {
                const mainSceneIndex = get(this.attributes, "_mainSceneIndex");
                if (mainSceneIndex !== undefined && this._prevSceneIndex !== mainSceneIndex) {
                    callbacks.emit("mainViewSceneIndexChange", mainSceneIndex);
                    if (this.callbacksNode) {
                        this.updateSceneState(this.callbacksNode);
                    }
                    this._prevSceneIndex = mainSceneIndex;
                }
            });
        });
        this.refresher?.add("focusedChange", () => {
            return autorun(() => {
                const focused = get(this.attributes, "focus");
                if (this._prevFocused !== focused) {
                    callbacks.emit("focusedChange", focused);
                    emitter.emit("focusedChange", { focused, prev: this._prevFocused });
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
            });
        });
        if (!this.attributes.apps || Object.keys(this.attributes.apps).length === 0) {
            const mainScenePath = this.store.getMainViewScenePath();
            if (!mainScenePath) return;
            const sceneState = this.displayer.state.sceneState;
            if (sceneState.scenePath !== mainScenePath) {
                setScenePath(this.room, mainScenePath);
            }
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

    /**
     * 插件更新 attributes 时的回调
     *
     * @param {*} attributes
     * @memberof WindowManager
     */
    public async attributesUpdateCallback(apps: any) {
        if (apps && WindowManager.container) {
            const appIds = Object.keys(apps);
            if (appIds.length === 0) {
                this.appCreateQueue.emitReady();
            }
            const appsWithCreatedAt = appIds.map(appId => {
                return {
                    id: appId,
                    createdAt: apps[appId].createdAt,
                };
            });
            for (const { id } of orderBy(appsWithCreatedAt, "createdAt", "asc")) {
                if (!this.appProxies.has(id) && !this.appStatus.has(id)) {
                    const app = apps[id];

                    this.appStatus.set(id, AppStatus.StartCreate);
                    try {
                        const appAttributes = this.attributes[id];
                        if (!appAttributes) {
                            throw new Error("appAttributes is undefined");
                        }
                        this.appCreateQueue.push(() => {
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

    private onAppDelete = (apps: any) => {
        const ids = Object.keys(apps);
        this.appProxies.forEach((appProxy, id) => {
            if (!ids.includes(id)) {
                appProxy.destroy(true, false, true);
            }
        });
    };

    public bindMainView(divElement: HTMLDivElement, disableCameraTransform: boolean) {
        const mainView = this.mainViewProxy.view;
        mainView.disableCameraTransform = disableCameraTransform;
        mainView.divElement = divElement;
        if (!mainView.focusScenePath) {
            this.setMainViewFocusPath();
        }
        emitter.emit("mainViewMounted");
    }

    public setMainViewFocusPath(scenePath?: string) {
        const focusScenePath = scenePath || this.store.getMainViewScenePath();
        if (focusScenePath) {
            const view = setViewFocusScenePath(this.mainView, focusScenePath);
            return view?.focusScenePath === focusScenePath;
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
            emitter.emit("move", {
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

    public async closeApp(appId: string) {
        const appProxy = this.appProxies.get(appId);
        if (appProxy) {
            appProxy.destroy(true, true, false);
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

    private displayerStateListener = (state: Partial<DisplayerState>) => {
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
        emitter.emit("observerIdChange", this.displayer.observerId);
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
        if (isWritable === true) {
            this.mainView.disableCameraTransform = false;
            if (this.room && this.room.disableSerialization === true) {
                this.room.disableSerialization = false;
            }
        } else {
            this.mainView.disableCameraTransform = true;
        }
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
            const mainViewScenePath = this.store.getMainViewScenePath() as string;
            if (mainViewScenePath) {
                const sceneDir = parseSceneDir(mainViewScenePath);
                const scenePath = makeValidScenePath(this.displayer, sceneDir, index);
                if (scenePath) {
                    const success = this.setMainViewFocusPath(scenePath);
                    if (success) {
                        this.store.setMainViewScenePath(scenePath);
                        this.safeSetAttributes({ _mainSceneIndex: index });
                        this.dispatchSetMainViewScenePath(scenePath);
                    }
                } else {
                    throw new Error(`[WindowManager]: ${sceneDir}: ${index} not valid index`);
                }
            }
        }
    }

    private dispatchSetMainViewScenePath(scenePath: string): void {
        this.dispatchInternalEvent(Events.SetMainViewScenePath, { nextScenePath: scenePath });
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

    private boxEventListener = (eventName: keyof EmitterEvent, payload: any) => {
        switch (eventName) {
            case "move": {
                this.dispatchInternalEvent(Events.AppMove, payload);
                this.store.updateAppState(payload.appId, AppAttributes.Position, {
                    x: payload.x,
                    y: payload.y,
                });
                break;
            }
            case "focus": {
                this.windowManger.safeSetAttributes({ focus: payload.appId });
                break;
            }
            case "resize": {
                if (payload.width && payload.height) {
                    this.dispatchInternalEvent(Events.AppResize, payload);
                    this.store.updateAppState(payload.appId, AppAttributes.Size, {
                        width: payload.width,
                        height: payload.height,
                    });
                }
                break;
            }
            case "close": {
                const appProxy = this.appProxies.get(payload.appId);
                if (appProxy) {
                    appProxy.destroy(false, true, payload.error);
                }
                break;
            }
            case "boxStateChange": {
                this.dispatchInternalEvent(Events.AppBoxStateChange, payload);
                break;
            }
            default:
                break;
        }
    };

    public focusByAttributes(apps: any) {
        if (apps && Object.keys(apps).length === this.boxManager?.boxSize) {
            const focusAppId = this.store.focus;
            if (focusAppId) {
                this.boxManager.focusBox({ appId: focusAppId });
            }
        }
    }

    public async onReconnected() {
        const appProxies = Array.from(this.appProxies.values());
        const reconnected = appProxies.map(appProxy => {
            return appProxy.onReconnected();
        });
        this.mainViewProxy.onReconnect();
        await Promise.all(reconnected);
    }

    public notifyContainerRectUpdate(rect: TeleBoxRect) {
        this.appProxies.forEach(appProxy => {
            appProxy.appEmitter.emit("containerRectUpdate", rect);
        });
    }

    public dispatchInternalEvent(event: Events, payload: any) {
        this.safeDispatchMagixEvent(MagixEventName, {
            eventName: event,
            payload: payload,
        });
    }

    public destroy() {
        this.displayer.callbacks.off(this.eventName, this.displayerStateListener);
        this.displayer.callbacks.off("onEnableWriteNowChanged", this.displayerWritableListener);
        this.appListeners.removeListeners();
        emitter.offAny(this.boxEventListener);
        emitter.clearListeners();
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
