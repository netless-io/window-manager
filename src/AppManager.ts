import pRetry from "p-retry";
import {
    AppAttributes,
    AppStatus,
    Events,
    MagixEventName
    } from "./constants";
import { AppListeners } from "./AppListener";
import { AppProxy } from "./AppProxy";
import { AttributesDelegate } from "./AttributesDelegate";
import {
    autorun,
    isPlayer,
    isRoom,
    ScenePathType,
    ViewVisionMode
    } from "white-web-sdk";
import { BoxManager } from "./BoxManager";
import { callbacks, emitter } from "./index";
import { CameraStore } from "./Utils/CameraStore";
import { genAppId, makeValidScenePath, setScenePath } from "./Utils/Common";
import { log } from "./Utils/log";
import { MainViewProxy } from "./MainView";
import { onObjectRemoved, safeListenPropsUpdated } from "./Utils/Reactive";
import { ReconnectRefresher } from "./ReconnectRefresher";
import { ViewManager } from "./ViewManager";
import type { Displayer, DisplayerState, Room } from "white-web-sdk";
import type { CreateTeleBoxManagerConfig } from "./BoxManager";
import type {
    AddAppParams,
    BaseInsertParams,
    WindowManager,
    TeleBoxRect,
    EmitterEvent,
} from "./index";
export class AppManager {
    public displayer: Displayer;
    public boxManager: BoxManager;
    public cameraStore: CameraStore;
    public viewManager: ViewManager;
    public appProxies: Map<string, AppProxy> = new Map();
    public appStatus: Map<string, AppStatus> = new Map();
    public store = new AttributesDelegate(this);
    public mainViewProxy: MainViewProxy;
    public refresher?: ReconnectRefresher;
    public isReplay = this.windowManger.isReplay;

    private appListeners: AppListeners;

    constructor(public windowManger: WindowManager, options: CreateTeleBoxManagerConfig) {
        this.displayer = windowManger.displayer;
        this.cameraStore = new CameraStore();
        this.mainViewProxy = new MainViewProxy(this);
        this.viewManager = new ViewManager(this);
        this.boxManager = new BoxManager(this, options);
        this.appListeners = new AppListeners(this);
        this.displayer.callbacks.on(this.eventName, this.displayerStateListener);
        this.appListeners.addListeners();

        this.refresher = new ReconnectRefresher(this.room, this);

        emitter.once("onCreated").then(() => this.onCreated());

        if (isPlayer(this.displayer)) {
            emitter.on("seek", time => {
                this.appProxies.forEach(appProxy => {
                    appProxy.onSeek(time);
                });
                this.attributesUpdateCallback(this.attributes.apps);
                this.onAppDelete(this.attributes.apps);
            });
        }
    }

    private async onCreated() {
        await this.attributesUpdateCallback(this.attributes.apps);
        this.boxManager.updateManagerRect();
        emitter.onAny(this.boxEventListener);
        this.refresher?.add("apps", () => {
            return safeListenPropsUpdated(() => this.attributes.apps, () => {
                this.attributesUpdateCallback(this.attributes.apps);
            });
        });
        this.refresher?.add("appsClose", () => {
            return onObjectRemoved(this.attributes.apps, () => {
                this.onAppDelete(this.attributes.apps);
            });
        });
        this.refresher?.add("maximized", () => {
            return autorun(() => {
                const maximized = this.attributes.maximized;
                if (this.boxManager.maximized !== maximized) {
                    this.boxManager.setMaximized(Boolean(maximized));
                }
            });
        });
        this.refresher?.add("minimized", () => {
            return autorun(() => {
                const minimized = this.attributes.minimized;
                if (this.boxManager.minimized !== minimized) {
                    if (minimized === true && this.store.focus !== undefined) {
                        this.store.cleanFocus();
                        this.boxManager.blurFocusBox();
                    }
                    this.boxManager.setMinimized(Boolean(minimized));
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
    }

    /**
     * 插件更新 attributes 时的回调
     *
     * @param {*} attributes
     * @memberof WindowManager
     */
    public async attributesUpdateCallback(apps: any) {
        if (apps) {
            for (const id in apps) {
                if (!this.appProxies.has(id) && !this.appStatus.has(id)) {
                    const app = apps[id];

                    pRetry(async () => {
                        this.appStatus.set(id, AppStatus.StartCreate);
                        // 防御 appAttributes 有可能为 undefined 的情况，这里做一个重试
                        const appAttributes = this.attributes[id];
                        if (!appAttributes) {
                            throw new Error("appAttributes is undefined");
                        }
                        await this.baseInsertApp(
                            {
                                kind: app.kind,
                                options: app.options,
                                isDynamicPPT: app.isDynamicPPT,
                            },
                            id,
                            false
                        );
                        this.focusByAttributes(apps);
                    }, { retries: 3 }).catch(err => {
                        console.warn(`[WindowManager]: Insert App Error`, err);
                        this.appStatus.delete(id);
                    });
                }
            }
        }
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
            this.store.setMainViewFocusPath();
        }
        if (this.store.focus === undefined && mainView.mode !== ViewVisionMode.Writable) {
            this.viewManager.switchMainViewToWriter();
        }
        this.mainViewProxy.addMainViewListener();
        emitter.emit("mainViewMounted");
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
        const needFocus = !this.boxManager.minimized;
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
        }
        if (this.boxManager.minimized) {
            this.boxManager.setMinimized(false, false);
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
        if (state.roomMembers) {
            this.windowManger.cursorManager?.setRoomMembers(state.roomMembers);
            this.windowManger.cursorManager?.cleanMemberAttributes(state.roomMembers);
        }
        this.appProxies.forEach(appProxy => {
            appProxy.appEmitter.emit("roomStateChange", state);
        });
        emitter.emit("observerIdChange", this.displayer.observerId);
    };

    private displayerWritableListener = (isReadonly: boolean) => {
        const isWritable = !isReadonly;
        const isManualWritable =
            this.windowManger.readonly === undefined || this.windowManger.readonly === false;
        if (this.windowManger.readonly === undefined) {
            this.boxManager.setReadonly(isReadonly);
        } else {
            this.boxManager.setReadonly(!(isWritable && isManualWritable));
        }
        this.appProxies.forEach(appProxy => {
            appProxy.emitAppIsWritableChange();
        });
        if (isWritable === true) {
            if (!this.store.focus) {
                this.mainViewProxy.switchViewModeToWriter();
            }
            this.mainView.disableCameraTransform = false;
        } else {
            this.mainView.disableCameraTransform = true;
        }
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

    public safeSetAttributes(attributes: any) {
        this.windowManger.safeSetAttributes(attributes);
    }

    public safeUpdateAttributes(keys: string[], value: any) {
        this.windowManger.safeUpdateAttributes(keys, value);
    }

    public async setMainViewScenePath(scenePath: string) {
        if (this.room) {
            const scenePathType = this.displayer.scenePathType(scenePath);
            if (scenePathType === ScenePathType.None) {
                throw new Error(`[WindowManager]: ${scenePath} not valid scene`);
            } else if (scenePathType === ScenePathType.Page) {
                await this._setMainViewScenePath(scenePath);
            } else if (scenePathType === ScenePathType.Dir) {
                const validScenePath = makeValidScenePath(this.displayer, scenePath);
                await this._setMainViewScenePath(validScenePath);
            }
        }
    }

    private async _setMainViewScenePath(scenePath: string) {
        this.safeSetAttributes({ _mainScenePath: scenePath });
        await this.viewManager.switchMainViewToWriter();
        setScenePath(this.room, scenePath);
        this.store.setMainViewFocusPath();
        this.dispatchInternalEvent(Events.SetMainViewScenePath, { nextScenePath: scenePath });
    }

    public async setMainViewSceneIndex(index: number) {
        if (this.room) {
            this.safeSetAttributes({ _mainSceneIndex: index });
            await this.viewManager.switchMainViewToWriter();
            this.room.setSceneIndex(index);
            const nextScenePath = this.room.state.sceneState.scenePath;
            this.store.setMainViewScenePath(nextScenePath);
            this.store.setMainViewFocusPath();
            this.dispatchInternalEvent(Events.SetMainViewScenePath, { nextScenePath });
        }
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
                if (this.boxManager.maximized) {
                    this.boxManager.focusTopBox();
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
        if (apps && Object.keys(apps).length === this.boxManager.appBoxMap.size) {
            const focusAppId = this.store.focus;
            if (focusAppId) {
                this.boxManager.focusBox({ appId: focusAppId });
            }
        }
    }

    public async notifyReconnected() {
        const appProxies = Array.from(this.appProxies.values());
        const reconnected = appProxies.map(appProxy => {
            return appProxy.onReconnected();
        });
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
        this.viewManager.destroy();
        this.boxManager.destroy();
        this.refresher?.destroy();
        this.mainViewProxy.destroy();
        callbacks.clearListeners();
    }
}
