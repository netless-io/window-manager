
### 注意事项

多窗口模式必须开启白板的 `useMultiViews` 和 `useMobXState` 选项

会造成原本以下 `room` 上的一些方法和 `state` 失效

`方法`

-   `room.bindHtmlElement()` 用 `WindowManager.mount()` 代替
-   `room.scalePptToFit()` 暂无代替,不再推荐调用 `scalePptToFit`
-   `room.setScenePath()` 用 `manager.setMainViewScenePath()` 代替
-   `room.setSceneIndex()` 用 `manager.setMainViewSceneIndex()` 代替

> 为了方便使用 `manager` 替换了 `room` 上的一些方法可以直接对 `mainView` 生效

-   `room.disableCameraTransform`
-   `room.moveCamera`
-   `room.moveCameraToContain`
-   `room.convertToPointInWorld`
-   `room.setCameraBound`

`camera`

-   `room.state.cameraState` 用 `manager.mainView.camera` 和 `manager.mainView.size` 代替

想要监听主白板 `camera` 的变化, 请使用如下方式代替

```javascript
manager.mainView.callbacks.on("onCameraUpdated", camera => {
    console.log(camera);
});
```

监听主白板 `size` 变化

```javascript
manager.mainView.callbacks.on("onSizeUpdated", size => {
    console.log(size);
});
```

