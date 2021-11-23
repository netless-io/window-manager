import type Emittery from "emittery";
import type {
    AnimationMode,
    Displayer,
    DisplayerState,
    Player,
    Room,
    SceneDefinition,
    SceneState,
    View,
} from "white-web-sdk";
import type { AppContext } from "./AppContext";
import type { ReadonlyTeleBox, TeleBoxRect } from "@netless/telebox-insider";

export interface NetlessApp<Attributes = any, SetupResult = any, AppOptions = any> {
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

        /** App only single instance. */
        singleton?: boolean;
    };
    setup: (context: AppContext<Attributes, AppOptions>) => SetupResult;
}

export type AppEmitterEvent<T = any> = {
    /**
     *  before plugin destroyed
     */
    destroy: { error?: Error };
    attributesUpdate: T | undefined;
    /**
     * room isWritable change or box blur
     */
    writableChange: boolean;
    sceneStateChange: SceneState;
    setBoxSize: { width: number; height: number };
    setBoxMinSize: { minwidth: number; minheight: number };
    setBoxTitle: { title: string };
    containerRectUpdate: TeleBoxRect;
    roomStateChange: Partial<DisplayerState>;
    focus: boolean;
    reconnected: void;
    seek: number;
};

export type RegisterEventData = {
    appId: string;
};

export type RegisterEvents<SetupResult = any> = {
    created: RegisterEventData & { result: SetupResult; };
    destroy: RegisterEventData;
    focus: RegisterEventData;
};

export type RegisterParams<AppOptions = any, SetupResult = any, Attributes = any> = {
    kind: string;
    src: NetlessApp<Attributes, SetupResult> | string | (() => Promise<NetlessApp<Attributes, SetupResult>>);
    appOptions?: AppOptions | (() => AppOptions);
    addHooks?: (emitter: Emittery<RegisterEvents<SetupResult>>) => void;
    /** dynamic load app package name */
    name?: string;
};

export type AppListenerKeys = keyof AppEmitterEvent;

export type { AppContext } from "./AppContext";
export type { ReadonlyTeleBox, TeleBoxRect };
export type { SceneState, SceneDefinition, View, AnimationMode, Displayer, Room, Player };
