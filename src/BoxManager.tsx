import Emittery from 'emittery';
import { emitter, WindowManager } from './index';
import { Events } from './constants';
import { Plugin } from './typings';
import {
    ReadonlyTeleBox,
    TeleBoxCollector,
    TeleBoxEventType,
    TeleBoxManager,
    TeleBoxState
} from 'telebox-insider';
import { View, WhiteScene } from 'white-web-sdk';
import debounce from 'lodash.debounce';

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

export class BoxManager {
    private teleBoxManager: TeleBoxManager;
    private windowManager: WindowManager;
    private mainView: View;
    private pluginBoxMap: Map<string, string> = new Map();

    constructor(mainView: View, windowManager: WindowManager) {
        this.mainView = mainView;
        this.windowManager = windowManager;
        const manager = this.setupBoxManager();
        this.teleBoxManager = manager;
    }

    public createBox(params: CreateBoxParams) {
        const { width, height } = params.plugin.config ?? {};

        const box = this.teleBoxManager.create({
            title: params.pluginId,
            width: width, height: height,
            focus: true
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
            return this.teleBoxManager.remove(boxId);
        }
    }

    public boxIsFocus(pluginId: string) {
        const box = this.getBox(pluginId);
        return box?.focus;
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
        box.events.on(TeleBoxEventType.Move, this.boxMoveListener(pluginId));
        box.events.on(TeleBoxEventType.Resize, this.boxResizeListener(pluginId));
        box.events.on(TeleBoxEventType.Focus, this.boxFocusListener(pluginId));
        box.events.on(TeleBoxEventType.Blur, this.boxBlurListener(pluginId));
        box.events.on(TeleBoxEventType.State, this.boxStateListener(pluginId));
    }


    private boxMoveListener = (pluginId: string) => {
        return debounce(({ x, y }: { x: number, y: number }) => {
            emitter.emit("move", { pluginId, x, y });
        }, 5);
    }

    private boxResizeListener = (pluginId: string) => {
        return debounce(({ width, height }: { width: number, height: number }) => {
            emitter.emit("resize", { pluginId, width, height });
        }, 5);
    }

    private boxFocusListener = (pluginId: string) => {
        return () => {
            emitter.emit("focus", { pluginId });
        }
    }

    private boxBlurListener = (pluginId: string) => {
        return () => {
            emitter.emit("blur", { pluginId });
        }
    }

    private boxStateListener = (pluginId: string) => {
        return (state: TeleBoxState) => {
            emitter.emit(state, { pluginId });
        }
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

    public blurAllBox() {
        this.teleBoxManager.updateAll({
            focus: false
        });
    }

    public setBoxState(state: TeleBoxState) {
        this.teleBoxManager.setState(state, true);
    }
}
