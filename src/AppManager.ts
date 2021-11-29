import { AppAttributes, AppStatus, Events, MagixEventName } from "./constants";
import { AppListeners } from "./AppListener";
import { AppProxy } from "./AppProxy";
import { AttributesDelegate } from "./AttributesDelegate";
import { autorun, isPlayer, isRoom, reaction, ScenePathType } from "white-web-sdk";
import { BoxManager } from "./BoxManager";
import { callbacks, emitter } from "./index";
import { genAppId, makeValidScenePath } from "./Utils/Common";
import { log } from "./Utils/log";
import { MainViewProxy } from "./MainView";
import { ViewManager } from "./ViewManager";
import { onObjectRemoved } from "./Utils/Reactive";
import { ReconnectRefresher } from "./ReconnectRefresher";
import type { Displayer, DisplayerState, Room, Player } from "white-web-sdk";
import type { CreateCollectorConfig } from "./BoxManager";
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
    public viewManager: ViewManager;
    public store = new AttributesDelegate(this);
    public mainViewProxy: MainViewProxy;
    public refresher?: ReconnectRefresher;
    public isReplay = this.windowManger.isReplay;

    public appProxies: Map<string, AppProxy> = new Map();
    public appStatus: Map<string, AppStatus> = new Map();

    private appListeners: AppListeners;

    constructor(public windowManger: WindowManager, options: CreateCollectorConfig) {
        this.displayer = windowManger.displayer;
        this.viewManager = new ViewManager(this.displayer);
        this.mainViewProxy = new MainViewProxy(this);
        this.boxManager = new BoxManager(this, options);
        this.appListeners = new AppListeners(this);

        if (isRoom(this.displayer)) {
            (this.displayer as Room).callbacks.on(
                "onRoomStateChanged",
                this.displayerStateListener
            );
        } else if (isPlayer(this.displayer)) {
            (this.displayer as Player).callbacks.on(
                "onPlayerStateChanged",
                this.displayerStateListener
            );
        }

        this.appListeners.addListeners();

        this.refresher = new ReconnectRefresher(this.room, () => this.notifyReconnected());

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
            return autorun(() => {
                const apps = this.attributes.apps;
                setTimeout(() => {
                    this.attributesUpdateCallback(apps);
                }, 300);
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
        this.refresher?.add("focus", () => {
            return autorun(() => {
                const focus = this.attributes.focus;
                if (focus) {
                    const appProxy = this.appProxies.get(focus);
                    if (appProxy) {
                        appProxy.focus();
                    }
                }
            });
        });
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
    };

    public bindMainView(divElement: HTMLDivElement, disableCameraTransform: boolean) {
        const mainView = this.mainViewProxy.createMainView();
        mainView.disableCameraTransform = disableCameraTransform;
        mainView.divElement = divElement;
        if (!mainView.focusScenePath) {
            this.store.setMainViewFocusPath();
        }
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
        if (this.boxManager.minimized) {
            this.boxManager.setMinimized(false);
        }
        const needFocus = !this.boxManager.minimized;
        if (needFocus) {
            this.store.setAppFocus(appId, true);
        }
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
            this.mainView.disableCameraTransform = false;
        } else {
            this.mainView.disableCameraTransform = true;
        }
    };

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
                if (validScenePath) {
                    await this._setMainViewScenePath(validScenePath);
                }
            }
        }
    }

    private async _setMainViewScenePath(scenePath: string) {
        this.safeSetAttributes({ _mainScenePath: scenePath });
        this.store.setMainViewFocusPath();
    }

    public async setMainViewSceneIndex(index: number) {
        if (this.room) {
            this.safeSetAttributes({ _mainSceneIndex: index });
            const mainViewScenePath = this.store.getMainViewScenePath() as string;
            if (mainViewScenePath) {
                const sceneList = mainViewScenePath.split("/");
                sceneList.pop();
                let sceneDir = sceneList.join("/");
                if (sceneDir === "") {
                    sceneDir  = "/";
                }
                const scenePath = makeValidScenePath(this.displayer, sceneDir, index);
                if (scenePath) {
                    this.store.setMainViewScenePath(scenePath);
                    this.store.setMainViewFocusPath();
                }
            }
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

    public notifyReconnected() {
        this.appProxies.forEach(appProxy => {
            appProxy.onReconnected();
        });
        this.mainViewProxy.onReconnected();
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

    public addReaction<T>(id: string, expression: () => T, callback: (result: T) => void) {
        this.refresher?.add(id, () => {
            return reaction(expression, callback, { fireImmediately: true });
        });
    }

    public destroy() {
        if (isRoom(this.displayer)) {
            (this.displayer as Room).callbacks.off(
                "onRoomStateChanged",
                this.displayerStateListener
            );
        } else if (isPlayer(this.displayer)) {
            (this.displayer as Player).callbacks.off(
                "onPlayerStateChanged",
                this.displayerStateListener
            );
        }
        this.displayer.callbacks.off("onEnableWriteNowChanged", this.displayerWritableListener);
        this.appListeners.removeListeners();
        emitter.offAny(this.boxEventListener);
        emitter.clearListeners();
        if (this.appProxies.size) {
            this.appProxies.forEach(appProxy => {
                appProxy.destroy(true, false);
            });
        }
        this.boxManager.destroy();
        this.refresher?.destroy();
        this.mainViewProxy.destroy();
        callbacks.clearListeners();
    }
}
