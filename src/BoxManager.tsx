import Emittery from 'emittery';
import { AddAppOptions, emitter, AppInitState, WindowManager, AppManager } from './index';
import { AppAttributes, Events, MIN_HEIGHT, MIN_WIDTH } from './constants';
import { NetlessApp } from './typings';
import {
    ReadonlyTeleBox,
    TeleBox,
    TeleBoxCollector,
    TELE_BOX_EVENT,
    TeleBoxManager,
    TELE_BOX_STATE,
    TELE_BOX_MANAGER_EVENT,
    TeleBoxManagerUpdateConfig,
    TeleBoxManagerCreateConfig
} from '@netless/telebox-insider';
import { View } from 'white-web-sdk';
import { debounce, get, isEmpty } from 'lodash-es';
import { log } from './log';
import { AppProxy } from './AppProxy';

export { TELE_BOX_STATE };

export type CreateBoxParams = {
    appId: string,
    app: NetlessApp,
    view?: View,
    emitter?: Emittery,
    options?: AddAppOptions,
    canOperate?: boolean
};

type AppId = { appId: string };

type MoveBoxParams = AppId & { x: number, y: number };

type ResizeBoxParams = AppId & { width: number, height: number };

type SetBoxMinSizeParams = AppId & { minWidth: number, minHeight: number };

type SetBoxTitleParams = AppId & { title: string };
export class BoxManager {
    public teleBoxManager: TeleBoxManager;
    public appBoxMap: Map<string, string> = new Map();

    constructor(
        private manager: AppManager,
        private mainView: View,
        private appProxies: Map<string, AppProxy>,
        collector?: HTMLElement
    ) {
        this.mainView = mainView;
        this.teleBoxManager = this.setupBoxManager(collector);
        this.teleBoxManager.events.on(TELE_BOX_MANAGER_EVENT.State, state => {
            if (state) {
                emitter.emit(state, undefined);
            }
        });
        this.teleBoxManager.events.on("removed", boxes => {
            boxes.forEach(box => {
                emitter.emit("close", { appId: box.id });
            })
        });
        this.teleBoxManager.events.on("move", debounce((box: ReadonlyTeleBox): void => {
            emitter.emit("move", { appId: box.id, x: box.x, y: box.y });
        }, 200));
        this.teleBoxManager.events.on("resize", debounce((box: ReadonlyTeleBox): void => {
            emitter.emit("resize", { appId: box.id, width: box.width, height: box.height });
        }, 200));
        this.teleBoxManager.events.on("focused", box => {
            if (box) {
                if (this.manager.canOperate) {
                    emitter.emit("focus", { appId: box.id });
                } else {
                    this.updateBox(box.id, { focus: false });
                }
            } else {
                this.blurFocusBox();
            }
        });
        this.teleBoxManager.events.on("snapshot", box => {
            emitter.emit("snapshot", { appId: box.id, rect: box.rectSnapshot });
        });
    }

    public createBox(params: CreateBoxParams) {
        if (!this.teleBoxManager) return;
        let { width, height, minwidth = MIN_WIDTH, minheight = MIN_HEIGHT } = params.app.config ?? {};
        const title = params.options?.title || params.appId;
        const rect = this.teleBoxManager.containerRect;

        if (minwidth > 1) {
            minwidth = minwidth / rect.width;
        }

        if (minheight > 1) {
            minheight = minheight / rect.height;
        }

        const createBoxConfig: TeleBoxManagerCreateConfig = {
            title, minWidth: minwidth, minHeight: minheight, width, height,
            id: params.appId
        }

        const box = this.teleBoxManager.create(createBoxConfig);

        emitter.emit(`${params.appId}${Events.WindowCreated}`);


        const appState = this.manager.delegate.getAppState(params.appId);
        if (appState) {
            const snapshotRect = get(appState, [AppAttributes.SnapshotRect]);
            if (isEmpty(snapshotRect)) {
                this.setBoxInitState(params.appId);
            }
        }
    }

    public setBoxInitState(appId: string) {
        const box = this.teleBoxManager.queryOne({ id: appId });
        if (box) {
            emitter.emit("snapshot", { appId: appId, rect: box.rectSnapshot });
            if (box.state === TELE_BOX_STATE.Maximized) {
                emitter.emit("resize", { appId: appId, x: box.x, y: box.y, width: box.width, height: box.height });
            }
        }
    }

    public setupBoxManager(collector?: HTMLElement) {
        const root = WindowManager.wrapper ? WindowManager.wrapper : document.body;
        const rect = root.getBoundingClientRect();
        const initManagerState: any = {
            root: root,
            containerRect: {
                x: 0, y: 0,
                width: rect.width, height: rect.height
            },
            fence: false,
        }
        if (collector) {
            const teleBoxCollector = new TeleBoxCollector().mount(collector);
            initManagerState.collector = teleBoxCollector;
        }
        const manager = new TeleBoxManager(initManagerState);
        if (this.teleBoxManager) {
            this.teleBoxManager.destroy();
        }
        this.teleBoxManager = manager;
        return manager;
    }

    public getBox(appId: string) {
        return this.teleBoxManager.queryOne({ id: appId });
    }

    public closeBox(appId: string) {
        return this.teleBoxManager.remove(appId);
    }

    public updateBox(appId: string, config: TeleBoxManagerUpdateConfig) {
        return this.teleBoxManager.update(appId, config);
    }

    public boxIsFocus(appId: string) {
        const box = this.getBox(appId);
        return box?.focus;
    }

    public updateBoxState(state?: AppInitState) {
        if (!state) return;
        const box = this.getBox(state.id);
        if (box) {
            this.teleBoxManager.update(box.id, {
                x: state.x,
                y: state.y,
                width: state.width || 0.5,
                height: state.height || 0.5
            });
            if (state.focus) {
                this.teleBoxManager.update(box.id, { focus: true });
            }
            if (state.boxState) {
                this.teleBoxManager.setState(state.boxState);
            }
            if (state.snapshotRect) {
                (box as TeleBox).setSnapshot(state.snapshotRect);
            }
        }
    }

    public updateManagerRect() {
        const rect = this.mainView.divElement?.getBoundingClientRect();
        if (rect && rect.width > 0 && rect.height > 0) {
            const containerRect = { x: 0, y: 0, width: rect.width, height: rect.height };
            this.teleBoxManager.setContainerRect(containerRect);
            this.appProxies.forEach((proxy) => {
                if (this.teleBoxManager) {
                    proxy.appEmitter.emit("containerRectUpdate", this.teleBoxManager.containerRect);
                }
            });
        }
    }

    public moveBox({ appId, x, y }: MoveBoxParams) {
        this.teleBoxManager.update(appId, { x, y }, true);
    }

    public focusBox({ appId }: AppId) {
        this.teleBoxManager.update(appId, { focus: true }, true);
    }

    public resizeBox({ appId, width, height }: ResizeBoxParams) {
        this.teleBoxManager.update(appId, { width, height }, true);
    }

    public setBoxMinSize(params: SetBoxMinSizeParams) {
        this.teleBoxManager.update(
            params.appId,
            {
                minWidth: params.minWidth,
                minHeight: params.minHeight
            },
            true);
    }

    public setBoxTitle(params: SetBoxTitleParams) {
        this.teleBoxManager.update(params.appId, { title: params.title }, true);
    }

    public blurAllBox() {
        this.teleBoxManager.updateAll({ focus: false });
    }

    public blurFocusBox() {
        const focusBoxs = this.teleBoxManager.query({ focus: true });
        if (focusBoxs.length) {
            const box = focusBoxs[0];
            this.teleBoxManager.update(box.id, { focus: false });
        }
    }

    public updateAll(config: TeleBoxManagerUpdateConfig) {
        this.teleBoxManager.updateAll(config);
    }

    public setBoxState(state: TELE_BOX_STATE) {
        this.teleBoxManager.setState(state, true);
    }
}
