import { TeleBoxRect, ReadonlyTeleBox } from '@netless/telebox-insider';
import { SceneState, SceneDefinition, View, AnimationMode, Displayer, Room, Player } from 'white-web-sdk';
import { AppContext } from './AppContext';

export interface NetlessApp<T = any> {
    kind: string;
    config?: {
        /** Box width relative to whiteboard. 0~1. Default 0.5. */
        width?: number;
         /** Box height relative to whiteboard. 0~1. Default 0.5. */
        height?: number;

        /** Minimum box width relative to whiteboard. 0~1. Default 340 / 720. */
        minwidth?: number;
        /** Minimum box height relative to whiteboard. 0~1. Default 340 / 720. */
        minheight?: number;
    };
    setup: (context: AppContext<T>) => void;
};

export type AppEmitterEvent<T = any> = {
    /**
     *  before plugin destroyed
     */
    destroy: { error?: Error },
    attributesUpdate: T | undefined,
    /**
     * room isWritable change or box blur
     */
    writableChange: boolean,
    sceneStateChange: SceneState,
    setBoxSize: { width: number, height: number },
    setBoxMinSize: { minwidth: number, minheight: number },
    setBoxTitle: { title: string },
    containerRectUpdate: TeleBoxRect,
}

export type AppListenerKeys = keyof AppEmitterEvent;

export type { AppContext } from "./AppContext";
export type { ReadonlyTeleBox, TeleBoxRect };
export type { SceneState, SceneDefinition, View, AnimationMode, Displayer, Room, Player };
