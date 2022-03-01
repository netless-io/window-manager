## 进阶使用

- 目录
  - [撤销重做](#redo-undo)
  - [清屏](#clean-current-scene)
  - [判断是否打开某种 APP](#has-kind)


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
