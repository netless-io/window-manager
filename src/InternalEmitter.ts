import Emittery from "emittery";
import type { TeleBoxRect } from "@netless/telebox-insider";
import type { CursorMovePayload } from "./index";
import type { MemberState } from "white-web-sdk";

export type RemoveSceneParams = {
    scenePath: string;
    index?: number;
};

export type EmitterEvent = {
    onCreated: undefined;
    error: Error;
    seekStart: undefined;
    seek: number;
    mainViewMounted: undefined;
    observerIdChange: number;
    boxStateChange: string;
    playgroundSizeChange: TeleBoxRect;
    startReconnect: undefined;
    onReconnected: undefined;
    removeScenes: RemoveSceneParams;
    cursorMove: CursorMovePayload;
    updateManagerRect: undefined;
    focusedChange: { focused: string | undefined; prev: string | undefined };
    rootDirRemoved: undefined; // 根目录整个被删除
    rootDirSceneRemoved: string; // 根目录下的场景被删除
    setReadonly: boolean;
    changePageState: undefined;
    writableChange: boolean;
    containerSizeRatioUpdate: number;
    memberStateChange: MemberState;
};

export type EmitterType = Emittery<EmitterEvent>;
export const emitter: EmitterType = new Emittery();
