# WindowManager

[中文](./README.zh-cn.md)

`WindowManager` is a window management system based on `white-web-sdk` `InvisiblePlugin` implementation.

This application provides the following.

1. provides `NetlessApp` plug-in `API` system
2. support `APP` to open as a window
3. support application synchronization in each end
4. cursor synchronization
5. view angle following

## Content list
  - [Install](#Install)
  - [QuickStart](#QuickStart)
  - [concept](docs/concept.md)
  - [references](docs/api.md)
  - [migration from whiteboard](docs/migrate.md)
  - [replay](docs/replay.md)
  - [advanced use](docs/advanced.md)
    - [view-follow](docs/advanced.md#view-mode)
  - [Develop custom APP](docs/develop-app.md)
  - [Export PDF](docs/export-pdf.md)

## Install

pnpm
```sh
$ pnpm install @netless/window-manager
```
yarn
```sh
$ yarn install @netless/window-manager
```

## QuickStart

```javascript
import { White-WebSdk } from "white-web-sdk";
import { WindowManager, BuiltinApps } from "@netless/window-manager";
import "@netless/window-manager/dist/style.css";

const sdk = new WhiteWebSdk({
    appIdentifier: "appIdentifier",
    useMobXState: true // make sure this option is turned on
});

sdk.joinRoom({
    uuid: "room uuid",
    roomToken: "room token",
    invisiblePlugins: [WindowManager],
    useMultiViews: true, // Multi-window must be enabled with useMultiViews
    disableMagixEventDispatchLimit: true, // Make sure this option is turned on
}).then(async room => {
    const manager = await WindowManager.mount(
        room,
        container
        // See below for full configuration
    );
});
```

[mount full parameter](docs/api.md#mount)

> ``containerSizeRatio`` In order to ensure that the window is displayed at different resolutions, the whiteboard can only be synchronized in the same scale area


## MainView

`MainView`, the main whiteboard, is the main whiteboard that sits underneath all windows.

Because of the multiple windows, we abstracted out a main whiteboard, and migrated some of the previous operations on `room` to `mainView` operations



### `collector`

> `collector` is the icon when the window is minimized, default size `width: 40px;` `height: 40px;`


### Cursor synchronization

> The original `cursorAdapter` in `SDK` is not available in multi-window, if you need cursor synchronization, you need to enable `cursor` option in `manager`.

```typescript
sdk.joinRoom({
    // cursorAdapter: cursorAdapter, the original cursorAdapter in sdk needs to be turned off
    userPayload: {
        nickName: "cursor name",
        avatar: "User avatar link",
    },
});

WindowManager.mount({
    cursor: true, // turn on cursor synchronization
});
```

## APP

Static and dynamic PPTs are inserted into the whiteboard as `App`, and persisted to the whiteboard

`App` may be created automatically when the page is refreshed, no need to insert it repeatedly

If the `App` requires a `scenePath`, then a `scenePath` can only be opened at the same time, requiring a unique `App` instance

### Add static/dynamic PPT to whiteboard

```javascript
const appId = await manager.addApp({
    kind: BuiltinApps.DocsViewer,
    options: {
        scenePath: "/docs-viewer",
        title: "docs1", // optional
        scenes: [], // SceneDefinition[] Static/Dynamic Scene data
    },
});
```

### Add audio and video to the whiteboard

```javascript
const appId = await manager.addApp({
    kind: BuiltinApps.MediaPlayer,
    options: {
        title: "test.mp3", // optional
    },
    attributes: {
        src: "xxxx", // audio/video url
    },
});
```

### Set follow mode

Only the broadcast side, i.e. the teacher, needs to set the follow mode, the other side of the main whiteboard will follow the view of the broadcast side

> Note that `manager`'s `setViewMode` cannot be used at the same time as `room.setViewMode`.

```javascript
manager.setViewMode("broadcaster"); // turn on follow mode
manager.setViewMode("freedom"); // turn off follow mode
```

Get the current `broadcaster` ID
```javascript
manager.broadcaster
```

### Set `readonly` for all `app`s

```javascript
manager.setReadonly(true); // all windows become readonly
manager.setReadonly(false); // unlock the readonly setting, note that if the current whiteboard isWritable is false, the whiteboard's state is the highest priority
```

### Toggle `mainView` to writable state

```javascript
manager.switchMainViewToWriter();
```

### Switch `mainView` `scenePath`

Switch the `ScenePath` of the main whiteboard and set the main whiteboard to writable state

```javascript
manager.setMainViewScenePath(scenePath);
```

### toggle `mainView` `sceneIndex`

Toggles the `SceneIndex` of the main whiteboard and sets the main whiteboard to writable state

```javascript
manager.setMainViewSceneIndex(sceneIndex);
```

### Get the `mainView` `scenePath`

```javascript
manager.getMainViewScenePath();
```

### Get `mainView` `sceneIndex`

```javascript
manager.getMainViewSceneIndex();
```

### Listen to the `mainView` `mode`

```javascript
manager.emitter.on("mainViewModeChange", mode => {
    // mode type is ViewVisionMode
});
```

### Listening for window maximization and minimization

```javascript
manager.emitter.on("boxStateChange", state => {
    if (state === "maximized") {
        // maximize
    }
    if (state === "minimized") {
        // minimized
    }
    if (state === "normal") {
        // return to normal
    }
});
```

### Listening for `broadcaster` changes
```javascript
manager.emitter.on("broadcastChange", id => {
    // broadcast id changed
})

```

### Close the `App`

```javascript
manager.closeApp(appId);
```

## Manually destroy `WindowManager`

```javascript
manager.destroy();
```

## Development process

```bash
pnpm install

pnpm build

cd example

pnpm install

pnpm dev
```
