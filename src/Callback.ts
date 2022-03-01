import Emittery from "emittery";
import type { TeleBoxColorScheme, TELE_BOX_STATE } from "@netless/telebox-insider";
import type { CameraState, SceneState, ViewVisionMode } from "white-web-sdk";
import type { LoadAppEvent } from "./Register";

export type PublicEvent = {
    mainViewModeChange: ViewVisionMode;
    boxStateChange: `${TELE_BOX_STATE}`;
    darkModeChange: boolean;
    prefersColorSchemeChange: TeleBoxColorScheme;
    cameraStateChange: CameraState;
    mainViewScenePathChange: string;
    mainViewSceneIndexChange: number;
    focusedChange: string | undefined;
    mainViewScenesLengthChange: number;
    canRedoStepsChange: number;
    canUndoStepsChange: number;
    loadApp: LoadAppEvent;
    ready: undefined; // 所有 APP 创建完毕时触发
    sceneStateChange: SceneState;
};

export type CallbacksType = Emittery<PublicEvent>;
export const callbacks: CallbacksType = new Emittery();
