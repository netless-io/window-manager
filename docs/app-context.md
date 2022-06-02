## AppContext

-   [api](#api)
    - [view](#view)
    - [page](#page)
    - [storage](#storage)
-   [events](#events)

<h2 id="api">API</h2>

- **context.appId**

    插入 `app` 时生成的唯一 ID

    ```ts
    const appId = context.appId;
    ```

- **context.getDisplayer()**

    在默认情况下 `Displayer` 为白板的 `room` 实例

    回放时则为 `Player` 实例

    ```ts
    const displayer = context.getDisplayer();

    assert(displayer, room); // 互动房间
    assert(displayer, player); // 回放房间
    ```


- **context.getIsWritable()**

    获取当前状态是否可写

    ```ts
    // isWritable === (room.isWritable && box.readonly)
    const isWritable = context.getIsWritable();
    ```

- **context.getBox()**

    获取当前 app 的 box

    ```ts
    const box = context.getBox();

    box.$content; // box 的 main element
    box.$footer;
    ```

<h3 id="view">View</h3>

`view` 可以理解为一块白板，可以从 `context` 中拿到这个实例并挂载到 `Dom` 中

- **context.getView()**

    获取 `view` 实例

    ```ts
    const view = context.getView();
    ```

- **context.mountView()**

    挂载 view 到指定 dom

    ```ts
    context.mountView(element);
    ```

- **context.getScenes()**

    `scenes` 在 `addApp` 时传入 `scenePath` 会由 `WindowManager` 创建

    ```ts
    const scenes = context.getScenes();
    ```

- **context.setScenePath()**

    切换当前 `view` 到指定的 `scenePath`

    ```ts
    context.setScenePath("/page/2");
    ```


<h3 id="page">Page</h3>

`Page` 是封装后 `scenes` 的一些概念

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

- **context.pageState**

    获取当前所在的 `index` 和一共有多少页

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

- **createStorage()**

    同时你也可以创建多个 `storage` 实例

    ```ts
    const defaultState = { count: 0 } // 可选
    const storage = context.createStorage("store1", defaultState);
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
