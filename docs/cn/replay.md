## 回放

> 注意: 多窗口的回放只支持从创建房间开始就是多窗口的房间

> 如果是一开始作为单窗口模式使用，又转变成多窗口模式使用, 则会造成回放渲染空白

<br>


```typescript
import { WhiteWebSdk } from "white-web-sdk";
import { WindowManager, BuiltinApps } from "@netless/window-manager";
import "@netless/window-manager/dist/style.css";

const sdk = new WhiteWebSdk({
    appIdentifier: "appIdentifier",
    useMobXState: true // 请确保打开这个选项
});

let manager: WindowManager;

sdk.replayRoom({
    uuid: "room uuid",
    roomToken: "room token",
    invisiblePlugins: [WindowManager],
    useMultiViews: true, // 多窗口必须用开启 useMultiViews
}).then(player => {
   player.callbacks.on("onPhaseChanged", async (phase) => {
       if (phase === PlayerPhase.Playing) {
           if (manager) return;
            manager = await WindowManager.mount({
                room: player,
                container: document.getElementById("container")
            });
       }
   })
});

player.play(); // WindowManager 只有在播放之后才能挂载
```