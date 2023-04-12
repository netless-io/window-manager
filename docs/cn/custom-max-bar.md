## 如何自定义最大化 `titleBar`

获取并订阅所有的 `box`

```js
manager.boxManager.teleboxManager.boxes$.subscribe(boxes => {
    // boxes 为所有的窗口，当窗口添加和删除时都会触发
})
```

切换 `box` 的 `focus`
```js
manager.boxManager.teleBoxManager.focusBox(box)
```

关闭某个 `box`
```js
manager.boxManager.teleBoxManager.remove(box)
```

切换最大化状态
```js
manager.boxManager.teleBoxManager.setMaximized(false)
manager.boxManager.teleBoxManager.setMaximized(true)
```

切换最小化状态
```js
manager.boxManager.teleBoxManager.setMinimized(true)
manager.boxManager.teleBoxManager.setMaximized(false)
```