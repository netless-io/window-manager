import Emittery from 'emittery';
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
    WindowManager,
    AppManager
    } from './index';
import { BoxManager } from './BoxManager';
import { Events, AppAttributes, AppEvents } from './constants';
import { log } from './log';
import { AppContext } from './AppContext';
import { NetlessApp } from "./typings";
import { loadApp } from './loader';
import { AppCreateError, AppNotRegisterError } from './error';
import { isEqual } from "lodash-es";

export class AppProxy {
    public id: string;
    public scenePath?: string;
    public appEmitter: Emittery<AppEmitterEvent>;

    private appListener: any;
    private disposer: any;
    private boxManager = this.manager.boxManager;
    private appProxies = this.manager.appProxies;
    private lastAttrs: any;

    constructor(
        private params: AddAppParams,
        private manager: AppManager,
    ) {
        this.id = AppProxy.genId(params.kind, params.options);
        if (this.appProxies.has(this.id)) {
            throw new AppCreateError();
        }
        this.appProxies.set(this.id, this);
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
            appImpl = await loadApp(params.kind, params.src);
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
                await app.setup(context);
                if (boxInitState?.focus) {
                    this.manager.viewManager.swtichViewToWriter(appId);
                }
            });
            this.boxManager.createBox({
                appId: appId, app, options
            });
        } catch (error) {
            throw new Error(`[WindowManager]: app setup error: ${error.message}`);
        }
    }

    public getAppInitState = (id: string) => {
        const attrs = this.manager.delegate.getAppState(id);
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
        if (needCloseBox) {
            this.boxManager.closeBox(this.id);
            this.manager.viewManager.destoryView(this.id);
        }

        if (this.disposer) {
            this.disposer();
        }
        this.manager.delegate.cleanAppAttributes(this.id);
        this.appProxies.delete(this.id);
    }

    public emitAppSceneStateChange(sceneState: SceneState) {
        this.appEmitter.emit("sceneStateChange", sceneState!);
    }

    public emitAppIsWritableChange(isWritable: boolean) {
        if (isWritable === false) {
            this.appEmitter.emit("writableChange", isWritable);
        } else {
            if (this.box && this.box.focus) {
                this.appEmitter.emit("writableChange", isWritable);
            }
        }
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
            if (!isEqual(this.lastAttrs, attrs)) {
                this.appEmitter.emit("attributesUpdate", attrs);
                this.lastAttrs = attrs;
            }
        });
        this.disposer = disposer;
    }
}
