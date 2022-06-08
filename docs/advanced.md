## 进阶使用

- 目录
  - [撤销重做](#redo-undo)
  - [清屏](#clean-current-scene)
  - [判断是否打开某种 APP](#has-kind)
  - [页面控制器](#page-control)
  - [视角](#view-mode)
  - [插入图片到当前app](#insert-image-to-app)


<h3 id="redo-undo">撤销重做</h3>

> 以下事件和属性都会根据 `focus` 的窗口来进行自动切换应用对象

#### 获取可以撤销/重做的步数

```ts
manager.canUndoSteps
manager.canRedoSteps
```

#### 监听可以撤销/重做的步数的变化

`canRedoStepsChange` 和 `canUndoStepsChange` 会在切换窗口时重新触发

```ts
manager.emitter.on("canUndoStepsChange", (steps: number) => {
    // 可以撤销的步数更新
})
manager.emitter.on("canRedoStepsChange", (steps: number) => {
    // 可以重做的步数更新
})
```

#### 撤销/重做

```ts
manager.undo() //撤销
manager.redo() // 重做 
```

<br>

<h3 id="clean-current-scene">清屏</h3>

因为在多窗口模式下有多个白板, 如果想要清除当前 `focus` 的白板只需要调用

```ts
manager.cleanCurrentScene()
```

只想清理主白板的笔迹则需要

```ts
manager.mainView.cleanCurrentScene()
```


<br>

<h3 id="has-kind">判断是否打开某种 APP</h3>

```ts
manager.emitter.on("ready", () => { // ready 事件在所有 app 创建完成后触发
    const apps = manager.queryAll(); //  获取所有已经打开的 App
    const hasSlide = apps.some(app => app.kind === "Slide"); // 判断已经打开的 APP 中是否有 Slide
});
```

<br>

<h3 id="page-control">页面控制器</h3>

`manager` 提供了一个 `pageState` 来获取当前的 index 和总页数

```ts
manager.pageState.index // 当前的 index
manager.pageState.length // 总页数

manager.emitter.on("pageStateChange", state => {
    // 当前 index 变化和总页数变化会触发此事件
});
```

上一页/下一页/添加一页

```ts
manager.nextPage()
manager.prevPage()
manager.addPage()
```

<br>

<h3 id="view-mode">视角跟随</h3>

多窗口中 `ViewMode` 有 `broadcaster` `freedom` 两种模式

- `freedom`

    自由模式，用户可以自由放缩、移动视角

    即便房间里有主播，主播也无法影响用户的视角

- `broadcaster`

    主播模式, 操作时其他人的视角都会跟随我

    同时其他为 `broadcaster` 模式的人也会影响我的视角

    在 `isWritable` 为 `false` 时只会跟随其他 `broadcaster` 的视角

<br>

<h3 id="insert-image-to-app">插入图片到当前 app</h3>

```ts
// 判断当前是否为最大化
if (manager.boxState === "maximized") {
    // `focused` 的值的会根据当前 focus 的 app 不同而变化
    const app = manager.queryOne(manager.focused)
    // 有 view 的 app 才可以插入图片, 像是 视频，音频之类的 app 是没有 view 的
    if (app.view) {
        var imageInformation = {
            uuid: uuid,
            centerX: centerX,
            centerY: centerY,
            width: width,
            height: height,
            locked: false,
        };
        app.view.insertImage(imageInformation);
        app.view.completeImageUpload(uuid, src);
    }
}
```
