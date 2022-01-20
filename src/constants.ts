export enum Events {
    AppMove = "AppMove",
    AppFocus = "AppFocus",
    AppResize = "AppResize",
    AppBoxStateChange = "AppBoxStateChange",
    GetAttributes = "GetAttributes",
    UpdateWindowManagerWrapper = "UpdateWindowManagerWrapper",
    InitReplay = "InitReplay",
    WindowCreated = "WindowCreated",
    SetMainViewScenePath = "SetMainViewScenePath",
    SetMainViewSceneIndex = "SetMainViewSceneIndex",
    SwitchViewsToFreedom = "SwitchViewsToFreedom",
    MoveCameraToContain = "MoveCameraToContain",
    CursorMove = "CursorMove",
}

export const MagixEventName = "__WindowManger";

export enum AppAttributes {
    Size = "size",
    Position = "position",
    SceneIndex = "SceneIndex",
    ZIndex = "zIndex",
}

export enum AppEvents {
    setBoxSize = "setBoxSize",
    setBoxMinSize = "setBoxMinSize",
    destroy = "destroy",
}

export enum AppStatus {
    StartCreate = "StartCreate",
}

export enum CursorState {
    Leave = "leave",
    Normal = "normal",
}

export const REQUIRE_VERSION = "2.16.0";

export const MIN_WIDTH = 340 / 720;
export const MIN_HEIGHT = 340 / 720;

export const SET_SCENEPATH_DELAY = 100; // 设置 scenePath 的延迟事件

export const DEFAULT_CONTAINER_RATIO = 9 / 16;
