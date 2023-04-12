### Precautions

Multi-window mode must enable whiteboard `useMultiViews` and `useMobXState` options

It will cause some methods and `state` on the following `room` to fail

`method`

- `room.bindHtmlElement()` is replaced by `WindowManager.mount()`
- There is no replacement for `room.scalePptToFit()`, calling `scalePptToFit` is no longer recommended
- `room.setScenePath()` is replaced by `manager.setMainViewScenePath()`
- `room.setSceneIndex()` is replaced by `manager.setMainViewSceneIndex()`

> In order to use `manager` to replace some methods on `room`, it can directly take effect on `mainView`

- `room.disableCameraTransform`
- `room.moveCamera`
- `room.moveCameraToContain`
- `room.convertToPointInWorld`
- `room.setCameraBound`

`camera`

- `room.state.cameraState` is replaced by `manager.mainView.camera` and `manager.mainView.size`

If you want to monitor the main whiteboard `camera` changes, please use the following method instead

```javascript
manager.mainView.callbacks.on("onCameraUpdated", camera => {
     console.log(camera);
});
```

Monitor main whiteboard `size` changes

```javascript
manager.mainView.callbacks.on("onSizeUpdated", size => {
     console.log(size);
});
```

<br>

## `white-web-sdk` migrated from `2.15.x` to `2.16.x`

### `room.setMemberState`

This method can be called directly after waiting for `WindowManager` to be mounted when multi-window is enabled.

Or use `manager.mainView.setMemberState` instead

<br>

### `room.pptPreviousStep` `room.pptNextStep` Switch to the next page

`pptPreviousStep` and `pptNextStep` no longer work due to changes in window implementation

If you need to switch the top and bottom pages of the main whiteboard, please use `manager.nextPage` and `manager.prevPage`
