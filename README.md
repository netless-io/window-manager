# WindowManager

### 注意事项
多窗口模式必须开启白板的 `useMultiViews` 选项

会造成原本以下 `room` 上的一些方法和 `state` 失效

`方法`
- `room.bindHtmlElement()` 用 `WindowManager.mount()` 代替
- `room.disableCameraTransform` 用 `manager.mainView.disableCameraTransform` 代替
- room.scalePptToFit()
- room.moveCamera()
- room.moveCameraToContain()
- room.setCameraBound()

关于 `camera` 的所有操作, 请使用
```
manager.mainView.moveCamera()
manager.mainView.moveCameraToContain()
manager.mainView.setCameraBound()
```

`state`
- room.state.cameraState

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
    let manager = room.getInvisiblePlugin(WindowManager.kind);
    if (!manager) {
        manager = await WindowManager.mount(
            room, // 房间实例
            continaer, // 挂载 dom 容器, 等同于 room.bindHtmlElement(continaer)
            collector, // 可选, 用于多窗口最小化挂载的 dom
            { debug: true } // 可选, 调试用
        );
    }
});
```

## APP
静态和动态 PPT 是作为 `App` 插入到白板, 并持久化到白板中

`App` 或会在页面刷新时自动创建出来, 不需要重复插入

### 添加静态 PPT 到白板上
```javascript
manager.addApp({
    kind: BuildinApps.DocsViewer,
    options: {
        scenePath: "/docs-viewer",
        title: "app1"
    },
    attributes: {
        pages: [{
            src: "http://xxx.com/1.png", // 白板静态转换结果中的 url
            width: 800, // 白板静态转换结果中的 width
            height: 400, //  // 白板静态转换结果中的 height
            thumbnail: "http://xxx.com/preview/1.png" //可选 preview url
        }]
        // 插件需要的属性值
    }
});
```


### 添加动态 PPT 到白板上
```javascript
manager.addApp({
    kind: BuildinApps.DocsViewer,
    options: {
        scenePath: "/ppt-scene-path", // 动态 PPT 所在 ScenePath
        title: "app1"
    },
    attributes: {
       dynamic: true,  // 用来标示动态 ppt
    }
});
```


## 手动销毁 `WindowManager`
```javascript
manager.unmount()
```


## 开发流程
yarn build:lib

cd test

yarn dev