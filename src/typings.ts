import type Emittery from "emittery";
import type {
    AnimationMode,
    ApplianceNames,
    Displayer,
    DisplayerState,
    Player,
    Room,
    SceneDefinition,
    SceneState,
    View,
} from "white-web-sdk";
import type { AppContext } from "./App";
import type { ReadonlyTeleBox, TeleBoxRect } from "@netless/telebox-insider";
import type { PageState } from "./Page";

export interface NetlessApp<Attributes extends {} = any, MagixEventPayloads = any, AppOptions = any, SetupResult = any> {
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
    setup: (context: AppContext<Attributes, MagixEventPayloads, AppOptions>) => SetupResult;
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
    pageStateChange: PageState,
};

export type RegisterEventData = {
    appId: string;
};

export type RegisterEvents<SetupResult = any> = {
    created: RegisterEventData & { result: SetupResult; };
    destroy: RegisterEventData;
    focus: RegisterEventData;
};

export type RegisterParams<AppOptions = any, SetupResult = any, Attributes extends {} = any> = {
    kind: string;
    src:
        | NetlessApp<Attributes, SetupResult>
        | string
        | (() => Promise<NetlessApp<Attributes, SetupResult>>)
        | (() => Promise<{ default: NetlessApp<Attributes, SetupResult> }>);
    appOptions?: AppOptions | (() => AppOptions);
    addHooks?: (emitter: Emittery<RegisterEvents<SetupResult>>) => void;
    /** dynamic load app package name */
    name?: string;
};

export type AppListenerKeys = keyof AppEmitterEvent;

export type ApplianceIcons = Partial<Record<`${ApplianceNames}` | string, string>>;

export type { AppContext } from "./App/AppContext";
export type { ReadonlyTeleBox, TeleBoxRect };
export type { SceneState, SceneDefinition, View, AnimationMode, Displayer, Room, Player };
export type { Storage, StorageStateChangedEvent, StorageStateChangedListener } from "./App/Storage";
export * from "./Page";
export * from "./Utils/error";
