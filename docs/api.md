# API

## 目录
  - [静态方法](#static-methods)
    - [`mount`](#mount)
    - [`register`](#register)
  - [实例方法](#instance-methods)
    - [`addApp`](#addApp)
    - [`closeApp`](#closeApp)
  - [实例属性](#prototypes)
  - [事件回调](#events)

<h2 id="static-methods">静态方法</h2>

<h3 id="mount">WindowManager.mount</h3>

> 挂载 WindowManager

```typescript
const manager = await WindowManager.mount(
    room: room,
    container: document.getElementById("container")
    // 完整配置见下方
);
```

参数

| name                   | type                                    | default | desc                         |
| ---------------------- | --------------------------------------- | ------- | ---------------------------- |
| room                   | [require] Room                          |         | 房间实例                         |
| container              | [require] HTMLElement                   |         | 房间挂载容器                       |
| containerSizeRatio     | [optional] number                       | 9 / 16  | 多窗口区域的高宽比，默认为 9 : 16         |
| chessboard             | [optional] boolean                      | true    | 多窗口区域以外的空间显示 PS 棋盘背景，默认 true |
| collectorContainer     | [optional] HTMLElement                  |         | 用于多窗口最小化图标挂载的 dom            |
| collectorStyles        | [optional] Partial{CSSStyleDeclaration} |         | 配置 collector 的样式             |
| overwriteStyles        | [optional] string                       |         | 用于覆盖窗口的样式                    |
| cursor                 | [optional] boolean                      | false   | 开启光标同步                       |
| disableCameraTransform | [optional] boolean                      |         | 禁用主白板的相机移动                   |
| prefersColorScheme     | [optional] string                       | light   | auto, light, dark            |
| debug                  | [optional] boolean                      | false   | 打印日志信息   

<h3 id="register">WindowManager.register</h3>

> 注册 `APP` 到 `WindowManager`

```typescript
WindowManager.register({
    kind: "helloWorld",
    src: NetlessApp,
    appOptions: () => "appOptions",
    addHooks: (emitter) => {
         emitter.on("created", result => {
            console.log("HelloWordResult", result);
        });
        emitter.on("focus", result => {
            console.log("HelloWorld focus", result);
        })
        emitter.on("destroy", result => {
            console.log("HelloWorld destroy", result);
        })
    }
})
```


<h2 id="instance-methods">实例方法</h2>

<h3 id="addApp">addApp</h3>

> 添加 `app` 至白板

```typescript
const appId = await manager.addApp({
    kind: "helloWorld"
    options: { // 可选配置
        scenePath: "/hello-world"
    }
})
```
具体参数请参考 `APP` 本身的要求

<h3 id="closeApp">closeApp</h3>

> 关闭已经打开的 `APP`

```typescript
manager.closeApp(appId)
```

<h2 id="prototypes">实例属性</h2>

| name               | type    | default | desc   |
| ------------------ | ------- | ------- | ------ |
| mainView           | View    |         | 主白板    |
| boxState           | string  |         | 当前窗口状态 |
| darkMode           | boolean |         | 黑夜模式   |
| prefersColorScheme | string  |         | 颜色主题   |


<h2 id="events">事件回调</h2>

```typescript
manager.callbacks.on(events, listener)
```

| name                     | type           | default | desc                       |
| ------------------------ | -------------- | ------- | -------------------------- |
| mainViewModeChange       | ViewVisionMode |         |                            |
| boxStateChange           | string         |         | normal,minimized,maximized |
| darkModeChange           | boolean        |         |                            |
| prefersColorSchemeChange | string         |         | auto,light,dark            |
| cameraStateChange        | CameraState    |         |                            |
