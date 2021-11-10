import {
    AppAttributes,
    AppStatus,
    Events,
    MagixEventName
    } from './constants';
import { AppListeners } from './AppListener';
import { AppProxy } from './AppProxy';
import { AttributesDelegate } from './AttributesDelegate';
import { BoxManager, TELE_BOX_STATE } from './BoxManager';
import { callbacks, emitter } from './index';
import { CameraStore } from './Utils/CameraStore';
import { genAppId, makeValidScenePath, setScenePath } from './Utils/Common';
import {
    isPlayer,
    isRoom,
    ScenePathType
    } from 'white-web-sdk';
import { log } from './Utils/log';
import { MainViewProxy } from './MainView';
import { onObjectInserted, onObjectRemoved } from './Utils/Reactive';
import { ReconnectRefresher } from './ReconnectRefresher';
import { ViewManager } from './ViewManager';
import type { Displayer, DisplayerState, Room } from "white-web-sdk";
import type { CreateCollectorConfig } from "./BoxManager";
import type { AddAppParams, BaseInsertParams, WindowManager } from "./index";
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

    private appListeners: AppListeners;


    constructor(public windowManger: WindowManager, options: CreateCollectorConfig) {
        this.displayer = windowManger.displayer;
        this.cameraStore = new CameraStore();
        this.viewManager = new ViewManager(this.displayer as Room, this, this.cameraStore);
        this.boxManager = new BoxManager(this, this.viewManager.mainView, this.appProxies, options);
        this.appListeners = new AppListeners(
            this,
            this.windowManger,
            this.viewManager,
            this.appProxies
        );
        this.displayer.callbacks.on(this.eventName, this.displayerStateListener);
        this.appListeners.addListeners();

        this.refresher = new ReconnectRefresher(this.room, this);

        this.mainViewProxy = new MainViewProxy(this);

        emitter.once("onCreated").then(() => this.onCreated());

        if (isPlayer(this.displayer)) {
            emitter.on("seek", time => {
                this.appProxies.forEach(appProxy => {
                    appProxy.appEmitter.emit("seek", time);
                    appProxy.onSeek();
                });
                this.attributesUpdateCallback(this.attributes.apps);
            });
        }
    }

    private async onCreated() {
        await this.attributesUpdateCallback(this.attributes.apps);
        emitter.onAny(this.boxEventListener);
        this.refresher?.add("apps", () => {
            return onObjectInserted(this.attributes.apps, () => {
                this.attributesUpdateCallback(this.attributes.apps);
            });
        });
        this.refresher?.add("appsClose", () => {
            return onObjectRemoved(this.attributes.apps, () => {
                this.onAppDelete(this.attributes.apps);
            });
        });
        if (!this.attributes.apps || Object.keys(this.attributes.apps).length === 0) {
            const mainScenePath = this.store.getMainViewScenePath();
            if (!mainScenePath) return;
            const sceneState = this.displayer.state.sceneState;
            if (sceneState.scenePath !== mainScenePath) {
                this.room?.setScenePath(mainScenePath);
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
                }
            }
        }
    }

    private onAppDelete = (apps: any) => {
        const ids = Object.keys(apps);
        this.appProxies.forEach((appProxy, id) => {
            if (!ids.includes(id)) {
                appProxy.destroy(true, false);
            }
        });
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
        this.store.setupAppAttributes(params, appId, isDynamicPPT);
        if (this.boxManager.boxState === TELE_BOX_STATE.Minimized) {
            this.boxManager.teleBoxManager.setState(TELE_BOX_STATE.Normal);
        }
        const needFocus = this.boxManager.boxState !== TELE_BOX_STATE.Minimized;
        if (needFocus) {
            this.store.setAppFocus(appId, true);
        }
        const attrs = params.attributes ?? {};
        this.safeUpdateAttributes([appId], attrs);
        return { appId, needFocus };
    }

    private afterAddApp(appProxy: AppProxy | undefined) {
        if (appProxy && appProxy.box) {
            emitter.emit("move", {
                appId: appProxy.id,
                x: appProxy.box?.x,
                y: appProxy.box?.y,
            });
        }
    }

    public async closeApp(appId: string) {
        const appProxy = this.appProxies.get(appId);
        if (appProxy) {
            appProxy.destroy(true, true);
        }
    }

    private async baseInsertApp(
        params: BaseInsertParams,
        appId: string,
        isAddApp: boolean,
        focus?: boolean
    ) {
        this.appStatus.set(appId, AppStatus.StartCreate);
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
    }

    private displayerWritableListener = (isReadonly: boolean) => {
        const isWritable = !isReadonly;
        const isManualWritable =
            this.windowManger.readonly === undefined || this.windowManger.readonly === false;
        if (this.windowManger.readonly === undefined) {
            this.boxManager.teleBoxManager.setReadonly(isReadonly);
        } else {
            this.boxManager.teleBoxManager.setReadonly(!(isWritable && isManualWritable));
        }
        this.appProxies.forEach(appProxy => {
            appProxy.emitAppIsWritableChange();
        });
        if (isWritable === true) {
            if (!this.store.focus) {
                this.viewManager.switchMainViewModeToWriter();
            }
            this.mainView.disableCameraTransform = false;
        } else {
            this.mainView.disableCameraTransform = true;
        }
    }

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
        return this.windowManger.mainView;
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
    }

    public async setMainViewSceneIndex(index: number) {
        if (this.room) {
            this.safeSetAttributes({ _mainSceneIndex: index });
            await this.viewManager.switchMainViewToWriter();
            this.room.setSceneIndex(index);
            this.store.setMainViewScenePath(this.room.state.sceneState.scenePath);
            this.store.setMainViewFocusPath();
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

    private boxEventListener = (eventName: string | number, payload: any) => {
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
            case "blur": {
                this.dispatchInternalEvent(Events.AppBlur, payload);
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
            case TELE_BOX_STATE.Minimized: {
                this.safeDispatchMagixEvent(MagixEventName, {
                    eventName: Events.AppBoxStateChange,
                    payload: {
                        ...payload,
                        state: eventName,
                    },
                });
                this.safeSetAttributes({ boxState: eventName });

                this.store.cleanFocus();
                this.boxManager.blurFocusBox();
                break;
            }
            case TELE_BOX_STATE.Maximized: {
                this.safeDispatchMagixEvent(MagixEventName, {
                    eventName: Events.AppBoxStateChange,
                    payload: {
                        ...payload,
                        state: eventName,
                    },
                });
                const topBox = this.boxManager.getTopBox();
                if (topBox) {
                    emitter.emit("focus", { appId: topBox.id });
                }
                this.safeSetAttributes({ boxState: eventName });
                break;
            }
            case TELE_BOX_STATE.Normal: {
                this.safeDispatchMagixEvent(MagixEventName, {
                    eventName: Events.AppBoxStateChange,
                    payload: {
                        ...payload,
                        state: eventName,
                    },
                });
                this.safeSetAttributes({ boxState: eventName });
                break;
            }
            case "snapshot": {
                this.safeDispatchMagixEvent(MagixEventName, {
                    eventName: Events.AppSnapshot,
                    payload,
                });

                this.store.updateAppState(payload.appId, AppAttributes.SnapshotRect, {
                    ...payload.rect,
                });
                break;
            }
            case "close": {
                const appProxy = this.appProxies.get(payload.appId);
                if (appProxy) {
                    appProxy.destroy(false, true, payload.error);
                }
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

    public notifyReconnected() {
        this.appProxies.forEach(appProxy => {
            appProxy.appEmitter.emit("reconnected", undefined);
        })
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
                appProxy.destroy(true, false);
            });
        }
        this.viewManager.destroy();
        this.refresher?.destroy();
        callbacks.clearListeners();
    }
}
