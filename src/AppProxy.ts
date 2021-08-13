import Emittery from 'emittery';
import get from 'lodash.get';
import { autorun, SceneState } from "white-web-sdk";
import {
    AddAppOptions,
    AddAppParams,
    emitter,
    AppEmitterEvent,
    AppInitState,
    AppListenerKeys,
    AppSyncAttributes,
    setAppOptions,
    WindowManager
    } from './index';
import { BoxManager } from './BoxManager';
import { Events, AppAttributes, AppEvents } from './constants';
import { log } from './log';
import { AppContext } from './AppContext';
import { App } from "./typings";
import { loadApp } from './loader';
import { AppCreateError } from './error';

export class AppProxy {
    private id: string;
    public appEmitter: Emittery<AppEmitterEvent>;
    private appListener: any;
    private disposer: any;
    public scenePath?: string;

    constructor(
        private params: AddAppParams,
        private manager: WindowManager,
        private boxManager: BoxManager,
    ) {
        this.id = AppProxy.genId(params.kind, params.options);
        if (this.manager.appProxies.has(this.id)) {
            throw new AppCreateError();
        }
        this.manager.appProxies.set(this.id, this);
        this.appEmitter = new Emittery();
        this.appListener = this.makeAppEventListener(this.id);
        this.scenePath = this.params.options?.scenePath;
    }

    public static genId(kind: string, options?: AddAppOptions) {
        if (options && options.scenePath) {
            return `${kind}-${options.scenePath}`;
        } else {
            return kind;
        }
    }

    public setupAttributes(appAttrs: any): void {
        const params = this.params;
        const attributes = this.manager.attributes;
        if (!attributes.apps) {
            this.manager.safeSetAttributes({ apps: {} });
        }
        let attrs: AppSyncAttributes = { kind: params.kind, options: params.options };
        if (typeof params.src === "string") {
            attrs.src = params.src;
        }
        this.manager.safeUpdateAttributes(["apps", this.id], attrs);
        this.manager.safeUpdateAttributes(["apps", this.id, "state"],{
            [AppAttributes.Size]: { width: 0, height: 0 },
            [AppAttributes.Position]: { x: 0, y: 0 },
            [AppAttributes.SnapshotRect]: {},
        });
        this.manager.safeSetAttributes({ focus: this.id });
        this.manager.safeSetAttributes({ [this.id]: appAttrs });
    }

    public async baseInsertApp() {
        const params = this.params; 
        if (params.kind) {
            const appImpl = await this.getAppImpl();
            if (appImpl) {
                await this.setupApp(this.id, appImpl, params.options);
            } else {
                throw new Error(`app load failed ${params.kind} ${params.src}`);
            }
            this.boxManager.updateManagerRect();
            return {
                appId: this.id, app: appImpl
            }
        } else {
            // throw new Error("kind and app is require");
        }
    }

    private async getAppImpl() {
        const params = this.params;
        let appImpl;
        if (params.src === undefined) {
            appImpl = WindowManager.appClasses.get(params.kind);
            if (!appImpl) {
                throw new Error("app need register");
            }
        } else {
            appImpl = typeof params.src === "string" ? await loadApp(params.kind, params.src) : undefined;
        }
        return appImpl;
    }

    private async setupApp(appId: string, app: App, options?: setAppOptions) {
        log("setupApp", appId, app, options);
        const context = new AppContext(this.manager, appId, this.appEmitter);
        try {
            emitter.once(`${appId}${Events.WindowCreated}`).then(async () => {
                const boxInitState = this.getAppInitState(appId);
                this.boxManager.updateBox(boxInitState);
                this.appEmitter.onAny(this.appListener);
                this.appAttributesUpdateListener(appId);
                await app.setup(context);
                this.appEmitter.emit("create", undefined);
            });
            this.boxManager.createBox({
                appId: appId, app, options
            });
        } catch (error) {
            throw new Error(`app setup error: ${error.message}`);
        }
    }

    public getAppInitState = (id: string) => {
        const attrs = get(this.manager.attributes, ["apps", id, "state"]);
        if (!attrs) return;
        const position = attrs?.[AppAttributes.Position];
        const focus = this.manager.attributes.focus;
        const size = attrs?.[AppAttributes.Size];
        const snapshotRect = attrs?.[AppAttributes.SnapshotRect];
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
        emitter.emit(Events.InitReplay, payload);
        return payload;
    }

    public destroy(needCloseBox: boolean, error?: Error) {
        this.appEmitter.emit("destroy", { error });
        this.appEmitter.offAny(this.appListener);
        emitter.emit(`destroy-${this.id}`, { error });
        this.manager.safeUpdateAttributes(["apps", this.id], undefined);
        if (needCloseBox) {
            this.boxManager.closeBox(this.id);
            WindowManager.viewManager.destoryView(this.id);
        }

        if (this.disposer) {
            this.disposer();
        }
        this.cleanAppAttributes();
        this.manager.appProxies.delete(this.id);
    }

    public emitAppSceneStateChange(sceneState: SceneState) {
        this.appEmitter.emit("sceneStateChange", sceneState!);
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
                    this.destroy(true, data.error);
                }
                default:
                    break;
            }
        }
    }

    private appAttributesUpdateListener = (appId: string) => {
        const disposer = autorun(() => {
            const attrs = this.manager.attributes[appId];
            this.appEmitter.emit("attributesUpdate", attrs);
        });
        this.disposer = disposer;
    }

    private cleanAppAttributes() {
        this.manager.safeSetAttributes({ [this.id]: undefined });
        const focus = this.manager.attributes["focus"];
        if (focus === this.id) {
            this.manager.safeSetAttributes({ focus: undefined });
        }
    }
}
