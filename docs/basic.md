# Basic Tutorial
`WindowManager` has built-in `DocsViewer` and `MediaPlayer` to play PPT and audio and video

## Open dynamic/static PPT
```typescript
import { BuiltinApps } from "@netless/window-manager";

const appId = await manager.addApp({
     kind: BuiltinApps.DocsViewer,
     options: {
         scenePath: "/docs-viewer", // define the scenePath where the ppt is located
         title: "docs1", // optional
         scenes: [], // SceneDefinition[] static/dynamic Scene data
     },
});
```

## Open audio and video
```typescript
import { BuiltinApps } from "@netless/window-manager";

const appId = await manager.addApp({
     kind: BuiltinApps.MediaPlayer,
     options: {
         title: "test.mp3", // optional
     },
     attributes: {
         src: "xxxx", // audio and video url
     },
});
```
 

## Query all apps
```typescript
const apps = manager.queryAll();
```

## Query a single APP
```typescript
const app = manager.queryOne(appId);
```

## Close App
```typescript
manager.closeApp(appId);
```

## events

### Minimize and maximize the window
```typescript
manager.emitter.on("boxStateChange", state => {
     // maximized | minimized | normal
});
```

### Camera follow mode
```typescript
manager.emitter.on("broadcastChange", state => {
     // state: number | undefined
});
```
