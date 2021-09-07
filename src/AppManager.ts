import { AppAttributes, AppStatus, Events, MagixEventName } from "./constants";
import { AppListeners } from "./AppListener";
import { AppProxy } from "./AppProxy";
import { appRegister } from "./Register";
import { AttributesDelegate, Fields } from "./AttributesDelegate";
import { BoxManager, TELE_BOX_STATE } from "./BoxManager";
import { callbacks, emitter } from "./index";
import { CameraStore } from "./CameraStore";
import { genAppId, makeValidScenePath } from "./Common";
import { isRoom, reaction, ScenePathType } from "white-web-sdk";
import { log } from "./log";
import { MainViewProxy } from "./MainView";
import { ViewManager } from "./ViewManager";
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
    public delegate = new AttributesDelegate(this);
    public mainViewProxy = new MainViewProxy(this);

    private appListeners: AppListeners;
    private reactionDisposers: any[] = [];

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
        this.displayerWritableListener(!this.room?.isWritable);
        this.displayer.callbacks.on("onEnableWriteNowChanged", this.displayerWritableListener);
        this.appListeners.addListeners();

        emitter.once("onCreated").then(async () => {
            await this.attributesUpdateCallback(this.attributes.apps);
            emitter.onAny(this.boxEventListener);
            this.reactionDisposers.push(
                reaction(
                    () => Object.keys(this.attributes?.apps || {}).length,
                    () => {
                        this.attributesUpdateCallback(this.attributes.apps);
                    }
                )
            );
            this.reactionDisposers.push(
                reaction(
                    () => this.attributes[Fields.MainViewCamera],
                    camera => {
                        if (this.delegate.broadcaster !== this.displayer.observerId && camera) {
                            this.mainViewProxy.moveCamera(camera);
                        }
                    },
                    {
                        fireImmediately: true,
                    }
                )
            );
            this.reactionDisposers.push(
                reaction(
                    () => this.attributes[Fields.MainViewSize],
                    size => {
                        if (this.delegate.broadcaster !== this.displayer.observerId && size) {
                            this.mainViewProxy.moveCameraToContian(size);
                            this.mainViewProxy.moveCamera(this.delegate.getMainViewCamera());
                        }
                    },
                    {
                        fireImmediately: true,
                    }
                )
            );
            if (!this.attributes.apps || Object.keys(this.attributes.apps).length === 0) {
                const mainScenePath = this.delegate.getMainViewScenePath();
                if (!mainScenePath) return;
                const sceneState = this.displayer.state.sceneState;
                if (sceneState.scenePath !== mainScenePath) {
                    this.room?.setScenePath(mainScenePath);
                }
            }
        });
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
                    let appImpl = app.src;
                    if (!appImpl) {
                        appImpl = appRegister.appClasses.get(app.kind);
                    }
                    await this.baseInsertApp(
                        {
                            kind: app.kind,
                            src: appImpl,
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

    public async addApp(params: AddAppParams, isDynamicPPT: boolean): Promise<string | undefined> {
        log("addApp", params);
        const { appId, needFocus } = this.beforeAddApp(params, isDynamicPPT);
        const appProxy = await this.baseInsertApp(params, appId, true, needFocus);
        this.afterAddApp(appProxy);
        return appProxy?.id;
    }

    private beforeAddApp(params: AddAppParams, isDynamicPPT: boolean) {
        const appId = genAppId(params.kind);
        this.appStatus.set(appId, AppStatus.StartCreate);
        this.delegate.setupAppAttributes(params, appId, isDynamicPPT);
        if (this.boxManager.boxState === TELE_BOX_STATE.Minimized) {
            this.boxManager.teleBoxManager.setState(TELE_BOX_STATE.Normal);
        }
        const needFocus = this.boxManager.boxState !== TELE_BOX_STATE.Minimized;
        if (needFocus) {
            this.delegate.setAppFocus(appId, true);
        }
        const attrs = params.attributes ?? {};
        this.safeUpdateAttributes([appId], attrs);
        return { appId, needFocus };
    }

    private afterAddApp(appProxy: AppProxy | undefined) {
        if (appProxy) {
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
                    if (sceneState.index !== appProxy.sceneIndex) {
                        appProxy.setSceneIndex(sceneState.index);
                    }
                }
            });
            this.viewManager.refreshViews();
        }
        if (state.roomMembers) {
            this.windowManger.cursorManager?.setRoomMembers(state.roomMembers);
            this.windowManger.cursorManager?.cleanMemberAttributes(state.roomMembers);
        }
        this.appProxies.forEach(appProxy => {
            appProxy.appEmitter.emit("roomStateChange", state);
        })
    };

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
        return this.windowManger.mainView;
    }

    public safeSetAttributes(attributes: any) {
        this.windowManger.safeSetAttributes(attributes);
    }

    public safeUpdateAttributes(keys: string[], value: any) {
        this.windowManger.safeUpdateAttributes(keys, value);
    }

    public setMainViewScenePath(scenePath: string) {
        if (this.room) {
            const scenePathType = this.displayer.scenePathType(scenePath);
            if (scenePathType === ScenePathType.None) {
                throw new Error(`${scenePath} not valid scene`);
            } else if (scenePathType === ScenePathType.Page) {
                this._setMainViewScenePath(scenePath);
            } else if (scenePathType === ScenePathType.Dir) {
                const validScenePath = makeValidScenePath(this.displayer, scenePath);
                this._setMainViewScenePath(validScenePath);
            }
        }
    }

    private _setMainViewScenePath(scenePath: string) {
        this.safeSetAttributes({ _mainScenePath: scenePath });
        this.viewManager.freedomAllViews();
        this.viewManager.switchMainViewToWriter();
        this.delegate.setMainViewFocusPath();
    }

    public setMainViewSceneIndex(index: number) {
        if (this.room) {
            this.safeSetAttributes({ _mainSceneIndex: index });
            this.viewManager.freedomAllViews();
            this.viewManager.switchMainViewToWriter();
            this.room.setSceneIndex(index);
            this.delegate.setMainViewScenePath(this.room.state.sceneState.scenePath);
            this.delegate.setMainViewFocusPath();
        }
    }

    public getAppInitPath(appId: string): string | undefined {
        const attrs = this.delegate.getAppAttributes(appId);
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
                this.delegate.updateAppState(payload.appId, AppAttributes.Position, {
                    x: payload.x,
                    y: payload.y,
                });
                break;
            }
            case "focus": {
                this.windowManger.safeSetAttributes({ focus: payload.appId });
                const appProxy = this.appProxies.get(payload.appId);
                if (appProxy?.scenePath) {
                    this.dispatchInternalEvent(Events.SwitchViewsToFreedom, {});
                    this.viewManager.switchAppToWriter(payload.appId);
                }
                this.dispatchInternalEvent(Events.AppFocus, payload);
                break;
            }
            case "blur": {
                this.dispatchInternalEvent(Events.AppBlur, payload);
                break;
            }
            case "resize": {
                if (payload.width && payload.height) {
                    this.dispatchInternalEvent(Events.AppResize, payload);
                    this.delegate.updateAppState(payload.appId, AppAttributes.Size, {
                        width: payload.width,
                        height: payload.height,
                    });
                    this.room?.refreshViewSize();
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

                this.delegate.cleanFocus();
                this.boxManager.blurFocusBox();
                this.viewManager.freedomAllViews();
                this.viewManager.switchMainViewToWriter();
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

                this.delegate.updateAppState(payload.appId, AppAttributes.SnapshotRect, {
                    ...payload.rect,
                });
                break;
            }
            case "close": {
                this.safeDispatchMagixEvent(MagixEventName, {
                    eventName: Events.AppClose,
                    payload,
                });
                const appProxy = this.appProxies.get(payload.appId);
                if (appProxy) {
                    appProxy.destroy(false, true, payload.error);
                }
                setTimeout(() => {
                    this.viewManager.refreshViews();
                }, 100);
                break;
            }
            default:
                break;
        }
    };

    public focusByAttributes(apps: any) {
        if (apps && Object.keys(apps).length === this.boxManager.appBoxMap.size) {
            const focusAppId = this.delegate.focus;
            if (focusAppId) {
                this.boxManager.focusBox({ appId: focusAppId });
            }
        }
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
        if (this.reactionDisposers.length) {
            this.reactionDisposers.map(disposer => disposer());
            this.reactionDisposers = [];
        }
        if (this.appProxies.size) {
            this.appProxies.forEach(appProxy => {
                appProxy.destroy(true, false);
            });
        }
        this.viewManager.destroy();
        callbacks.clearListeners();
    }
}
