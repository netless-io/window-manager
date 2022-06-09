import type { TELE_BOX_STATE } from "@netless/telebox-insider";
import Emittery from "emittery";

export type BoxMovePayload = { appId: string, x: number; y: number };
export type BoxFocusPayload = { appId: string };
export type BoxResizePayload = { appId: string, width: number; height: number, x?: number, y?: number };
export type BoxClosePayload = { appId: string, error?: Error };
export type BoxStateChangePayload = { appId: string, state: TELE_BOX_STATE };

export type BoxEvent = {
    move: BoxMovePayload;
    focus: BoxFocusPayload;
    resize: BoxResizePayload;
    close: BoxClosePayload;
    boxStateChange: BoxStateChangePayload
}

export type BoxEmitterType = Emittery<BoxEvent>;
export const boxEmitter: BoxEmitterType = new Emittery();
