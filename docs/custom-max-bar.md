## How to customize maximized `titleBar`

Get and subscribe to all `box`

```js
manager.boxManager.teleboxManager.boxes$.subscribe(boxes => {
     // boxes are all windows, trigger when windows are added and deleted
})
```

Toggle `focus` of `box`
```js
manager.boxManager.teleBoxManager.focusBox(box)
```

close a `box`
```js
manager.boxManager.teleBoxManager.remove(box)
```

Toggle maximized state
```js
manager.boxManager.teleBoxManager.setMaximized(false)
manager.boxManager.teleBoxManager.setMaximized(true)
```

Toggle minimized state
```js
manager.boxManager.teleBoxManager.setMinimized(true)
manager.boxManager.teleBoxManager.setMaximized(false)
```