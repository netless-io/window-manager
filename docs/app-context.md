## AppContext

- [api](#api)
- [events](#events)

<h2 id="api">API</h2>

### appId

插入 `app` 时生成的唯一 ID

```ts
const appId = context.appId
```

### getDisplayer

在默认情况下 `Displayer` 为白板的 `room` 实例

回放时则为 `Player` 实例

```ts
const displayer = context.getDisplayer()

assert(displayer, room) // 互动房间
assert(displayer, player) // 回放房间
```

### getScenes

`scenes` 在 `addApp` 时传入 `scenePath` 会由 `WindowManager` 创建

```ts
const scenes = context.getScenes()
```

### getView

`View` 为白板中一块可标注部分

```ts
const view = context.getView()
```

### getIsWritable

获取当前状态是否可写

```ts
// isWritable === (room.isWritable && box.readonly)
const isWritable = context.getIsWritable()
```

### getBox

获取当前 app 的 box

```ts
const box = context.getBox()

box.$content // box 的 main element
box.$footer
```

### setScenePath

切换当前 `view` 的 `scenePath`

```ts
context.setScenePath("/page/2")
```

### mountView

挂载 view 到指定 dom

```ts
context.mountView(ref)
```

### addPage

```ts
context.addPage()
```

### nextPage

```ts
context.nextPage()
```

### prevPage

```ts
context.prevPage()
```

### pageState

```ts
context.pageState
```


<h2 id="events">events</h2>

### destroy

app 被关闭时发送的事件

```ts
context.emitter.on("destroy", () => {
    // release your listeners
})
```

### writableChange

白板可写状态切换时触发

```ts
context.emitter.on("writableChange", isWritable => {
    //
})
```

### focus

当前 app 获得焦点或者失去焦点时触发

```ts
context.emitter.on("focus", focus => {
    //
})
```
