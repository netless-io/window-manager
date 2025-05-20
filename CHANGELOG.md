## 1.0.2(2025-05-20)

- 升级 @netless/app-media-player@0.1.4

## 1.0.1 (2025-05-18)

- 升级 @netless/app-media-player@0.1.3

## 1.0.0 (2024-12-02)
- 升级 @netless/app-docs-viewer@0.2.18

## 0.4.75 (2024-09-10)
- 升级 @netless/app-media-player@0.1.0-beta.9

## 0.4.74 (2024-09-02)

- 升级 @netless/app-media-player@0.1.0-beta.7

## 0.4.73 (2024-07-02)

- 新增: `setCursorUIDs([uid])` 可以限制只显示相关用户的光标，不传参数或传入空数组表示显示所有用户的光标
- 新增: `supportAppliancePlugin` 配置项，开启用于支持 `AppliancePlugin` 接入

## 0.4.72 (2024-04-03)

- 修复: `side-effect-manager` `0.1.6` 导致上一条功能出问题，锁版本到 `0.1.5`

## 0.4.71 (2024-04-03)

- 新增: `cursorOptions.style` 初始化参数和 `cursorStyle=` 方法，可以切换到另一种光标样式

  提示: 可以添加以下配置来隐藏远端光标上的用户名部分

  ```js
  overwriteStyles: ".netless-window-manager-cursor-name { display: none }"
  ```

## 0.4.70 (2024-03-28)

- 修复: 不再支持通过 `room.setScenePath()` 影响 App 内白板的场景

## 0.4.69 (2024-03-25)

- 增强: 允许从窗口右上角进行拖动
- 升级 app-media-player

## 0.4.68 (2024-02-01)

- 修复: `addApp({ src: "url" })` 不能工作的问题 (可以先调 register 解决)
- 修复: 并发初始化后一端的主白板视角不对的问题

## 0.4.67 (2024-01-26)

- 修复: 元素在 mount 时不在 DOM 上，或宽高为 0 时初始视角异常

## 0.4.66 (2023-12-12)

- 修复: 窗口最大化时加载已存在 scenePath 的 app 没有自动切换 focus 的问题
- 新增: `context.dispatchAppEvent(type, value?)` 发送 app 本地事件
- 新增: `onAppEvent(kind, listener)` 监听 app 本地事件
- 已知问题: `manager.version` 返回 0.4.66-beta.0，暂时没啥影响就不发新版了

## 0.4.65 (2023-12-08)

- 修复: SDK 内置光标在修改 isWritable 后消失的问题

## 0.4.64 (2023-12-07)

- 修复: SDK 内置光标在重连后消失的问题, 此修复需要 white-web-sdk >= 2.16.43 才能工作

## 0.4.63 (2023-11-22)

- 添加 `fullscreen` 初始化参数和 `setFullscreen()` 方法，该选项启用时会隐藏窗口标题栏（但是不会自动最大化）
- 添加 `fullscreenChange` 和 `appsChange` 事件

## 0.4.62 (2023-10-12)

- 升级 @netless/app-docs-viewer@0.2.16
  - 支持抓手工具
- 新增: `jumpPage` 切页方法

## 0.4.61 (2023-07-26)

- 新增: [Iframe Bridge](https://github.com/netless-io/netless-iframe-bridge) 兼容接口, 通过 `getIframeBridge().insert(options)` 来使用
- 修复: 复制粘贴元素位置不对的问题, 此修复需要 white-web-sdk >= 2.16.43 才能工作

## 0.4.60 (2023-07-21)

- 升级 @netless/app-docs-viewer@0.2.15
  - 修复 `scenes[0].name` 不为 `1` 时导出 PDF 功能异常

## 0.4.59 (2023-07-14)

- 升级 @netless/app-docs-viewer@0.2.14
- 缩短回放失败超时

## 0.4.58 (2023-06-06)

- 升级 @netless/app-docs-viewer@0.2.13

## 0.4.57 (2023-05-30)

- 升级 @netless/app-docs-viewer@0.2.12

## 0.4.56 (2023-05-10)

- 修复: 第一个用户的光标消失的问题

## 0.4.55 (2022-12-07)

- 修改导出文件名为 .mjs 和 .js

  Webpack 用户可能会因此报错，解决方法详见 [fastboard#20](https://github.com/netless-io/fastboard/issues/20)

## 0.4.54 (2022-11-30)

- 增强: 默认选择最新 session 作为当前用户

## 0.4.53 (2022-11-30)

- 修复: 本地 pencilEraser 光标没有正确消失

## 0.4.52 (2022-11-30)

- 增强: 触摸输入 pencilEraser 时显示本地光标

## 0.4.51 (2022-11-18)

- 增强: 导出 PDF 现在需要额外安装 jspdf 才能使用（优化打包体积）

## 0.4.50 (2022-11-16)

- 修复: 重连后 `pageStage.length` 没有刷新的问题
- 新增: docs viewer 增加导出 pdf 功能

## 0.4.49 (2022-10-13)

- 增强: 切换 `viewMode` 为 `follower` 总是同步远端的 `camera`

## 0.4.48 (2022-10-13)

- 修复: 切换 `viewMode` 为 `freedom` 后再切换回 `follower` 没有跟随的问题

## 0.4.47 (2022-10-13)

- 增强: 禁用光标功能时, 不再发送光标移动事件

## 0.4.46 (2022-10-11)

- 修复: `rectangle` `ellipse` `straight` 等教具 icon 同步显示错误的问题

## 0.4.45 (2022-09-19)

- 功能: 添加 `focusApp` 方法

## 0.4.44 (2022-09-15)

- 功能: 添加 `follower` 视角模式
- 功能: 添加 `pencilEraser` 同步光标

## 0.4.43 (2022-08-24)

- 修复: 当注册的 `app` 为 `esm` 时没有 `__esModule` 字段的问题

## 0.4.42 (2022-08-19)

- 修复: 修改 `containerSizeRatio` 后 `app` 的窗口没有更新

## 0.4.41 (2022-08-18)

- 修复: 升级 `@netless/telebox-insider@0.2.27` 修复 ppt 最大化时最小化重新进入再恢复的显示问题

## 0.4.40 (2022-08-12)

- 修复: 适配 `white-web-sdk@2.16.33` 的 `InvisiblePlugin` 类型
- 修复: 修复加载 `url` 的问题

## 0.4.39 (2022-08-11)

- 类型: `Register` 支持 `dynamic import`

## 0.4.38 (2022-08-11)

- 修复: `setContainerSizeRatio` 动态修改比例重复调用会缩小 `camera` 的问题

## 0.4.37 (2022-07-29)

- 修复: 只读用户 Slide 最小化状态下重新进入房间恢复正常无法恢复到正确的大小

## 0.4.36 (2022-07-29)

- 修复: Slide 最小化状态下重新进入房间恢复正常无法恢复到正确的大小

## 0.4.35 (2022-07-06)

- 优化: 降低发送鼠标移动事件的频率
- 修复: 在 `writable` 进行切换的时候 `mainView` 的 `disableCameraTransform` 丢失

## 0.4.34 (2022-06-29)

- 修复: 重连之后 `app` 没有正确创建的问题
- 修复: `app` 创建之后初始化宽高没有同步的问题

## 0.4.33 (2022-06-29)

- 修复: 多人同时调用 `WindowManager.mount` 有概率出现错误的问题
- 修复: 只读用户的重连刷新问题

## 0.4.32 (2022-06-10)

- 功能: `WindowManager.mount` 添加 `applianceIcons` 选项配置光标使用的图片

## 0.4.31 (2022-06-09)

- 修复: `bindContainer` 在回放模式下直接抛出错误的问题

## 0.4.30 (2022-06-08)

- 重构: removePage 在 resolve 之后可以立即查询到正确的状态
- 修复: 重连后 app 创建错误

## 0.4.28-0.4.29 (2022-06-08)

- 修复: `removePage` 可以删除最后一页的问题
- 重构: `removePage` `index` 参数变为可选，默认删除当前页

## 0.4.27 (2022-06-07)

- 添加 `removePage` API
- `storage` 仅在第一次时设置默认状态
- `bindContainer` 在 `room` 非 `Connected` 状态下调用会直接抛出错误

## 0.4.26

1. 修复 `app` 中 `pageStateChange` 事件被多次触发的问题
2. 修复重连之后 `mainView` 显示错误的内容的问题

## 0.4.25

1. 添加 `setContainerSizeRatio` 方法, 用于初始化后更新 `containerSizeRatio`

## 0.4.24

1. `package.json` `main` 指定为 `cjs` 格式

## 0.4.23

1. 修复可写进入立即切换成只读造成初始化 camera 失败的问题

## 0.4.22

1. 修复只读端先加入时视角跟随失败的问题

## 0.4.21

1. 添加 `manager.refresh()` 方法用于从其他房间 `copy` `attributes`
## 0.4.20

1. 导出 Page 相关类型

## 0.4.19

1. 升级 @netless/app-docs-viewer@0.2.9

## 0.4.18

1. 修复设置 viewMode freedom 时, 不能 focus 到主白板的问题

## 0.4.17

1. 修复 safari 浏览器下 removeScenes 为 "/" 没有清理完成完成时可以 addApp

## 0.4.16

1. 修复 removeScenes 为 "/" 没有清理完成完成时 addApp 造成的状态错误

## 0.4.15

1. 修复 removeScenes 为 "/" 时,  切换主白板和 app focus 失效的问题

## 0.4.14

1. 修复 removeScenes 为 "/" 时， 同步端笔迹依旧存在的问题

## 0.4.13

1. 在只读状态时可以切换 `viewMode`

## 0.4.12

1. 升级 `@netless/telebox-insider` 到 `0.2.26`
2. 修复回放时 `seek` app 状态错误的问题

## 0.4.11

1. 升级 `@netless/app-docs-viewer` 到 `0.2.8`
2. 同步注册的 url 的 src 到远端
3. 添加 `pageState` 和 `pageStateChange` 事件
4. 修复 manager 设置初始化 scenePath 错误的问题
5. 添加 `containerSizeRatio` 到 `manager` 实例

## 0.3.27

1. 修复在同时调用多次 `addApp`  时, 先添加的课件不显示的问题

## 0.4.10

1. 修复 `PublicEvent` 类型没有导出的问题

## 0.3.26

1. 修复多次调用 `setWritable` 和 `setReadonly` 导致的状态错误

## 0.4.9

1. 添加 `sceneState` 属性和 `sceneStateChange` 事件
2. 修复刷新后 `dynamic DocsViewer` 页数会切换错误的问题

## 0.4.8

1. 升级 `@netless/telebox-insider` 至 `0.2.25`
2. 修复关闭 app 时可能因为 app 报错导致关闭失败的问题

## 0.4.7

1. 修改 `addPage` 接口

## 0.4.6

1. 升级 `@netless/telebox-insider` 至 `0.2.24`
2. 内置 `video.js` 的 css, 使用视频插件时不再需要手动引入
3. 添加 `addPage` `nextPage` `prevPage`

## 0.4.5
1. 修复 manager 的 `insertText` `insertImage` `completeImageUpload` `lockImage` `lockImages` 没有代理到 `room` 的问题
2. 升级 `@netless/telebox-insider` 至 `0.2.23`
3. 优化双指缩放时光标的位置

## 0.4.4

1. 代理 `room` 的 `insertText` `insertImage` `completeImageUpload` `lockImage` `lockImages` 方法
2. 修复回放时 view didRelease 的报错问题

## 0.4.3

1. 代理 `room` 的 `delete` `copy` `paste` `duplicate` 方法

## 0.4.1

1. 添加 `loadApp` 事件

## 0.4.0

### 功能
1. 在不同窗口中书写不再需要点击窗口进行切换
2. 实现了激光笔教具
3. 添加 `bindContainer` 接口，`mount` 时 `container` 参数不再是必选
4. 添加 `bindCollector` 接口
5. 关闭 `App` 会移除相关的 `Scenes`
6. 添加 `ScenePath` 相同的 `App` 会把这个 `App` 置为最上层
7. `manager.moveCamera` 和 `manager.moveCameraToContain` 会同步到所有端
8. 代理 `room.redo()` `room.undo()` `room.canRedoSteps` `room.canUndoSteps` 以及添加 `canRedoStepsChange` `canUndoStepsChange` 事件
9. 添加 `mainViewScenesLength` 属性和 `mainViewScenesLengthChange` 事件
10. 添加 `manager.cleanCurrentScene()` 方法自动清除当前 `focus` 白板的笔迹

### BreakChange
1. 移除 `WindowManager.mount` 的多参数类型


## 0.3.25

1. 修复创建 APP 之后没有设置默认 `zIndex` 的问题

## 0.3.24

1. 修复重连之后光标不见的问题(注意: 新的光标同步方式会跟 0.3.24 之前的版本不兼容)
2. 修改打包方式, 内部依赖会默认打包
3. 确保重复 mount 之后 `WindowManger` 内部状态正确

## 0.3.23

1. 修复 ios 上 `boxState` 没有正确回调的问题
2. 添加了 `setBoxState` `setMaximized` `setMinimized` 接口

## 0.3.22

1. 升级 `@netless/app-docs-viewer` 优化移动端显存占用
2. 升级 `@netless/telebox-insider` 优化移动端显存占用

## 0.3.19-0.3.21

1. 更新 `@netless/app-docs-viewer`
2. 修复 box `zIndex` 同步的问题

## 0.3.18

1. 修复最小化时刷新页面 box 位置错误的问题

## 0.3.17

1. 同步 box 的 `z-index` 以保持顺序
2. 更新 `telebox-insider` 使用新的 `focus` 和 `blur` api 以保持状态的正确
3. 更新 `@netless/app-docs-viewer@0.1.26` 减少滚动同步频率
4. 修复最小化时没有清理 `focus` 状态的问题
