# WindowManager

- 目录
  - [references](docs/api.md)
## MainView

`MainView` 也就是主白板, 是垫在所有窗口下面的主白板

因为多窗口的原因，所以抽象出来一个主白板, 并且把以前部分对 `room` 的操作, 迁移到对 `mainView` 操作

### 注意事项

多窗口模式必须开启白板的 `useMultiViews` 和 `useMobXState` 选项

会造成原本以下 `room` 上的一些方法和 `state` 失效

`方法`

-   `room.bindHtmlElement()` 用 `WindowManager.mount()` 代替
-   `room.scalePptToFit()` 暂无代替,不再推荐调用 `scalePptToFit`
-   `room.setScenePath()` 用 `manager.setMainViewScenePath()` 代替
-   `room.setSceneIndex()` 用 `manager.setMainViewSceneIndex()` 代替

> 为了方便使用 `manager` 替换了 `room` 上的一些方法可以直接对 `mainView` 生效

-   `room.disableCameraTransform`
-   `room.moveCamera`
-   `room.moveCameraToContain`
-   `room.convertToPointInWorld`
-   `room.setCameraBound`

`camera`

-   `room.state.cameraState` 用 `manager.mainView.camera` 和 `manager.mainView.size` 代替

想要监听主白板 `camera` 的变化, 请使用如下方式代替

```javascript
manager.mainView.callbacks.on("onCameraUpdated", camera => {
    console.log(camera);
});
```

监听主白板 `size` 变化

```javascript
manager.mainView.callbacks.on("onSizeUpdated", size => {
    console.log(size);
});
```

### 接入

```javascript
import { WhiteWebSdk } from "white-web-sdk";
import { WindowManager, BuiltinApps } from "@netless/window-manager";
import "@netless/window-manager/dist/style.css";

const sdk = new WhiteWebSdk({
    appIdentifier: "appIdentifier",
    useMobXState: true
});

sdk.joinRoom({
    uuid: "room uuid",
    roomToken: "room token",
    invisiblePlugins: [WindowManager],
    useMultiViews: true, // 多窗口必须用开启 useMultiViews
}).then(async room => {
    const manager = await WindowManager.mount(
        room,
        container
        // 完整配置见下方
    );
});
```

[mount 完整参数](docs/api.md#mount)


> `containerSizeRatio` 为了保证窗口在不同分辨率下显示效果, 白板在相同的比例区域才能进行同步

> `chessboard` 当挂载的区域不完全符合比例时, 白板会在挂载的 dom 中划分一个符合比例的区域出来, 此时多出来的部分会默认显示为棋盘透明背景

### `collector`

> `collector` 就是窗口最小化时的图标, 默认大小 `width: 40px;` `height: 40px;`


### 光标同步

> 原本的 `SDK` 中的 `cursorAdapter` 在多窗口中不可用, 如需要光标同步功能需要在 `manager` 中开启 `cursor` 选项

```typescript
sdk.joinRoom({
    // cursorAdapter: cursorAdapter, 原本开启 sdk 中的 cursorAdapter 需要关闭
    userPayload: {
        userId: "用户 id",
        cursorName: "光标名称",
        avatar: "用户头像链接",
    },
});

WindowManager.mount({
    cursor: true, // 开启光标同步
});
```

## APP

静态和动态 PPT 是作为 `App` 插入到白板, 并持久化到白板中

`App` 或会在页面刷新时自动创建出来, 不需要重复插入

如果 `App` 需要 `scenePath` 时，那么一个 `scenePath` 只能同时打开一个，要求为 `App` 实例唯一

### 添加静态/动态 PPT 到白板上

```javascript
const appId = await manager.addApp({
    kind: BuiltinApps.DocsViewer,
    options: {
        scenePath: "/docs-viewer",
        title: "docs1", // 可选
        scenes: [], // SceneDefinition[] 静态/动态 Scene 数据
    },
});
```

### 添加音视频到白板

```javascript
const appId = await manager.addApp({
    kind: BuiltinApps.MediaPlayer,
    options: {
        title: "test.mp3", // 可选
    },
    attributes: {
        src: "xxxx", // 音视频 url
    },
});
```

### 设置跟随模式

只有广播端也就是老师需要设置跟随模式, 其他端的主白板都会跟随广播端的视角

> 注意 `manager` 的 `setViewMode` 不能和 `room.setViewMode` 同时使用

```javascript
manager.setViewMode("broadcaster"); // 开启跟随模式
manager.setViewMode("freedom"); // 关闭跟随模式
```

获取当前的 `broadcaster` ID
```javascript
manager.broadcaster
```

### 设置所有 `app` 的 `readonly`

```javascript
manager.setReadonly(true); // 所有窗口变成 readonly 状态
manager.setReadonly(false); // 解锁设置的 readonly, 注意如果当前白板的 isWritable 为 false 以白板的状态为最高优先级
```

### 切换 `mainView` 为可写状态

```javascript
manager.switchMainViewToWriter();
```

### 切换 `mainView` `scenePath`

切换主白板的 `ScenePath` 并把主白板设置为可写状态

```javascript
manager.setMainViewScenePath(scenePath);
```

### 切换 `mainView` `sceneIndex`

切换主白板的 `SceneIndex` 并把主白板设置为可写状态

```javascript
manager.setMainViewSceneIndex(sceneIndex);
```

### 获取 `mainView` `scenePath`

```javascript
manager.getMainViewScenePath();
```

### 获取 `mainView` `sceneIndex`

```javascript
manager.getMainViewSceneIndex();
```

### 监听 `mainView` 的 `mode`

```javascript
manager.emitter.on("mainViewModeChange", mode => {
    // mode 类型为 ViewVisionMode
});
```

### 监听窗口最大化最小化

```javascript
manager.emitter.on("boxStateChange", state => {
    if (state === "maximized") {
        // 最大化
    }
    if (state === "minimized") {
        // 最小化
    }
    if (state === "normal") {
        // 恢复正常
    }
});
```

### 监听 `broadcaster` 变化
```javascript
manager.emitter.on("broadcastChange", id => {
    // broadcast id 进行了改变
})

```

### 关闭 `App`

```javascript
manager.closeApp(appId);
```

## 手动销毁 `WindowManager`

```javascript
manager.destroy();
```

## 开发流程

yarn build:lib

cd test

yarn dev
