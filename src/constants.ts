
export enum Events {
    PluginMove = "PluginMove",
    PluginFocus = "PluginFocus",
    PluginResize = "PluginResize",
    PluginBlur = "PluginBlur",
    PluginMinimize = "PluginMinimize",
    PluginMaximize = "PluginMaximize",
    GetAttributes = "GetAttributes",
    UpdateWindowManagerWrapper = "UpdateWindowManagerWrapper",
    InitReplay = "InitReplay",
    WindowCreated = "WindowCreated",
}

export enum PluginAttributes {
    Size = "size",
    Position = "position",
    Minimize = "minimize",
    Maximize = "maximize",
}

export enum PluginEvents {
    setBoxSize = "setBoxSize",
    setBoxMinSize = "setBoxMinSize",
    destroy = "destroy",
}

