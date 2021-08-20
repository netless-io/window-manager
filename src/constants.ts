
export enum Events {
    AppMove = "AppMove",
    AppFocus = "AppFocus",
    AppResize = "AppResize",
    AppBlur = "AppBlur",
    AppBoxStateChange = "AppBoxStateChange",
    AppSnapshot = "AppSnapshot",
    AppClose = "AppClose",
    GetAttributes = "GetAttributes",
    UpdateWindowManagerWrapper = "UpdateWindowManagerWrapper",
    InitReplay = "InitReplay",
    WindowCreated = "WindowCreated",
    SetMainViewScenePath = "SetMainViewScenePath",
    SetMainViewSceneIndex = "SetMainViewSceneIndex",
    MainViewFocus = "MainViewFocus",
}

export enum AppAttributes {
    Size = "size",
    Position = "position",
    SnapshotRect = "SnapshotRect",
    SceneIndex = "SceneIndex",
}

export enum AppEvents {
    setBoxSize = "setBoxSize",
    setBoxMinSize = "setBoxMinSize",
    destroy = "destroy",
}

export enum AppStatus {
    StartCreate = "StartCreate",
}

export const REQUIRE_VERSION = "2.13.16";

export const MIN_WIDTH = 340 / 720;
export const MIN_HEIGHT = 340 / 720;
