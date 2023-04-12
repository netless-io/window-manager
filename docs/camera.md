# view angle
In multi-window mode, multiple whiteboards can exist at the same time, but in most cases users only need to operate on the main whiteboard, which is `mainView`


## Get `camera` of `mainView`
```typescript
manager.mainView.camera
```

## Get `size` of `mainView`
```typescript
manager.mainView.size
```

## Monitor `camera` changes in `mainView`
```typescript
manager.mainView.callbacks.on("onCameraUpdated", camera => {
     // updated camera
})
```

## Monitor the change of `size` of `mainView`
```typescript
manager.mainView.callbacks.on("onSizeUpdated", camera => {
     // updated size
})
```

## Move `camera` via `api`
```typescript
manager.moveCamera(camera)
```

## Set view bounds
Limit everyone's viewing angle to a rectangle centered at world coordinates (0, 0) with a width of 1024 and a height of 768.
```typescript
manager.setCameraBound({
     centerX: 0,
     centerY: 0,
     width: 1024,
     height: 768,
})
```

## Prohibit/allow movement and scaling of `mainView` `camera`
```typescript
// Prohibit `camera` from moving and zooming
manager.mainView.disableCameraTransform = false

// restore `camera` movement, scaling
manager.mainView.disableCameraTransform = true
```