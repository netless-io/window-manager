## AppContext

    `AppContext` 是插件运行时传入的上下文
    你可以通过此对象操作 APP 的 ui, 获取当前房间的状态, 以及订阅状态的变化

- [api](#api)
    - [view](#view)
    - [page](#page)
    - [storage](#storage)
- [ui(box)](#box)
- [events](#events)
- [Advanced](#Advanced)

<h2 id="api">API</h2>

- **context.appId**

    插入 `app` 时生成的唯一 ID

    ```ts
    const appId = context.appId;
    ```

- **context.isReplay**
    
    类型: `boolean`
    
    当前是否回放模式

- **context.getDisplayer()**

    在默认情况下 `Displayer` 为白板的 `room` 实例

    回放时则为 `Player` 实例

    ```ts
    const displayer = context.getDisplayer();

    assert(displayer, room); // 互动房间
    assert(displayer, player); // 回放房间
    ```


- **context.getIsWritable()**

    获取当前状态是否可写\
    可以通过监听 `writableChange` 事件获取可写状态的改变

    ```ts
    const isWritable = context.getIsWritable();
    ```

- **context.getBox()**

    获取当前 app 的 box

    ```ts
    const box = context.getBox();

    box.$content; // box 的 main element
    box.$footer;
    ```

<h3 id="view">挂载白板</h3>

当应用想要一个可以涂画的白板，可以使用以下接口

- **context.mountView()**

    挂载白板到指定 dom

    ```ts
    context.mountView(element);
    ```

**注意** 在调用 `manager` 的 `addApp` 时必须填写 `scenePath` 才可以使用 `view`
```ts
manager.addApp({
    kind: "xxx",
    options: { // 可选配置
        scenePath: "/example-path"
    }
})
```

<h3 id="page">Page</h3>

白板有多页的概念, 可以通过以下接口添加，切换，以及删除

- **context.addPage()**

    添加一页至 `view`

    ```ts
    context.addPage() // 默认在最后添加一页
    context.addPage({ after: true }) // 在当前页后添加一页
    context.addPage({ scene: { name: "page2" } }) // 传入 page 信息
    ```

- **context.nextPage()**

    上一页

    ```ts
    context.nextPage();
    ```

- **context.prevPage()**

    下一页

    ```ts
    context.prevPage();
    ```
- **context.removePage()**

    删除一页

    ```ts
    context.removePage() // 默认删除当前页
    context.removePage(1) // 也可以指定 index 删除
    ```

- **context.pageState**

    获取当前所在的 `index` 和一共有多少页\
    当想要监听 `pageState` 的变化时, 可以监听 `pageStateChange` 事件获取最新的 `pageState`

    ```ts
    context.pageState;
    // {
    //     index: number,
    //     length: number,
    // }
    ```

<h3 id="storage">storage</h3>

存储和同步状态，以及发送事件的一系列集合

- **context.storage**

    默认创建的 storage 实例

    ```ts
    context.storage
    ```

- **context.createStorage(namespace)**

    同时你也可以创建多个 `storage` 实例
    
    返回: `Storage<State>`

    ```ts
    type State = { count: number };
    const defaultState = { count: 0 };
    const storage = context.createStorage<State>("store1", defaultState);
    ```

- **storage.state**

  类型: `State`\
  默认值: `defaultState`

  在所有客户端之间同步的状态，调用 `storage.setState()` 来改变它。

- **storage.ensureState(partialState)**

  确保 `storage.state` 包含某些初始值，类似于执行了：

  ```js
  // 这段代码不能直接运行，因为 app.state 是只读的
  storage.state = { ...partialState, ...storage.state };
  ```

  **partialState**

  类型: `Partial<State>`

  ```js
  storage.state; // { a: 1 }
  storage.ensureState({ a: 0, b: 0 });
  storage.state; // { a: 1, b: 0 }
  ```

- **storage.setState(partialState)**

  和 React 的 `setState` 类似，更新 `storage.state` 并同步到所有客户端。

  当设置某个字段为 `undefined` 时，它会被从 `storage.state` 里删除。

  > - 状态同步所需的时间和网络状态与数据大小有关，建议只在 state 里存储必须的数据。

  **partialState**

  类型: `Partial<State>`

  ```js
  storage.state; //=> { count: 0, a: 1 }
  storage.setState({ count: storage.state.count + 1, b: 2 });
  storage.state; //=> { count: 1, a: 1, b: 2 }
  ```

- **storage.addStateChangedListener(listener)**

  它在有人调用 `storage.setState()` 后触发 (包含当前 `storage`)

  返回: `() => void`

  ```js
  const disposer = storage.addStateChangedListener(diff => {
    console.log("state changed", diff.oldValue, diff.newValue);
    disposer(); // remove listener by calling disposer
  });
  ```

- **context.dispatchMagixEvent(event, payload)**

  向其他客户端广播事件消息

  ```js
  context.dispatchMagixEvent("click", { data: "data" });
  ```

- **context.addMagixEventListener(event, listener)**

  当接收来自其他客户端的消息时(当其他客户端调用'context.dispatchMagixEvent()`时), 它会被触发

  返回: `() => void` a disposer function.

  ```js
  const disposer = context.addMagixEventListener("click", ({ payload }) => {
    console.log(payload.data);
    disposer();
  });

  context.dispatchMagixEvent("click", { data: "data" });
  ```

<h2>UI (box)</h2>

    box 是白板为所有应用默认创建的 UI
    应用所有可以操作的 UI 部分都在 box 范围内

- **context.getBox()**

    获取 box
    返回类型: `ReadonlyTeleBox`

- **box.mountStyles()**

    挂载样式到 `box`
    参数: `string | HTMLStyleElement`

    ```js
    const box = context.getBox();
    box.mountStyles(`
        .app-span {
            color: red;
        }
    `)
    ```

- **box.mountContent()**

    挂载元素到 `box`
    参数: `HTMLElement`

    ```js
    const box = context.getBox();
    const content = document.createElement("div");
    box.mountContent(context);
    ```

- **box.mountFooter()**

    挂载元素到 `box` 的 `footer`
    参数: `HTMLElement`

    ```js
    const box = context.getBox();
    const footer = document.createElement("div");
    box.mountFooter(context);
    ```

<h2 id="events">events</h2>

- **destroy**

    app 被关闭时发送

    ```ts
    context.emitter.on("destroy", () => {
        // release your listeners
    });
    ```

- **writableChange**

    白板可写状态切换时触发

    ```ts
    context.emitter.on("writableChange", isWritable => {
        //
    });
    ```

- **focus**

    当前 app 获得焦点或者失去焦点时触发

    ```ts
    context.emitter.on("focus", focus => {
        //
    });
    ```

- **pageStateChange**

    `PageState`

    ```ts
    type PateState {
        index: number;
        length: number;
    }
    ```

    当前页数和总页数变化时触发

    ```ts
    context.emitter.on("pageStateChange", pageState => {
        // { index: 0, length: 1 }
    });
    ```
- **roomStageChange**

    房间的状态变化时触发\
    比如当教具切换时

    ```js
    context.emitter.on("roomStageChange", stage => {
        if (state.memberState) {
            console.log("appliance change to", state.memberState.currentApplianceName);
        }
    });
    ```

    或者是当前房间人数变化时

    ```js
     context.emitter.on("roomStageChange", stage => {
        if (state.roomMembers) {
            console.log("current room members change", state.roomMembers);
        }
    });
    ```
    详细状态的介绍请参考 https://developer.netless.link/javascript-zh/home/business-state-management

<h2 id="Advanced">Advanced</h2>

- **context.getView()**

    获取 `view` 实例

    ```ts
    const view = context.getView();
    ```