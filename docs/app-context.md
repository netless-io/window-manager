## AppContext

- [api](#api)
    - [view](#view)
    - [page](#page)
    - [storage](#storage)
- [属性](#attributes)
- [box](#box)
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
    const view = context.createWhiteBoardView({ size: 10 }); // 生成带有 10 页的白板
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
  - **setRect**

    设置白板的显示的宽高\
    在不同分辨率下会保证所有打开的窗口都能完整显示这个区域

    ```ts
    const view = context.createWhiteBoardView();
    // 此方法建议只在插入时设置一次
    if (context.isAddApp) {
        view.setRect({ width: 500, height: 500 })
    }
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

<h2 id="attributes">属性</h2>

- **destroyed**

    当前应用是否已经被销毁

    类型: `boolean`

    ```ts
    contest.destroyed
    ```

- **members**
    
    当前房间的所有用户

    类型: `Member[]`

    ```ts
    type Member = {
        uid: string;
        memberId: number;
        memberState: MemberState;
        session: string;
        payload?: UserPayload;
    }
    ```

- **currentMember**

    当前用户

    类型: `Member`

    ```ts
    context.currentMember
    ```


<h2 id="box">box</h2>

    `box` 为应用窗口本身

    类型: `ReadonlyTeleBox`

- **mountStyles()**

    挂载样式到 `box` 上

    参数: `string | HTMLStyleElement`

    ```ts
    box.mountStyles(`
        .hello-world-app span {
            color: red;
        }
    `);
    ```

- **mountContent()**

    挂载元素到 `box` 中\
    推荐使用 `mountStage` 方法挂载元素到 `stage` 中

    参数: `HTMLElement`

    ```ts
    const app = document.createElement("div");
    box.mountContent(app);
    ```

- **mountStage()**

    挂载元素到 `box` 的 `contentStage` 中\
    如无特殊情况, 推荐把所有内容挂载到 `stage` 中

    参数: `HTMLElement`

    ```ts
    const app = document.createElement("div");
    box.mountStage(app);
    ```

- **contentStageRect**

    可同步区域\
    在这个区域中的内容, `WindowManager` 会确保所有的端都可以看到

    类型: `TeleboxRect`

    ```ts
    interface TeleboxRect {
        readonly x: number;
        readonly y: number;
        readonly width: number;
        readonly height: number;
    }
    ```

    ```ts
    box.contentStageRect
    ```

    订阅 `contextStateRect` 的变化

    ```ts
    box.onValChanged("contentStageRect", rect => {
        console.log("contentStageRect changed", rect);
    });
    ```

- **highlightStage**

    是否高亮 `stage` 区域\
    默认为 `true`

    类型: `boolean`

- **setHighlightStage()**

    参数: `boolean`


- **$content**

    应用窗口的内容区域

    类型: `HTMLElement`

- **$footer**

    应用窗口的底部区域

    类型: `HTMLElement`

- **resizable**

    是否可以改变窗口大小

    类型: `boolean`

- **draggable**

    窗口是否可以拖动

    类型: `boolean`


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