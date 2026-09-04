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
    - [`addAppAndWaitForSetup`](#addAppAndWaitForSetup)
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
    - [`dispatchDocsEvent`](#dispatchDocsEvent)
    - [`getPageState`](#getPageState)
    - [`addPage`](#addPage)
    - [`removePage`](#removePage)
    - [`refresh`](#refresh)
    - [`setContainerSizeRatio`](#setContainerSizeRatio)
    - [`fitOriginSizeAndCamera`](#fitOriginSizeAndCamera)
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
| originSize             | [optional] Size                         |         | mainView 原始尺寸；正常运行时同一房间所有端必须一致 |
| pageScaleRange         | [optional] { minScale?: number; maxScale?: number } | | `dispatchDocsEvent("scalePage")` 的可选相对倍率范围；未配置的边界不施加业务限制 |
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
| useBoxesStatus         | [optional] boolean                      | false   | 是否使用 boxesStatus 状态管理窗口, 开启后可以单独管理每个窗口的状态               |

> 旧房间只有完整 `mainViewSize/mainViewCamera` 时，首次通过可写端配置 `originSize`，WindowManager
> 会在创建 MainView 前原子初始化 origin pair、active pair 和坐标版本，并将
> `mainViewSize/mainViewCamera` 重置为新的 origin pair。只读端不能完成该同步初始化，完整版本 2
> contract 建立前 mount 会失败。
>
> 房间已有完整版本 2 origin contract 且本次可写 mount 显式传入不同 `originSize` 时，
> WindowManager 会在创建 MainView 前原子重置 origin pair、active pair 和坐标版本。该重置会同步到
> 房间，并使 MainView 立即按新基准计算本地 camera scale。只读端不能发起重置，配置不一致时 mount
> 会失败。已有版本 2 contract 与 mount `originSize` 相同时保留当前 active pair。Slide、Presentation
> 的 `originSize` 仍由 `addApp()` attributes 独立配置，不受此行为影响。

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

`addApp()` 在窗口创建后即可返回，不等待 App 的 `setup()` 完成。需要捕获 `setup()`
异常时使用 `addAppAndWaitForSetup()`。

<h3 id="addAppAndWaitForSetup">addAppAndWaitForSetup</h3>

> 添加 App 并等待它的 `setup()` 完成。setup 失败时 Promise reject，并清理本地半初始化 App。

```typescript
try {
    const appId = await manager.addAppAndWaitForSetup({
        kind: "helloWorld",
        options: { scenePath: "/hello-world" },
    })
} catch (error) {
    // error 是 App setup 抛出的原始异常。
}
```

<h3 id="appContextCreateLogger">AppContext.createLogger</h3>

> App 内创建带 App 上下文的 Room/SLS logger。logger 随 App 销毁，错误日志立即上报，
> 高频 info 日志可按 event 名分别防抖。防抖时间默认 300ms，小于 300ms 的配置按 300ms 处理。

```typescript
setup(context) {
    const logger = context.createLogger("camera", {
        debounceTime: 300,
        maxWaitTime: 2000,
    })

    logger.info("initialize", { camera: context.getView()?.camera })
    logger.debouncedInfo("moveCamera", { camera: context.getView()?.camera })

    try {
        // App 操作
    } catch (error) {
        logger.error("operation.failed", error)
        throw error
    }
}
```

WindowManager 内部日志和 App logger 统一进行安全序列化、敏感字段及 URL query
脱敏，并限制单条日志长度。`error()` 不进行防抖。App 的防抖 info 日志继续使用
300ms 默认/最小间隔，WindowManager 的 `attributes` 同步日志使用 500ms 尾部防抖间隔。
成功的 `unifiedPageStateChange` 诊断日志按目标分别使用 300ms 尾部防抖，事件回调本身仍即时触发。

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

<h3 id="dispatchDocsEvent">dispatchDocsEvent</h3>

> 向 mainView、DocsViewer、Slide 或 Presentation 派发统一的翻页、动画步骤或缩放命令。

```ts
const result = await manager.dispatchDocsEvent("nextPage", { target: appId })
await manager.dispatchDocsEvent("jumpToPage", { target: appId, page: 3 })
await manager.dispatchDocsEvent("scalePage", { target: "mainView", scale: 1.5 })
```

`target` 可以是 `"mainView"` 或具体 appId。未传时优先使用当前 focused App，没有 focused
App 时回退到 mainView。`page` 使用 1-based 页码。`scale` 是相对适配尺寸的倍率，`1` 表示
适配尺寸；mainView 缩放通过 `manager.moveCamera` 生效。默认没有业务缩放范围；只有显式配置
`mount.pageScaleRange.minScale/maxScale` 时才检查边界，越界返回
`{ accepted: false, reason: "outOfRange", message }`，不会 clamp。DocsViewer 不支持
`scalePage`，固定返回 `{ accepted: false, reason: "eventNotSupported", message: "DocsViewer does not support scalePage" }`。

返回的 `Promise<DispatchDocsEventResult>` 表示命令是否被接受；拒绝时包含稳定的 `reason`
和可读 `message`。命令接受后的实际页码或相对倍率通过 `unifiedPageStateChange` 观察。

<h3 id="getPageState">getPageState</h3>

> 查询 mainView、DocsViewer、Slide 或 Presentation 当前的统一页面状态。

```ts
const state = await manager.getPageState({ target: appId })
// { target, appId?, page, pageCount, scale? }
```

`page` 为 1-based，`pageCount` 为实际总页数。mainView、Slide、Presentation 额外返回相对
适配尺寸的实际 `scale`。

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

<h3 id="fitOriginSizeAndCamera">fitOriginSizeAndCamera</h3>

> 将当前 mainView 的同步尺寸和 camera 恢复为 `mount({ originSize })` 建立的固定基准。
> 未配置 `originSize` 时不执行操作。

```ts
manager.fitOriginSizeAndCamera()
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
| pageStateChange          | PageState      |         | 当mainView 的页码变化的时候触发             ｜
| unifiedPageStateChange   | UnifiedPageStateChange |   | mainView、DocsViewer、Slide 或 Presentation 的实际页码或相对倍率状态 |
| fullscreenChange          | boolean      |          | 当全屏状态改变时触发          ｜
| appsChange                 | string[]    |         | 被打开的app列表改变时触发       |
| onAppSetup             | string      |         | 当 app 窗口被打开时触发     |
| onBoxesStatusChange          | Map<string, TeleBoxState> |         | 当窗口状态改变时触发,只有配置了useBoxesStatus时才会触发     |

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

```ts
type UnifiedPageStateChange = {
    target: "mainView" | "DocsViewer" | "Slide" | "Presentation";
    appId?: string;
    page: number;
    pageCount: number;
    scale?: number;
    status: "pending" | "success" | "failure";
    changeType?: "page" | "scale";
    mainView?: number;
    presentation?: number;
    view?: number;
    slide?: number;
    event?: DocsEvent;
    reason?: "commandFailed";
    message?: string;
}
```

```ts
type TeleBoxState = `${TELE_BOX_STATE}`;
declare enum TELE_BOX_STATE {
    Normal = "normal",
    Minimized = "minimized",
    Maximized = "maximized"
}
```
