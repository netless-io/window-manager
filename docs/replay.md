## playback

> Note: Multi-window playback only supports multi-window rooms from the creation of the room

> If it is used as a single-window mode at the beginning and then converted to a multi-window mode, it will cause blank playback rendering

<br>


```typescript
import { WhiteWebSdk } from "white-web-sdk";
import { WindowManager, BuiltinApps } from "@netless/window-manager";
import "@netless/window-manager/dist/style.css";

const sdk = new WhiteWebSdk({
     appIdentifier: "appIdentifier",
     useMobXState: true // make sure this option is turned on
});

let manager: WindowManager;

sdk.replayRoom({
     uuid: "room uuid",
     roomToken: "room token",
     invisiblePlugins: [WindowManager],
     useMultiViews: true, // Multi-window must be enabled useMultiViews
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

player.play(); // WindowManager can only be mounted after playing
```
