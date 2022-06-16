## AppContext

- [api](#api)
    - [view](#view)
    - [page](#page)
    - [storage](#storage)
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

- **context.displayer**

    在默认情况下 `Displayer` 为白板的 `room` 实例

    回放时则为 `Player` 实例

    ```ts
    const displayer = context.displayer;

    assert(displayer, room); // 互动房间
    assert(displayer, player); // 回放房间
    ```


- **context.isWritable**

    获取当前状态是否可写\
    可以通过监听 `writableChange` 事件获取可写状态的改变

    ```ts
    const isWritable = context.isWritable;
    ```

- **context.box**

    获取当前 app 的 box

    类型: `ReadonlyTeleBox`

    ```ts
    const box = context.box;

    box.$content; // box 的 main element
    box.$footer;
    ```

<h3 id="view">创建白板</h3>

当应用想要一个可以涂画的白板，可以使用以下接口

- **context.createWhiteBoardView()**

    创建白板

    返回: `WhiteBoardView`

    ```ts
    const view = context.createWhiteBoardView();
    ```

    ```ts
    const view = context.createWhiteBoardView(10); // 生成带有 10 页的白板
    ```

- **WhiteBoardView**

  白板实例

  白板有多页的概念, 可以通过以下接口添加，切换，以及删除

  - **addPage()**

      添加一页至白板

      ```ts
      const view = context.createWhiteBoardView();
      view.addPage() // 默认在最后添加一页
      context.addPage({ after: true }) // 在当前页后添加一页
      context.addPage({ scene: { name: "page2" } }) // 传入 page 信息
      ```

  - **nextPage()**

      上一页

      ```ts
      const view = context.createWhiteBoardView();
      view.nextPage();
      ```

  - **prevPage()**

      下一页

      ```ts
      const view = context.createWhiteBoardView();
      view.prevPage();
      ```
  - **removePage()**

      删除一页

      ```ts
      const view = context.createWhiteBoardView();
      view.removePage() // 默认删除当前页
      view.removePage(1) // 也可以指定 index 删除
      ```

  - **pageState**

    类型: `PageState`

    ```ts
    type PageState {
        index: number
        length: number
    }
    ```

    ```ts
    const view = context.createWhiteBoardView();
    view.pageState // PageState
    ```

  - **pageState$**

    订阅 `pageState` 的变化

    ```ts
    const view = context.createWhiteBoardView();
    view.pageState$.subscribe(pageState => {
        console.log("pageStateChange", pageState)
    })
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

<h2 id="Advanced">Advanced</h2>

- **context.getView()**

    获取 `view` 实例

    ```ts
    const view = context.view;
    ```