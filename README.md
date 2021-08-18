# WindowManager

## MainView
`MainView` 也就是主白板, 是垫在所有窗口下面的主白板
因为多窗口的原因，必须抽象出来一个主白板, 并且需要把以前直接对 `room` 的操作, 迁移到对 `MainView` 上

### 注意事项
多窗口模式必须开启白板的 `useMultiViews` 选项

会造成原本以下 `room` 上的一些方法和 `state` 失效

`方法`
- `room.bindHtmlElement()` 用 `WindowManager.mount()` 代替
- `room.disableCameraTransform` 用 `manager.mainView.disableCameraTransform` 代替
- `room.scalePptToFit()` 暂无代替
- `room.moveCamera()` 用 `manager.mainView.moveCamera()` 代替
- `room.moveCameraToContain()` 用 `manager.mainView.moveCameraToContain()` 代替
- `room.setCameraBound()` 用 `manager.mainView.setCameraBound()` 代替
- `room.setScenePath()` 用 `manager.setMainViewScenePath()` 代替
- `room.setSceneIndex()` 用 `manager.setMainViewSceneIndex()` 代替


`camera`
- `room.state.cameraState` 用 `manager.mainView.camera` 和 `manager.mainView.size` 代替

想要监听主白板 `camera` 的变化, 请使用如下方式代替
```javascript
manager.mainView.callbacks.on("onCameraUpdated", (camera) => {
    console.log(camera)
})
```
监听主白板 `size` 变化
```javascript
manager.mainView.callbacks.on("onSizeUpdated", (size) => {
    console.log(size)
})
```

并且暂不支持原本的主播模式

### 接入
```javascript
import { WhiteWebSdk } from "white-web-sdk";
import { WindowManager, BuildinApps } from "@netless/window-manager";
import "@netless/window-manager/dist/style.css";

const sdk = new WhiteWebSdk({
    appIdentifier: "appIdentifier"
});

sdk.joinRoom({
    uuid: "room uuid",
    roomToken: "room token",
    invisiblePlugins: [WindowManager],
    useMultiViews: true, // 多窗口必须用开启 useMultiViews
}).then(async room => {
    const manager = await WindowManager.mount(
        room, // 房间实例
        continaer, // 挂载 dom 容器, 等同于 room.bindHtmlElement(continaer)
        collector, // 可选, 用于多窗口最小化挂载的 dom
        { debug: true } // 可选, 调试用
    );
});
```

## APP
静态和动态 PPT 是作为 `App` 插入到白板, 并持久化到白板中

`App` 或会在页面刷新时自动创建出来, 不需要重复插入

### 添加静态 PPT 到白板上
因为实现方式的原因, 静态 PPT 添加到白板时需要一个空白的 `scenePath`, 需要在 `addApp` 之前需要先 `putScenes`
```javascript
room.putScenes("/docs-viewer", [{ name: "1" }])
const appId = await manager.addApp({
    kind: BuildinApps.DocsViewer,
    options: {
        scenePath: "/docs-viewer",
        title: "app1", // 可选
    },
    attributes: {
        pages: [{
            src: "http://xxx.com/1.png", // 白板静态转换结果中的 url
            width: 800, // 白板静态转换结果中的 width
            height: 400, //  // 白板静态转换结果中的 height
            thumbnail: "http://xxx.com/preview/1.png" //可选 preview url
        }]
    }
});
```


### 添加动态 PPT 到白板上
```javascript
const appId = await manager.addApp({
    kind: BuildinApps.DocsViewer,
    options: {
        scenePath: "/ppt-scene-path", // 动态 PPT 所在 ScenePath
        title: "app2" // 可选
    },
    attributes: {
       dynamic: true,  // 用来标示动态 ppt
    }
});
```

### 切换 `mainView` `scenePath`
切换主白板的 `ScenePath` 并把主白板设置为可写状态
```javascript
manager.setMainViewScenePath(scenePath)
```

### 关闭 `App`
```javascript
manager.closeApp(appId)
```

### 切换 `mainView` `sceneIndex`
切换主白板的 `SceneIndex` 并把主白板设置为可写状态
```javascript
manager.setMainViewSceneIndex(sceneIndex)
```

## 手动销毁 `WindowManager`
```javascript
manager.unmount()
```


## 开发流程
yarn build:lib

cd test

yarn dev