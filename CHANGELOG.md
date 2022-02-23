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
