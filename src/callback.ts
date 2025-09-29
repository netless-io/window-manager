import Emittery from "emittery";
import type {
    TeleBoxColorScheme,
    TELE_BOX_STATE,
    TeleBoxState,
    NotMinimizedBoxState,
} from "@netless/telebox-insider";
import type { CameraState, SceneState, View, ViewVisionMode } from "white-web-sdk";
import type { LoadAppEvent } from "./Register";
import type { PageState } from "./Page";
import type {
    BoxBlurredPayload,
    BoxClosePayload,
    BoxFocusPayload,
    BoxMovePayload,
    BoxResizePayload,
    BoxStateChangePayload,
} from "./BoxEmitter";
import type { AppPayload } from "./typings";

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
    pageStateChange: PageState;
    fullscreenChange: boolean;
    appsChange: string[]; // APP 列表变化时触发
    onBoxMove: BoxMovePayload;
    onBoxResize: BoxResizePayload;
    onBoxFocus: BoxFocusPayload;
    onBoxBlurred: BoxBlurredPayload;
    onBoxClose: BoxClosePayload;
    onBoxStateChange: BoxStateChangePayload;
    onMainViewMounted: View;
    onMainViewRebind: View;
    onAppViewMounted: AppPayload;
    onAppSetup: string;
    onAppScenePathChange: AppPayload;
    onBoxesStatusChange: Map<string, TeleBoxState>;
    onLastNotMinimizedBoxesStatusChange: Map<string, NotMinimizedBoxState>;
};

export type CallbacksType = Emittery<PublicEvent>;
export const callbacks: CallbacksType = new Emittery();
