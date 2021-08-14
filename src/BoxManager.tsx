import Emittery from 'emittery';
import { AddAppOptions, emitter, AppInitState, WindowManager } from './index';
import { Events } from './constants';
import { NetlessApp } from './typings';
import {
    ReadonlyTeleBox,
    TeleBox,
    TeleBoxCollector,
    TELE_BOX_EVENT,
    TeleBoxManager,
    TELE_BOX_STATE,
    TELE_BOX_MANAGER_EVENT
} from 'telebox-insider';
import { View, WhiteScene } from 'white-web-sdk';
import debounce from 'lodash.debounce';
import { log } from './log';
import { AppProxy } from './AppProxy';

export { TELE_BOX_STATE };

export type CreateBoxParams = {
    appId: string,
    app: NetlessApp,
    view?: View,
    emitter?: Emittery,
    options?: AddAppOptions
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
        private mainView: View,
        private appProxies: Map<string, AppProxy>,
        collector?: HTMLElement
    ) {
        this.mainView = mainView;
        this.teleBoxManager = this.setupBoxManager(collector);
    }

    public createBox(params: CreateBoxParams) {
        if (!this.teleBoxManager) return;
        const { width, height } = params.app.config ?? {};
        const title = params.options?.title || params.appId;
        const box = this.teleBoxManager.create({
            title: title,
            width: width, height: height,
        });

        emitter.emit(`${params.appId}${Events.WindowCreated}`);
        this.addBoxListeners(params.appId, box);
        this.appBoxMap.set(params.appId, box.id);
        this.teleBoxManager.events.on(TELE_BOX_MANAGER_EVENT.State, state => {
            if (state) {
                emitter.emit(state, undefined);
            }
        });
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
        const boxId = this.appBoxMap.get(appId);
        if (boxId) {
            return this.teleBoxManager.queryOne({ id: boxId });
        }
    }

    public closeBox(appId: string) {
        const boxId = this.appBoxMap.get(appId);
        if (boxId) {
            this.appBoxMap.delete(appId);
            return this.teleBoxManager.remove(boxId);
        }
    }

    public boxIsFocus(appId: string) {
        const box = this.getBox(appId);
        return box?.focus;
    }

    public updateBox(state?: AppInitState) {
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
            (box as TeleBox).setSnapshot(state.snapshotRect);
        }
    }

    public updateManagerRect() {
        const rect = this.mainView.divElement?.getBoundingClientRect();
        if (rect) {
            const containerRect = { x: 0, y: 0, width: rect.width, height: rect.height };
            this.teleBoxManager.setContainerRect(containerRect);
            this.appProxies.forEach(proxy => {
                if (this.teleBoxManager) {
                    proxy.appEmitter.emit("containerRectUpdate", this.teleBoxManager.containerRect);
                }
            });
        }
    }

    private addBoxListeners(appId: string, box: ReadonlyTeleBox) {
        box.events.on(TELE_BOX_EVENT.Move, debounce(params => {
            emitter.emit("move", { appId, ...params });
        }, 500));
        box.events.on(TELE_BOX_EVENT.Resize, debounce(params => {
            emitter.emit("resize", { appId, ...params });
        }, 500));
        box.events.on(TELE_BOX_EVENT.Focus, () => {
            log("focus", appId);
            emitter.emit("focus", { appId });
        });
        box.events.on(TELE_BOX_EVENT.Blur, () => emitter.emit("blur", { appId }));
        box.events.on(TELE_BOX_EVENT.Snapshot, rect => {
            emitter.emit("snapshot", { appId, rect });
        });
        box.events.on(TELE_BOX_EVENT.Close, () => emitter.emit("close", { appId }));
    }

    public moveBox({ appId, x, y }: MoveBoxParams) {
        const boxId = this.appBoxMap.get(appId);
        if (boxId) {
            this.teleBoxManager.update(boxId, { x, y }, true);
        }
    }

    public focusBox({ appId }: AppId) {
        const boxId = this.appBoxMap.get(appId);
        if (boxId) {
            this.teleBoxManager.update(boxId, { focus: true }, true);
        }
    }

    public resizeBox({ appId, width, height }: ResizeBoxParams) {
        const boxId = this.appBoxMap.get(appId);
        if (boxId) {
            this.teleBoxManager.update(boxId, { width, height }, true);
        }
    }

    public setBoxMinSize(params: SetBoxMinSizeParams) {
        const boxId = this.appBoxMap.get(params.appId);
        if (boxId) {
            this.teleBoxManager.update(boxId, { minWidth: params.minWidth, minHeight: params.minHeight }, true);
        }
    }

    public setBoxTitle(params: SetBoxTitleParams) {
        const boxId = this.appBoxMap.get(params.appId);
        if (boxId) {
            this.teleBoxManager.update(boxId, { title: params.title }, true);
        }
    }

    public blurAllBox() {
        this.teleBoxManager.updateAll({
            focus: false
        });
    }

    public setBoxState(state: TELE_BOX_STATE) {
        this.teleBoxManager.setState(state, true);
    }
}
