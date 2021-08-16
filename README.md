# WindowManager

### 接入
```javascript
import { WhiteWebSdk } from "white-web-sdk";
import { WindowManager } from "@netless/window-manager";

WindowManager.register(APP); // APP 为应用实例

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
        collector, // 可选, 用于多窗口最小化的 dom
        { debug: true } // 可选, 调试用
    );
});

```

### 添加 app 到白板上
```javascript
manager.addApp({
    kind: App.kind,
    options: {
        scenePath: "/xxxx",
        title: "app1"
    },
    attributes: {
        
    }
});
```


## 开发流程
yarn build:lib

cd test

yarn dev