# 基础教程
`WindowManager` 内置了 `DocsViewer` 和 `MediaPlayer` 用来播放 PPT 和音视频

## 打开动态/静态 PPT
```typescript
import { BuiltinApps } from "@netless/window-manager";

const appId = await manager.addApp({
    kind: BuiltinApps.DocsViewer,
    options: {
        scenePath: "/docs-viewer", // 定义 ppt 所在的 scenePath
        title: "docs1", // 可选
        scenes: [], // SceneDefinition[] 静态/动态 Scene 数据
    },
});
```

## 打开音视频
```typescript
import { BuiltinApps } from "@netless/window-manager";

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
 

## 查询所有的 App
```typescript
const apps = manager.queryAll();
```

## 查询单个 APP
```typescript
const app = manager.queryOne(appId);
``` 

## 关闭 App
```typescript
manager.closeApp(appId);
```

## events

### 窗口最小化最大化
```typescript
manager.emitter.on("boxStateChange", state => {
    // maximized | minimized | normal
});
```

### 视角跟随模式
```typescript
manager.emitter.on("broadcastChange", state => {
    // state: number | undefined
});
```

