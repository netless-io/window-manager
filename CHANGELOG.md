## 0.4.0

1. 废弃 `WindowManager.mount` 的多参数类型
2. 添加 `bindContainer` 接口，`mount` 时 `container` 参数不再是必选
3. 关闭 `App` 会移除相关的 `Scenes`
4. 添加 `ScenePath` 相同的 `App` 会把这个 `App` 置为最上层
5. 代理 `room.putScenes` 和 `room.removeScenes`

## 0.3.19-0.3.21

1. 更新 `@netless/app-docs-viewer`
2. 修复 box zIndex 同步的问题

## 0.3.18

1. 修复最小化时刷新页面 box 位置错误的问题

## 0.3.17

1. 同步 box 的 `z-index` 以保持顺序
2. 更新 `telebox-insider` 使用新的 `focus` 和 `blur` api 以保持状态的正确
3. 更新 `@netless/app-docs-viewer@0.1.26` 减少滚动同步频率
4. 修复最小化时没有清理 `focus` 状态的问题
