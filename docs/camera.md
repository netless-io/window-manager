# 视角
在多窗口模式下, 可以同时存在多块白板，但是大多数情况下用户都只需要对主白板也就是 `mainView` 进行操作


## 获取 `mainView` 的 `camera`
```typescript
manager.mainView.camera
```

## 获取 `mainView` 的 `size`
```typescript
manager.mainView.size
```

## 监听 `mainView` 的 `camera` 变化
```typescript
manager.mainView.callbacks.on("onCameraUpdated", camera => {
    // 更新后的 camera
})
```

## 监听 `mainView` 的 `size` 的变化
```typescript
manager.mainView.callbacks.on("onSizeUpdated", camera => {
    // 更新后的 size
})
```

## 通过 `api` 移动 `camera`
```typescript
manager.moveCamera(camera)
```

## 设置视角边界
把所有人的视角限制在以世界坐标 (0, 0) 为中心，宽为 1024，高为 768 的矩形之中。
```typescript
manager.setCameraBound({
    centerX: 0,
    centerY: 0,
    width: 1024,
    height: 768,
})
```

## 禁止/允许 `mainView` `camera` 的移动，缩放
```typescript
// 禁止 `camera` 移动,缩放
manager.mainView.disableCameraTransform = false

// 恢复 `camera` 移动,缩放
manager.mainView.disableCameraTransform = true
```

