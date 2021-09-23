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

export interface NetlessApp<Attributes = any, SetupResult = any> {
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
    setup: (context: AppContext<Attributes>) => SetupResult;
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
};

export type RegisterEventData<SetupResult = any> = {
    appId: string;
    instance: SetupResult;
};

export type RegisterEvents<SetupResult = any> = {
    created: RegisterEventData<SetupResult>;
    destroy: RegisterEventData;
};

export type RegisterContext<SetupResult = any> = {
    emitter: Emittery<RegisterEvents<SetupResult>>;
};

export type RegisterParams<AppOptions = any, SetupResult = any, Attributes = any> = {
    kind: string;
    src: NetlessApp<Attributes, SetupResult> | string | (() => Promise<NetlessApp<Attributes, SetupResult>>);
    appOptions?: AppOptions | (() => AppOptions);
    setup?: (context: RegisterContext<SetupResult>) => void;
    /** dynamic load app package name */
    name?: string;
};

export type AppListenerKeys = keyof AppEmitterEvent;

export type { AppContext } from "./AppContext";
export type { ReadonlyTeleBox, TeleBoxRect };
export type { SceneState, SceneDefinition, View, AnimationMode, Displayer, Room, Player };
