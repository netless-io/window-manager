# WindowManager

## MainView
`MainView` 也就是主白板, 是垫在所有窗口下面的主白板

因为多窗口的原因，所以抽象出来一个主白板, 并且把以前部分对 `room` 的操作, 迁移到对 `mainView` 操作

### 注意事项
多窗口模式必须开启白板的 `useMultiViews` 选项

会造成原本以下 `room` 上的一些方法和 `state` 失效

`方法`
- `room.bindHtmlElement()` 用 `WindowManager.mount()` 代替
- `room.scalePptToFit()` 暂无代替,不再推荐调用 `scalePptToFit`
- `room.setScenePath()` 用 `manager.setMainViewScenePath()` 代替
- `room.setSceneIndex()` 用 `manager.setMainViewSceneIndex()` 代替


> 为了方便使用 `manager` 替换了 `room` 上的一些方法可以直接对 `mianView` 生效
- `room.disableCameraTransform`
- `room.moveCamera`
- `room.moveCameraToContain`
- `room.convertToPointInWorld`
- `room.setCameraBound`

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

### 添加静态/动态 PPT 到白板上
```javascript
const appId = await manager.addApp({
    kind: BuildinApps.DocsViewer,
    options: {
        scenePath: "/docs-viewer",
        title: "docs1", // 可选
        scenes: [], // SceneDefinition[] 静态/动态 Scene 数据
    }
});
```

### 添加音视频到白板
```javascript
const appId = await manager.addApp({
    kind: BuildinApps.MediaPlayer,
    options: {
        title: "test.mp3" // 可选
    },
    attributes: {
        src: "xxxx" // 音视频 url
    }
});
```

### 获取当前所有已经打开的 app 的属性
```typescript
manager.apps
```

### 设置跟随模式
只有广播端也就是老师需要设置跟随模式, 其他端的主白板都会跟随广播端的视角
```javascript
manager.setViewMode("broadcaster"); // 开启跟随模式
manager.setViewMode("freedom"); // 关闭跟随模式
```

### 设置所有 `app` 的 `readonly`
```javascript
manager.setReadonly(true) // 所有窗口变成 readonly 状态
manager.setReadonly(false) // 解锁设置的 readonly, 注意如果当前白板的 isWritable 为 false 以白板的状态为最高优先级
```

### 切换 `mainView` 为可写状态
```javascript
manager.switchMainViewToWriter();
```

### 切换 `mainView` `scenePath`
切换主白板的 `ScenePath` 并把主白板设置为可写状态
```javascript
manager.setMainViewScenePath(scenePath)
```

### 切换 `mainView` `sceneIndex`
切换主白板的 `SceneIndex` 并把主白板设置为可写状态
```javascript
manager.setMainViewSceneIndex(sceneIndex)
```

### 获取 `mainView` `scenePath`
```javascript
manager.getMainViewScenePath()
```

### 获取 `mainView` `sceneIndex`
```javascript
manager.getMainViewSceneIndex()
```

### 监听 `mianView` 的 `mode`
```javascript
manager.onMainViewModeChange(mode => { // ViewVisionMode
    console.log(mode)
});
```

### 关闭 `App`
```javascript
manager.closeApp(appId)
```


## 手动销毁 `WindowManager`
```javascript
manager.destroy()
```


## 开发流程
yarn build:lib

cd test

yarn dev