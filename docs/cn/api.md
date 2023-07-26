# API

## 目录
  - [静态方法](#static-methods)
    - [`mount`](#mount)
    - [`register`](#register)
    - [`registered`](#registered)
    - [`setContainer`](#set-container)
    - [`setCollectorContainer`](#set-collector-container)
  - [实例方法](#instance-methods)
    - [`addApp`](#addApp)
    - [`closeApp`](#closeApp)
    - [`focusApp`](#focusApp)
    - [`setMainViewSceneIndex`](#setMainViewSceneIndex)
    - [`setBoxState`](#setBoxState)
    - [`cleanCurrentScene`](#cleanCurrentScene)
    - [`redo`](#redo)
    - [`undo`](#undo)
    - [`copy`](#copy)
    - [`paste`](#paste)
    - [`delete`](#delete)
    - [`duplicate`](#duplicate)
    - [`insertText`](#insertText)
    - [`insertImage`](#insertImage)
    - [`completeImageUpload`](#completeImageUpload)
    - [`lockImage`](#lockImage)
    - [`lockImages`](#lockImages)
    - [`nextPage`](#nextPage)
    - [`prevPage`](#prevPage)
    - [`addPage`](#addPage)
    - [`removePage`](#removePage)
    - [`refresh`](#refresh)
    - [`setContainerSizeRatio`](#setContainerSizeRatio)
  - [实例属性](#prototypes)
  - [事件回调](#events)

<br>

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
| applianceIcons         | [optional] {ApplianceNames, string}     |         | 配置光标使用的教具图片           ｜

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

<br>

<h3 id="registered">WindowManager.registered</h3>

> 获取已经注册过的 `App`

```ts
WindowManager.registered
```

<br>

<h3 id="set-container">setContainer</h3>

> 设置白板挂载容器

```typescript
WindowManager.setContainer(document.getElementById("container"));
```

<h3 id="set-container">setCollectorContainer</h3>

> 设置 `Collector` 挂载的容器

```typescript
WindowManager.setCollectorContainer(document.getElementById("collector-container"));
```

<br>

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

<h3 id="focusApp">focusApp</h3>

> 切换当前 `focus` 的 `app`, 并把此 `app` 置为最前

```typescript
manager.focusApp(appId)
```

<h3 id="setMainViewSceneIndex">setMainViewSceneIndex</h3>

> 设置主白板的 `SceneIndex`

```ts
manager.setMainViewSceneIndex(1)
```

<h3 id="setBoxState">setBoxState</h3>

> 设置当前的 `boxState`

```ts
manager.setBoxState("normal") // boxState: normal | maximized | minimized
```

<h3 id="cleanCurrentScene">cleanCurrentScene</h3>

> 清除当前 focus 的 view 的笔迹

```ts
manager.cleanCurrentScene()
```

<h3 id="redo">redo</h3>

> 在当前 focus 的 view 上重做上一步操作

```ts
manager.redo()
```

<h3 id="undo">undo</h3>

> 在当前 focus 的 view 上撤消上一步操作

```ts
manager.undo()
```

<h3 id="nextPage">nextPage</h3>

> 切换主白板至下一页

```ts
const success = await manager.nextPage()
if (!success) {
    // 已经到了最后一页
}
```

<h3 id="prevPage">prevPage</h3>

> 切换主白板至上一页

```ts
const success = await manager.prevPage()
if (!success) {
    // 已经到了第一页
}
```

<h3 id="addPage">addPage</h3>

> 在主白板添加一页

```ts
manager.addPage() // 默认在最后添加一页
manager.addPage({ after: true }) // 在当前页后添加一页
manager.addPage({ scene: { name: "page2" } }) // 传入 page 信息
```

<h3 id="removePage">removePage</h3>

> 移除一页
> 当只剩一页时, 最后一页不允许被删除

```ts
const success = await manager.removePage() // 默认删除当前页
const success = await manager.removePage(1) // 可以删除指定 index
```

<h3 id="refresh">refresh</h3>

> 刷新 `manager` 的内部状态, 用于从其他房间 `copy` `attributes`

```ts
manager.refresh()
```

<h3 id="setContainerSizeRatio">setContainerSizeRatio</h3>

> 设置白板同步区域的宽高比

```ts
manager.setContainerSizeRatio(10 / 16)
```

<br>

<h2 id="prototypes">实例属性</h2>

| name               | type    | default | desc                   |
| ------------------ | ------- | ------- | -----------------      |
| mainView           | View    |         | 主白板                  |
| mainViewSceneIndex | number  |         | 当前主白板的 SceneIndex  |
| mainViewScenesLength | number |        | mainView 的 scenes 长度 |
| boxState           | string  |         | 当前窗口状态             |
| darkMode           | boolean |         | 黑夜模式                 |
| prefersColorScheme | string  |         | 颜色主题                 |
| focused            | string |          | focus 的 app            |
| canRedoSteps       | number  |         | 当前 focus 的 view 可以重做的步数 |
| canRedoSteps       | number  |         | 当前 focus 的 view 可以撤销的步数 |
| sceneState         | SceneState |      | 兼容原本 SDK 的 sceneState 属性, 只对 mainView 生效 |
| pageState          | PageState |       | 组合 mainView 的 index 和 scenes 的修改 |

<br>

<h2 id="events">事件回调</h2>

```typescript
manager.emitter.on(events, listener)
```

| name                     | type           | default | desc                       |
| ------------------------ | -------------- | ------- | -------------------------- |
| mainViewModeChange       | ViewVisionMode |         |                            |
| mainViewSceneIndexChange | index: number  |         |                            |
| boxStateChange           | string         |         | normal,minimized,maximized |
| darkModeChange           | boolean        |         |                            |
| prefersColorSchemeChange | string         |         | auto,light,dark            |
| cameraStateChange        | CameraState    |         |                            |
| focusedChange            | string, undefined |     | 当前 focus 的 appId，主白板时为 undefined  |
| mainViewScenesLengthChange | number      |         | mainView scenes 添加或删除时触发 |
| canRedoStepsChange       | number         |         | 当前 focus 的 view 可重做步数改变 |
| canUndoStepsChange       | number         |         | 当前 focus 的 view 可撤销步数改变 |
| loadApp                  | LoadAppEvent   |         | 加载远程APP 事件                |
| ready                    | undefined      |         | 当所有 APP 创建完毕时触发      ｜
| sceneStateChange         | SceneState     |         | 当 sceneState 修改时触发     |
| pageStateChange          | PageState      |         |                            ｜

```ts
type LoadAppEvent = {
    kind: string;
    status: "start" | "success" | "failed";
    reason?: string;
}
```

```ts
type PageState = {
    index: number;
    length: number;
}
```
