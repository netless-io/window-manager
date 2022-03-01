import Emittery from "emittery";
import type { AppInitState, CursorMovePayload } from "./index";


export type EmitterEvent = {
    onCreated: undefined;
    InitReplay: AppInitState;
    move: { appId: string; x: number; y: number };
    focus: { appId: string };
    close: { appId: string };
    resize: { appId: string; width: number; height: number; x?: number; y?: number };
    error: Error;
    seek: number;
    mainViewMounted: undefined;
    observerIdChange: number;
    boxStateChange: string;
    playgroundSizeChange: DOMRect;
    onReconnected: void;
    removeScenes: string;
    cursorMove: CursorMovePayload;
    updateManagerRect: undefined;
    focusedChange: { focused: string | undefined; prev: string | undefined };
    rootDirRemoved: undefined;
};

export type EmitterType = Emittery<EmitterEvent>;
export const emitter: EmitterType = new Emittery();