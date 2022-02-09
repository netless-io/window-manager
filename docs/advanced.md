## 进阶使用

- 目录
  - [撤销重做]



<h3>撤销重做</h3>

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

