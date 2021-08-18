
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
}

export enum AppAttributes {
    Size = "size",
    Position = "position",
    SnapshotRect = "SnapshotRect"
}

export enum AppEvents {
    setBoxSize = "setBoxSize",
    setBoxMinSize = "setBoxMinSize",
    destroy = "destroy",
}

export enum AppStatus {
    StartCreate = "StartCreate",
    CreateSuccess = "CreateSuccess",
    Failed = "Failed"
}

export const REQUIRE_VERSION = "2.13.16";

export const MIN_WIDTH = 0.4;
export const MIN_HEIGHT = 0.3;
