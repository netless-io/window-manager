import { TeleBoxRect, ReadonlyTeleBox } from 'telebox-insider';
import { SceneState, WhiteScene } from 'white-web-sdk';
import { PluginContext } from './PluginContext';

export interface Plugin<T = any> {
    kind: string;
    config?: {
        /** Box width relative to whiteboard. 0~1. Default 0.5. */
        width?: number;
         /** Box height relative to whiteboard. 0~1. Default 0.5. */
        height?: number;

        /** Minimum box width relative to whiteboard. 0~1. Default 0. */
        minwidth?: number;
        /** Minimum box height relative to whiteboard. 0~1. Default 0. */
        minheight?: number;
    };
    setup: (context: PluginContext<T>, pluginArgs: any) => void;
};

export type PluginEmitterEvent<T = any> = {
    create: void,
    /**
     *  before plugin destroyed
     */
    destroy: { error?: Error },
    attributesUpdate: T,
    /**
     * room isWritable change or box blur
     */
    writableChange: boolean,
    sceneStateChange: SceneState,
    setBoxSize: { width: number, height: number },
    setBoxMinSize: { minwidth: number, minheight: number },
    containerRectUpdate: TeleBoxRect,
}

export type PluginListenerKeys = keyof PluginEmitterEvent;

export type { PluginContext } from "./PluginContext";
export type { ReadonlyTeleBox, TeleBoxRect };
export type { SceneState, WhiteScene };
