import Emittery from 'emittery';
import React from 'react';
import ReactDOM from 'react-dom';
import { emitter, WindowManager } from './index';
import { ErrorBoundary } from './error';
import { Events } from './constants';
import { Plugin } from './typings';
import {
    ReadonlyTeleBox,
    TeleBoxCollector,
    TeleBoxEventType,
    TeleBoxManager
    } from 'telebox-insider';
import { View, WhiteScene } from 'white-web-sdk';
import debounce from 'lodash.debounce';
import { PluginContext } from './PluginContext';

export type CreateBoxParams = {
    pluginId: string,
    plugin: Plugin,
    node: any,
    view?: View,
    scenes?: WhiteScene[],
    initScenePath?: string,
    emitter?: Emittery,
    options?: any,
    context: PluginContext,
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
        const rect = document.getElementById("root")!.getBoundingClientRect();
        const manager = new TeleBoxManager({
            root: document.getElementById("root")!,
            containerRect: {
                x: 0, y: 0,
                width: rect.width, height: rect.height
            },
            collector: new TeleBoxCollector().mount(document.body),
            fence: false
        });
        this.teleBoxManager = manager;
    }

    public createBox(params: CreateBoxParams) {
        const { width, height } = params.plugin.options;
        const widthRatio = width / this.teleBoxManager.containerRect.width;
        const heigthRatio = height / this.teleBoxManager.containerRect.height;

        const box = this.teleBoxManager.create({
            title: params.pluginId,
            width: widthRatio, height: heigthRatio,
            focus: true
        });

        const warpper = document.createElement("div");
        warpper.className = `${params.pluginId}-wrapper`;
        warpper.style.width = "100%";
        warpper.style.height = "100%";

        try {
            ReactDOM.render(
                <ErrorBoundary pluginId={params.pluginId}>
                   <params.node {...params} displayer={WindowManager.displayer} />
                </ErrorBoundary>, warpper);
        } catch (error) {
            console.log("error by setRef");
        }

        this.teleBoxManager.update(box.id, {
            content: warpper,
        });

        emitter.emit(`${params.pluginId}${Events.WindowCreated}`);
        this.addBoxListeners(params.pluginId, box);
        this.pluginBoxMap.set(params.pluginId, box.id);
    }

    public getBox({ pluginId }: PluginId) {
        const boxId = this.pluginBoxMap.get(pluginId);
        if (boxId) {
            return this.teleBoxManager.queryOne({ id: boxId });
        }
    }

    public boxIsFocus(pluginId: string) {
        const box = this.getBox({ pluginId });
        return box?.focus;
    }

    public updateManagerRect() {
        const rect = this.mainView.divElement?.getBoundingClientRect();
        if (rect) {
            const containerRect = { x: 0, y: 0, width: rect.width, height: rect.height };
            this.teleBoxManager.setContainerRect(containerRect);
        }
    }

    private addBoxListeners(pluginId: string, box: ReadonlyTeleBox) {
        box.events.on(TeleBoxEventType.Move, this.boxMoveListener(pluginId));
        box.events.on(TeleBoxEventType.Resize, this.boxResizeListener(pluginId));
        box.events.on(TeleBoxEventType.Focus, this.boxFocusListener(pluginId));
        box.events.on(TeleBoxEventType.Blur, this.boxBlurListener(pluginId));
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
}
