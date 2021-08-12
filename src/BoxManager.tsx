import Emittery from 'emittery';
import { emitter, PluginInitState, WindowManager } from './index';
import { Events } from './constants';
import { Plugin } from './typings';
import {
    ReadonlyTeleBox,
    TeleBox,
    TeleBoxCollector,
    TeleBoxEventType,
    TeleBoxManager,
    TeleBoxState
} from 'telebox-insider';
import { View, WhiteScene } from 'white-web-sdk';
import debounce from 'lodash.debounce';
import { log } from './log';

export { TeleBoxState };

export type CreateBoxParams = {
    pluginId: string,
    plugin: Plugin,
    node: any,
    view?: View,
    scenes?: WhiteScene[],
    initScenePath?: string,
    emitter?: Emittery,
    options?: any
};

type PluginId = { pluginId: string };

type MoveBoxParams = PluginId & { x: number, y: number };

type ResizeBoxParams = PluginId & { width: number, height: number };

type SetBoxMinSizeParams = PluginId & { minWidth: number, minHeight: number };

type SetBoxTitleParams = PluginId & { title: string };
export class BoxManager {
    public teleBoxManager: TeleBoxManager;
    private pluginBoxMap: Map<string, string> = new Map();

    constructor(
        private mainView: View,
        private manager: WindowManager
    ) {
        this.mainView = mainView;
        this.teleBoxManager = this.setupBoxManager();;
    }

    public createBox(params: CreateBoxParams) {
        const { width, height } = params.plugin.config ?? {};

        const box = this.teleBoxManager.create({
            title: params.pluginId,
            width: width, height: height,
        });

        emitter.emit(`${params.pluginId}${Events.WindowCreated}`);
        this.addBoxListeners(params.pluginId, box);
        this.pluginBoxMap.set(params.pluginId, box.id);
    }

    public setupBoxManager() {
        const root = WindowManager.root ? WindowManager.root : document.body;
        const rect = root.getBoundingClientRect();
        const manager = new TeleBoxManager({
            root: root,
            containerRect: {
                x: 0, y: 0,
                width: rect.width, height: rect.height
            },
            collector: new TeleBoxCollector().mount(document.body),
            fence: false
        });
        this.teleBoxManager = manager;
        return manager;
    }

    public getBox(pluginId: string) {
        const boxId = this.pluginBoxMap.get(pluginId);
        if (boxId) {
            return this.teleBoxManager.queryOne({ id: boxId });
        }
    }

    public closeBox(pluginId: string) {
        const boxId = this.pluginBoxMap.get(pluginId);
        if (boxId) {
            this.pluginBoxMap.delete(pluginId);
            return this.teleBoxManager.remove(boxId);
        }
    }

    public boxIsFocus(pluginId: string) {
        const box = this.getBox(pluginId);
        return box?.focus;
    }

    public updateBox(state?: PluginInitState) {
        if (!state) return;
        const box = this.getBox(state.id);
        if (box) {
            this.teleBoxManager.update(box.id, {
                x: state.x, y: state.y, width: state.width, height: state.height, focus: state.focus
            });
            this.teleBoxManager.setState(state.boxState);
            (box as TeleBox).setSnapshot(state.snapshotRect);
        }
    }

    public updateManagerRect() {
        const rect = this.mainView.divElement?.getBoundingClientRect();
        if (rect) {
            const containerRect = { x: 0, y: 0, width: rect.width, height: rect.height };
            this.teleBoxManager.setContainerRect(containerRect);
            WindowManager.emitterMap.forEach((emitter) => {
                emitter.emit("containerRectUpdate", this.teleBoxManager.containerRect);
            });
        }
    }

    private addBoxListeners(pluginId: string, box: ReadonlyTeleBox) {
        box.events.on(TeleBoxEventType.Move, debounce(params => emitter.emit("move", { pluginId, ...params }), 5));
        box.events.on(TeleBoxEventType.Resize, debounce(params => emitter.emit("resize", { pluginId, ...params }), 5));
        box.events.on(TeleBoxEventType.Focus, () => emitter.emit("focus", { pluginId }));
        box.events.on(TeleBoxEventType.Blur, () =>  emitter.emit("blur", { pluginId }));
        box.events.on(TeleBoxEventType.State, state => {
            emitter.emit(state, { pluginId });
        });
        box.events.on(TeleBoxEventType.Snapshot, rect => {
            emitter.emit("snapshot", { pluginId, rect })
        });
    }

    public moveBox({ pluginId, x, y }: MoveBoxParams) {
        const boxId = this.pluginBoxMap.get(pluginId);
        if (boxId) {
            this.teleBoxManager.update(boxId, { x, y }, true);
        }
    }

    public focusBox({ pluginId }: PluginId) {
        const boxId = this.pluginBoxMap.get(pluginId);
        if (boxId) {
            this.teleBoxManager.update(boxId, { focus: true }, true);
        }
    }

    public resizeBox({ pluginId, width, height }: ResizeBoxParams) {
        const boxId = this.pluginBoxMap.get(pluginId);
        if (boxId) {
            this.teleBoxManager.update(boxId, { width, height }, true);
        }
    }

    public setBoxMinSize(params: SetBoxMinSizeParams) {
        const boxId = this.pluginBoxMap.get(params.pluginId);
        if (boxId) {
            this.teleBoxManager.update(boxId, { minWidth: params.minWidth, minHeight: params.minHeight }, true);
        }
    }

    public setBoxTitle(params: SetBoxTitleParams) {
        const boxId = this.pluginBoxMap.get(params.pluginId);
        if (boxId) {
            this.teleBoxManager.update(boxId, { title: params.title }, true);
        }
    }

    public blurAllBox() {
        this.teleBoxManager.updateAll({
            focus: false
        });
    }

    public setBoxState(state: TeleBoxState) {
        this.teleBoxManager.setState(state, true);
    }
}
