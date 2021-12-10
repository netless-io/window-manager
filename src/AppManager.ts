import pRetry from "p-retry";
import { AppListeners } from "./AppListener";
import { AppStatus, MagixEventName } from "./constants";
import { AttributesDelegate } from "./AttributesDelegate";
import { autorun, isPlayer, isRoom, reaction, ScenePathType } from "white-web-sdk";
import { BoxEventHandler } from "./BoxEventHandler";
import { BoxManager } from "./BoxManager";
import { callbacks, emitter } from "./index";
import { Creator, initCreator } from "./App";
import { DisplayerListener } from "./DisplayerListener";
import { MainViewProxy } from "./MainView";
import { makeValidScenePath, setViewFocusScenePath } from "./Utils/Common";
import { onObjectRemoved } from "./Utils/Reactive";
import { ReconnectRefresher } from "./ReconnectRefresher";
import { SideEffectManager } from "side-effect-manager";
import { ViewManager } from "./ViewManager";
import type { AppProxy, AppProxyContext } from "./App";
import type { Events, AppAttributes } from "./constants";
import type { Displayer, Room } from "white-web-sdk";
import type { CreateCollectorConfig } from "./BoxManager";
import type { WindowManager, TeleBoxRect } from "./index";

export class AppManager {
    public displayer: Displayer;
    public boxManager: BoxManager;
    public viewManager: ViewManager;
    public store = new AttributesDelegate({
        attributes: () => this.attributes,
        safeSetAttributes: (attributes: any) => this.safeSetAttributes(attributes),
        safeUpdateAttributes: (keys: string[], value: any) =>
            this.safeUpdateAttributes(keys, value),
    });
    public mainViewProxy: MainViewProxy;
    public isReplay = this.windowManger.isReplay;
    public refresher?: ReconnectRefresher;

    public appProxies: Map<string, AppProxy> = new Map();
    public appStatus: Map<string, AppStatus> = new Map();

    private appListeners: AppListeners;
    private displayerListener: DisplayerListener;

    private sideEffectManager = new SideEffectManager();

    constructor(public windowManger: WindowManager, options: CreateCollectorConfig) {
        this.displayer = windowManger.displayer;
        this.viewManager = new ViewManager(this.displayer);
        this.mainViewProxy = new MainViewProxy(this);
        this.boxManager = new BoxManager(
            {
                mainView: () => this.mainView,
                canOperate: () => this.canOperate,
                safeSetAttributes: (attributes: any) => this.safeSetAttributes(attributes),
                notifyContainerRectUpdate: rect => this.notifyContainerRectUpdate(rect),
            },
            options
        );
        this.appListeners = new AppListeners(this);

        initCreator(this);

        this.sideEffectManager.add(() => {
            this.appListeners.addListeners();
            return () => {
                this.appListeners.removeListeners();
            };
        });

        this.sideEffectManager.add(() => {
            const boxEventHandler = new BoxEventHandler({
                emitter,
                updateAppState: this.store.updateAppState,
                safeSetAttributes: (attributes: any) => this.safeSetAttributes(attributes),
                closeApp: (appId: string, error?: Error) => {
                    const appProxy = this.appProxies.get(appId);
                    appProxy?.destroy(false, true, error);
                },
                dispatchMagixEvent: (event: Events, payload: any) => {
                    this.dispatchInternalEvent(event, payload);
                },
            });
            return () => boxEventHandler.destroy();
        });

        this.refresher = new ReconnectRefresher(this.room, () => this.notifyReconnected());

        this.displayerListener = new DisplayerListener(this.displayer);

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
        emitter.emit("updateManagerRect", undefined);
        this.refresher?.add("apps", () => {
            return autorun(() => {
                const apps = this.attributes.apps;
                //新版非 Active View 两边同时创建 View 会有报错, 这里加一个延迟保证不会报错
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
                this.focusHandler(focus);
            });
        });
        this.displayerWritableListener(!this.room?.isWritable);
        this.sideEffectManager.add(() => {
            this.displayer.callbacks.on("onEnableWriteNowChanged", this.displayerWritableListener);
            return () => {
                this.displayer.callbacks.off(
                    "onEnableWriteNowChanged",
                    this.displayerWritableListener
                );
            };
        });

        emitter.on("roomStateChange", state => {
            this.appProxies.forEach(appProxy => {
                appProxy.appEmitter.emit("roomStateChange", state);
            });
        });
    }

    private focusHandler(focus: string) {
        if (focus) {
            const appProxy = this.appProxies.get(focus);
            if (appProxy) {
                appProxy.focus();
            }
        }
    }

    /**
     * 插件更新 attributes 时的回调
     *
     * @param {*} attributes
     * @memberof WindowManager
     */
    private async attributesUpdateCallback(apps: any) {
        if (apps) {
            for (const id in apps) {
                if (!this.appProxies.has(id) && !this.appStatus.has(id)) {
                    const app = apps[id];

                    pRetry(
                        async () => {
                            this.appStatus.set(id, AppStatus.StartCreate);
                            // 防御 appAttributes 有可能为 undefined 的情况，这里做一个重试
                            const appAttributes = this.attributes[id];
                            if (!appAttributes) {
                                throw new Error("appAttributes is undefined");
                            }
                            await Creator.createByAppId(
                                {
                                    kind: app.kind,
                                    options: app.options,
                                    isDynamicPPT: app.isDynamicPPT,
                                    isAddApp: false,
                                },
                                id
                            );
                        },
                        { retries: 3 }
                    ).catch(err => {
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
                appProxy.destroy(true, false);
            }
        });
    };

    public bindMainView(divElement: HTMLDivElement, disableCameraTransform: boolean) {
        const mainView = this.mainViewProxy.createMainView();
        mainView.disableCameraTransform = disableCameraTransform;
        mainView.divElement = divElement;
        if (!mainView.focusScenePath) {
            this.setMainViewFocusPath();
        }
        emitter.emit("mainViewMounted");
    }

    // TODO 状态中保存一个 SceneName 优化性能
    public setMainViewFocusPath() {
        const scenePath = this.store.getMainViewScenePath();
        if (scenePath) {
            setViewFocusScenePath(this.mainView, scenePath);
        }
    }

    public updateFocusApp(appId: string) {
        const needFocus = !this.boxManager.minimized;
        if (needFocus) {
            this.store.setAppFocus(appId, true);
        }
        return { appId, needFocus };
    }

    public async closeApp(appId: string) {
        const appProxy = this.appProxies.get(appId);
        if (appProxy) {
            await appProxy.destroy(true, true);
        }
    }

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
        this.setMainViewFocusPath();
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
                    sceneDir = "/";
                }
                const scenePath = makeValidScenePath(this.displayer, sceneDir, index);
                if (scenePath) {
                    this.store.setMainViewScenePath(scenePath);
                    this.setMainViewFocusPath();
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

    public notifyReconnected() {
        this.appProxies.forEach(appProxy => {
            appProxy.onReconnected();
        });
        this.mainViewProxy.onReconnected();
        this.focusHandler(this.attributes.focus);
    }

    public notifyContainerRectUpdate = (rect: TeleBoxRect) => {
        this.appProxies.forEach(appProxy => {
            appProxy.appEmitter.emit("containerRectUpdate", rect);
        });
    };

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

    public setBoxToNormal() {
        if (this.boxManager.minimized) {
            this.boxManager.setMinimized(false, false);
        }
    }

    public createAppProxyContext = (): AppProxyContext => {
        return {
            displayer: this.displayer,
            room: this.room,
            refresher: this.refresher,
            isReplay: () => this.isReplay,
            attributes: () => this.attributes,
            canOperate: () => this.canOperate,
            focus: () => this.attributes.focus,
            setProxy: (id: string, AppProxy: AppProxy) => this.appProxies.set(id, AppProxy),
            getAppState: (id: string) => this.store.getAppState(id),
            updateAppState: (appId: string, stateName: AppAttributes, state: any) =>
                this.store.updateAppState(appId, stateName, state),
            getAppInitPath: (appId: string) => this.getAppInitPath(appId),
            deleteStatus: (id: string) => this.appStatus.delete(id),
            deleteProxy: id => this.appProxies.delete(id),
            ...this.createViewsHelper(),
            ...this.createAttributesHelper(),
        };
    };

    public createAttributesHelper = () => {
        return {
            safeSetAttributes: (attributes: any) => this.safeSetAttributes(attributes),
            safeUpdateAttributes: (keys: string[], value: any) => this.safeUpdateAttributes(keys, value),
            getAppAttributes: (id: string) => this.store.getAppAttributes(id),
            cleanAppAttributes: (id: string) => this.store.cleanAppAttributes(id),
        }
    }

    public createViewsHelper = () => {
        return {
            getView: (id: string) => this.viewManager.getView(id),
            createView: (id: string) => this.viewManager.createView(id),
            destroyView: (id: string) => this.viewManager.destroyView(id),
        }
    }

    public destroy() {
        emitter.clearListeners();
        if (this.appProxies.size) {
            this.appProxies.forEach(appProxy => {
                appProxy.destroy(true, false);
            });
        }
        this.boxManager.destroy();
        this.refresher?.destroy();
        this.mainViewProxy.destroy();
        this.displayerListener.destroy();
        callbacks.clearListeners();
        this.sideEffectManager.flushAll();
    }
}
