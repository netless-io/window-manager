# WB-440 课件与主白板统一分页接口需求设计

> 状态：已完成首轮代码落地，待三端资源同步与运行探针。
> 日期：2026-08-26
> 需求链接：[WB-440](https://jira.agoralab.co/browse/WB-440)

## 1. 结论摘要

本需求的核心不是在每个 App 中再增加一套翻页实现，而是把“当前可操作内容”的分页命令收敛到 `window-manager` 的统一路由层，再由 `Whiteboard-bridge` 和 iOS、Android、Harmony Native SDK 以一致的公开命名输出。

本稿推荐采用三类 API，并由一个统一状态事件同时承载状态对账和 accepted 后的终态失败：

1. 新增异步的统一入口 `dispatchPageEvent`，目标可以是当前焦点 App 或 `mainView`，覆盖动态 PPT、静态 PPT 和主白板。
2. 新增异步的统一查询入口 `getPageState`，返回当前页码和总页数；对外统一使用 1-based `page` 与实际数量语义的 `pageCount`。
3. 保留现有 `dispatchDocsEvent` 作为文档 App 兼容入口，语义不变，不把同步返回值悄悄改成 Promise；主白板增页使用已有的 `manager.addPage()`。
4. 新增 `unifiedPageStateChange`，通过 `status: "pending" | "success" | "failure"` 区分 Slide 临时对账、确认成功和 controller 终态失败；不再增加独立失败事件。

这样可以解决主白板异步切页与文档 App 同步控制之间的返回值冲突，也避免破坏已有 Native 和 Web 调用方。若产品确认必须只保留一个公开入口，则应在评审时明确接受 `dispatchDocsEvent` 改为异步的破坏性变更。

## 2. 输入与证据边界

### 2.1 已核对的代码

| 层级 | 当前实现 | 关键事实 |
| --- | --- | --- |
| `window-manager` | `src/index.ts` | `dispatchDocsEvent` 已路由 DocsViewer、Presentation、Slide；`nextPage`/`prevPage`/`jumpPage` 只操作 `mainView`。 |
| 主白板 | `src/index.ts`、`src/View/MainView.ts`、`src/Page/PageController.ts` | WindowManager 的权威入口是 `manager.pageState`、`manager.nextPage()`、`manager.prevPage()`、`manager.addPage()`；页面状态为 0-based `index` + `length`，切页和增页由 `AppManager` 异步完成。 |
| 动态 PPT | `slide-app/packages/app-slide/src/index.ts` | 暴露 `nextPage`、`prevPage`、`nextStep`、`prevStep`、`jumpToPage`；Slide 页码为 1-based，返回同步 `boolean`。 |
| 静态 PPT | `netless-app-presentation/src/app-presentation.ts` | 暴露 `nextPage`、`prevPage`、`jumpPage(index)`；内部 index 为 0-based，无动画 step。 |
| Bridge | `Whiteboard-bridge/src/bridge/Room.ts` | `room.dispatchDocsEvent` 只调用 WindowManager 的同名方法；`room.nextPage`/`prevPage` 是 Native/Bridge 转发层，在多窗口模式下调用 `manager.nextPage`/`prevPage`，即只操作主白板。 |
| Android | `Room.dispatchDocsEvent`、`WindowDocsEvent` | 已有 `dispatchDocsEvent`、`nextPage`、`prevPage`；事件的 `page` 为 1-based。 |
| iOS | `WhiteRoom.dispatchDocsEvent:options:completionHandler:` | 已有同名文档事件 API；`WhiteWindowDocsEventOptions.page` 为 1-based。 |
| Harmony | `WhiteboardController.dispatchDocsEvent`、`WindowDocsEventOptions` | 已有同名 API，但类型当前使用 `pageIndex?`，Bridge 实际读取的是 `page`，存在跳页参数不一致风险。 |

### 2.2 Jira 读取状态

本次按要求使用了本地 `atlassian-cli`（`~/.local/bin/atlassian`）读取 WB-440，但 Jira 返回 `Login Required / You do not have the permission to see the specified issue`；工作区也没有 `~/my-auth.json`。因此本稿中的“需求语义”仅依据用户描述和代码现状整理，不能替代 Jira 原文。恢复认证后，必须重新核对 issue 的验收标准、是否要求保留 `dispatchDocsEvent`、以及是否要求新增独立 API 名称。

## 3. 问题定义

当前有三套页面体系：

1. `mainView`：主白板场景页。
2. `Slide`：动态 PPT 页和动画 step。
3. `Presentation`：静态 PPT 页。

它们的内部控制器名称、页码基准和返回值不同：

| 目标 | 上一页/下一页 | 跳页 | 页码基准 | 当前路由 |
| --- | --- | --- | --- | --- |
| mainView | `manager.prevPage()` / `manager.nextPage()` | `manager.jumpPage(index)` | index 0-based | Bridge 的 `room.prevPage` / `room.nextPage` 转发到上述 manager API |
| Slide | `appResult.prevPage()` / `nextPage()` | `jumpToPage(page)` | page 1-based | `dispatchDocsEvent` |
| Presentation | `controller.prevPage()` / `nextPage()` | `jumpPage(index)` | controller index 0-based；外部 docs 事件为 1-based | `dispatchDocsEvent` |

因此存在三个实际问题：

- Native 调用 `room.nextPage` 时，即使当前焦点是 PPT App，多窗口 Bridge 仍然只切换主白板。
- Web / Native 要根据目标类型选择 `nextPage`、`dispatchDocsEvent`、`setSceneIndex` 等不同入口。
- Harmony 的 `pageIndex` 与 Bridge 的 `page` 命名不一致，跨端跳页无法形成稳定契约。
- 三类目标的当前页和总页数来源不同，且 mainView/Presentation 内部使用 0-based index，不能把内部 `pageState` 原样透传给 Native。

## 4. 设计目标与非目标

### 4.1 目标

- 在 `window-manager` 内部统一解析目标、校验参数、转换 0/1-based 页码并调用各 App 适配器。
- 动态 PPT、静态 PPT、主白板都能通过同一套事件命名控制上一页、下一页和跳页。
- 动态 PPT、静态 PPT、主白板都能通过同一查询接口获得当前页码和总页码。
- mainView 可以通过既有 `manager.addPage()` 增加页面，并由 Bridge/Native 对外提供同名 `addPage` 能力。
- iOS、Android、Harmony 对外使用同一个方法名、事件名、参数字段和成功返回语义。
- 保留旧 `dispatchDocsEvent` 与 `room.nextPage`/`prevPage` 的兼容行为，给出明确迁移路径。
- 明确未加载、无焦点、只读、越界、动画未结束时的失败行为。

### 4.2 非目标

- 不把主白板的缩放强行解释为 PPT `scalePage`；主白板缩放仍使用 camera API。
- 不在本期新增通用 App 的分页协议；新增统一接口只支持已知 `Slide`、`netless-app-presentation` 和 `mainView`。DocsViewer 不在本期范围内。
- 不新增动画 step 查询；当前三端没有稳定的公开 step index 回调。
- 不修改 `appliance-plugin` Worker 或渲染实现。它只负责承载 `mainView`，分页路由属于 WindowManager。

## 5. 推荐公开契约

### 5.1 WindowManager Web API

新统一接口的页码基准固定为 1-based：第一页永远是 `page: 1`。`pageCount` 表示实际总页数（即 totalPage 的数量语义），不是最后一页的索引；只有一页时返回 `{ page: 1, pageCount: 1 }`，三页最后一页返回 `{ page: 3, pageCount: 3 }`。

```ts
export type PageEvent =
  | "prevPage"
  | "nextPage"
  | "prevStep"
  | "nextStep"
  | "jumpToPage";

/** "mainView" 或具体的 Slide / netless-app-presentation appId。 */
export type PageEventTarget = string;

export interface PageEventOptions {
  /** "mainView" 或已存在的 Slide / netless-app-presentation appId。 */
  target?: PageEventTarget;
  /** jumpToPage 使用 1-based 页码；第一页传 1。 */
  page?: number;
}

dispatchPageEvent(event: PageEvent, options?: PageEventOptions): Promise<boolean>;

export interface PageStateOptions {
  /** "mainView" 或已存在的 Slide / netless-app-presentation appId。 */
  target?: PageEventTarget;
}

getPageState(options?: PageStateOptions): Promise<UnifiedPageState>;

/** MainView-only page insertion; preserves the existing WindowManager signature. */
manager.addPage(params?: {
  after?: boolean;
  scene?: SceneDefinition;
}): Promise<void>;

export interface UnifiedPageState {
  target: "mainView" | "Slide" | "Presentation";
  appId?: string;
  /** 1-based current page number; first page is 1. */
  page: number;
  /** Actual total page count; for N pages this is N, not N - 1. */
  pageCount: number;
}

export type UnifiedPageStateObservation = UnifiedPageState & {
  /** pending 仅表示 Slide 双来源暂未一致。 */
  status: "pending" | "success";
  /** 以下来源页码均为 1-based，并按 target 出现。 */
  mainView?: number;
  presentation?: number;
  view?: number;
  slide?: number;
};

export type UnifiedPageStateFailure = UnifiedPageState & {
  status: "failure";
  event: PageEvent;
  reason: "commandFailed";
  message?: string;
};

export type UnifiedPageStateChange = UnifiedPageStateObservation | UnifiedPageStateFailure;

manager.emitter.on("unifiedPageStateChange", (state: UnifiedPageStateChange) => {});
```

三类目标使用同一个事件名和对象结构，完整 payload 示例：

```ts
// mainView
{ target: "mainView", page: 2, pageCount: 3, status: "success", mainView: 2 }

// netless-app-presentation
{ target: "Presentation", appId: "Presentation-1", page: 2, pageCount: 3,
  status: "success", presentation: 2 }

// app-slide：View 与 Slide 尚未一致
{ target: "Slide", appId: "Slide-1", page: 2, pageCount: 3,
  status: "pending", view: 1, slide: 2 }

// app-slide：View 与 Slide 已一致
{ target: "Slide", appId: "Slide-1", page: 2, pageCount: 3,
  status: "success", view: 2, slide: 2 }

// controller 已接受命令后异步失败
{ target: "Slide", appId: "Slide-1", page: 2, pageCount: 3,
  status: "failure", event: "nextPage", reason: "commandFailed" }
```

统一输入只使用一个目标字段，不存在独立 `appId`，也不存在 `target: "focused"` sentinel。`target === "mainView"` 时选择主白板；其他非空 `target` 直接作为 Slide / netless-app-presentation appId；未传 `target` 时选择当前 focused App，没有 focused App 时回退 `mainView`。显式 `target: "mainView"` 可避免焦点变化造成误操作。

`addPage` 不作为 `PageEvent` 的一种事件值，也不根据当前 focused App 路由；它始终只作用于 `mainView`。Bridge/Native 可以提供同名转发方法，但保留主白板语义，调用完成后以 `unifiedPageStateChange` 中 `pageCount` 的更新作为跨端可观察确认。

### 5.1.1 统一页码基准

新统一接口的所有目标都遵守同一规则：

| 字段/操作 | 统一语义 |
| --- | --- |
| `page` | 1-based，第一页为 `1` |
| `pageCount`（totalPage） | 实际总页数，N 页就返回 `N`，不是最大页码索引 |
| `jumpToPage(page)` | 传入 1-based 页码，`page = 1` 跳到第一页，`page = pageCount` 跳到最后一页 |
| `prevPage` / `nextPage` | 以当前 1-based 页码为基准移动一页 |

WindowManager 内部旧 `manager.pageState.index`、`manager.jumpPage(index)` 和 Presentation controller 的 0-based index 不在本次旧 API 改造范围内；新统一 adapter 在边界处将 `page - 1` 转换为内部 index，并将 `index + 1` 转换回统一 `page`。该转换不能泄漏到 Bridge 或 Native 的新统一 payload。

### 5.2 事件语义

| 事件 | Slide | Presentation | mainView |
| --- | --- | --- | --- |
| `prevPage` / `nextPage` | 调用对应 Slide controller | 调用对应 Presentation controller | 调用 WindowManager `prevPage` / `nextPage` |
| `prevStep` / `nextStep` | 调用动画 step | 不支持，返回 `false` | 不支持，返回 `false` |
| `jumpToPage` | `page` 直接传给 Slide（1-based） | 将 `page - 1` 转换为 controller index | 将 `page - 1` 转换为 mainView index |

所有目标最终返回 `Promise<boolean>`，但该 Promise 只表示命令是否被接收：

- `true`：目标存在、参数合法、权限和边界校验通过，并且命令已进入 controller 处理流程；不代表异步 controller 最终返回成功，也不代表目标页已经完成切换或渲染。
- `false`：命令在派发前就被拒绝，例如目标不存在、未就绪、无权限、参数非法、越界或事件不支持。

controller 在调用后异步返回 `false` 或 reject，不能再改变已经返回的 accepted `true`；这类明确失败由诊断事件通知。WindowManager 不为 page 或 step 命令维护 pending transition，也不等待固定超时。Slide 的 `renderError` 继续由 Slide 自身事件暴露，宿主可随后调用 `getPageState` 读取当前可观察页。

终态失败复用同一个事件，payload 如下：

```ts
type UnifiedPageStateFailure = {
  status: "failure";
  target: "mainView" | "Slide" | "Presentation";
  appId?: string;
  event: PageEvent;
  /** 目标页，1-based；pageCount 为命令接收时的总页数。 */
  page: number;
  pageCount: number;
  reason: "commandFailed";
  message?: string;
};

manager.emitter.on("unifiedPageStateChange", handler);
```

参数非法、目标不存在、未 setup、无权限、越界或事件不支持，均属于派发前拒绝，只返回 `false`，不发失败事件。`commandFailed` 仅用于已调用 controller 后异步返回 `false` 或 reject。Slide `renderError` 不由 WindowManager 猜测归因到某次命令。

`jumpToPage` 的目标页等于当前已确认页时按无操作处理，派发前返回 `false`，也不产生失败事件。

`prevStep`/`nextStep` 仅对 `Slide`（`app-slide`）有效；Presentation 和 mainView 不提供 step 语义，收到这两个事件时直接返回 `false`，不得退化为上一页/下一页。目标不存在、未就绪、无权限、参数非法或越界时，命令在派发前被拒绝并 resolve `false`。Presentation/Slide 的同步 controller 返回值只能表示“命令被接受”，不能直接作为统一接口的完成通知。

#### “命令被接受”与“分页状态被观察到”

这两个时刻必须区分：

1. **命令被接受**：WindowManager 找到了目标 App，参数合法，并已调用 App controller。同步 controller 的 `false` 会直接返回 `false`；异步 controller 的最终失败通过 `unifiedPageStateChange({ status: "failure" })` 诊断。此时不能据此判断用户已经看到目标页。
2. **分页状态被观察到**：WindowManager 收到目标的权威状态事件后发出 `unifiedPageStateChange`。mainView/Presentation 固定输出 `status: "success"`；Slide 任一侧先变化都发事件，`pending` 表示两侧暂未一致，`success` 表示 Whiteboard View 与 Slide render 页一致。这个事件不改变前面已经返回的 accepted `Promise<boolean>`。

统一接口的时序示例：

```text
调用 dispatchPageEvent("nextPage")
  -> 检查目标、权限和边界
  -> 调用目标 controller（命令被接受）
  -> Promise resolve(true)（仅表示 accepted）
  -> 等待目标状态事件
  -> 收到目标状态事件
  -> emit unifiedPageStateChange（调用方读取 status）
```

三类目标的“目标状态事件”不同：

- **mainView**：等待 WindowManager 的 page state/scenePath 变为目标页。`dispatchPageEvent` 先返回 accepted，后续状态确认才触发 `unifiedPageStateChange`。
- **Presentation**：等待 `onAppScenePathChange`（以及对应 page state）确认静态 PPT 的 scenePath 已切换。controller 的同步 `boolean` 和统一 Promise 都只代表请求被接受。
- **Slide page 命令**：`slide.on("renderEnd", page)` 与 app-slide Whiteboard View 的 `onAppScenePathChange` 都会触发统一回调。每次触发时读取 View scenePath 的 1-based 页码与最近一次 `renderEnd` 页码。两侧不一致输出 `{ status: "pending", view, slide }`，一致后输出 `{ status: "success", view, slide }`；不要求同一 request 内先收到 `renderStart`。
- **Slide step 命令**：统一入口只校验 `hasPrevStep()`/`hasNextStep()` 并调用 controller，不追踪页内动画状态，也不因页码未变化伪造 `unifiedPageStateChange`。如果 step 跨页，仍由 scenePath/renderEnd 两个真实分页来源分别触发对账事件。

因此，`unifiedPageStateChange` 不是“翻页按钮被点击”事件，而是状态来源对账和终态失败事件。调用方若只需要知道命令是否进入处理流程，使用 `dispatchPageEvent` 的 `Promise<boolean>`；若需要知道目标页已经一致，则监听 `unifiedPageStateChange` 并判断 `status === "success"`。两者不能互换。

### 5.3 兼容 API

- `dispatchDocsEvent(event, options)` 保持当前签名和同步 `boolean` 返回，仅允许文档 App。其既有 `DocsViewer`、`scalePage` 和历史 step 行为继续按原逻辑保留；与新入口重叠的 Slide/Presentation controller 调用由内部共享执行器复用，但不复用新入口的返回类型、路由和校验语义。
- `manager.pageState`、`manager.nextPage()`、`manager.prevPage()`、`manager.jumpPage(index)` 是 WindowManager 主白板的权威 API，继续只操作 mainView，避免改变 Web 旧代码含义。
- `manager.addPage(params?)` 是 WindowManager 主白板的权威增页 API；`params.after` 为 `true` 时插入当前页之后，否则追加到场景列表末尾，`params.scene` 可提供新场景定义。
- `room.nextPage`、`room.prevPage` 以及其他旧分页入口保持现有业务逻辑和返回语义不变，继续作为 Bridge/Native 的主白板转发层；本期所有聚合、目标解析和焦点路由只在新增统一接口 `dispatchPageEvent` 上实现，不回写旧入口行为。

#### 两个入口的边界

`dispatchDocsEvent` 和 `dispatchPageEvent` 保留两个公开名称，但不是两套并行的业务实现：

| 对比项 | `dispatchDocsEvent`（旧接口） | `dispatchPageEvent`（新统一接口） |
| --- | --- | --- |
| 目标范围 | 旧文档 App：DocsViewer、Presentation、Slide | `mainView`、`netless-app-presentation`、Slide |
| 事件范围 | 保留旧 `scalePage`、DocsViewer DOM 路径和历史 step 行为 | 仅统一分页事件；不包含 `scalePage`，`prevStep`/`nextStep` 仅 Slide |
| 页码契约 | 保持已发布行为，不改旧字段和旧调用方 | `page`/`jumpToPage` 统一 1-based，`pageCount` 是实际总页数 |
| 返回语义 | 同步 `boolean`，保持旧兼容行为 | `Promise<boolean>` 仅表示命令已被接收 |
| 状态通知 | 旧接口签名不变；真实状态变化由来源无关的统一观察器通知 | `unifiedPageStateChange` 统一包含 `status`；Slide 的 scenePath/renderEnd 任一侧都会触发 |
| 主白板 | 不路由到 mainView | 支持显式 `target: "mainView"` 或无焦点回退 |

实现上，两个入口共享底层 App controller 调用和页码转换工具，但必须各自保留入口语义：旧入口由 compatibility wrapper 同步调用共享执行器，不能把 `dispatchDocsEvent` 直接改成调用公开的异步 `dispatchPageEvent`，也不能让新入口继承旧 `scalePage`、DocsViewer DOM 或历史 alias 行为。

`unifiedPageStateChange` 是来源无关的统一事件。页面变化来自 `dispatchPageEvent`、旧 `dispatchDocsEvent`、App UI 或远端同步时都可触发；旧入口不得直接伪造事件，状态回调统一由 watcher 根据真实状态产生。Slide 允许先报告 `pending`，随后再报告 `success`；`pending` 不是失败。只有 controller 在命令被接受后异步返回 `false` 或 reject 才报告 `failure`，该事件本身是终态诊断，不会被重新解释为临时失败。

## 6. WindowManager 内部结构

当前实现将事件去重状态、最近一次 `renderEnd` 页和监听器 disposer 收口在 `src/UnifiedPageControl.ts` 的 `UnifiedPageControlTracker`；WindowManager 负责目标解析、controller 调用和各来源状态适配。Tracker 不保存命令状态，也不参与 `getPageState` 查询：

```text
dispatchDocsEvent (legacy wrapper)
  -> legacy DocsEvent validation/return semantics
  -> shared synchronous App command executor (DocsViewer/scalePage remains legacy-only)

dispatchPageEvent
  -> resolvePageTarget(options)
  -> validatePageEvent(event, options, target)
  -> PageAdapter.dispatch(event, normalizedOptions)
       mainView adapter       -> manager.pageState / manager.nextPage / manager.prevPage / manager.jumpPage / manager.addPage
       Slide adapter          -> AppResult
       Presentation adapter   -> PresentationController
```

共享 App command executor 只接收规范化后的 1-based `page`，Presentation 在边界处转换为 0-based。旧 `dispatchDocsEvent` 继续调用 controller 的同步 `jumpPage/prevPage/nextPage` 并返回同步 `boolean`；新统一入口优先调用 Presentation 新增的 `jumpPageAsync/prevPageAsync/nextPageAsync`，立即返回命令已接收，并在异步 scenePath 操作返回 `false` 或 reject 时发出 `status: "failure"`。状态事件由独立 watcher 产生，不延迟统一入口的 Promise 以等待 `unifiedPageStateChange`。

路由层必须在调用前完成：

- `target` 对应的 appId/kind 是否存在且属于受支持的内置 App；
- `appResult` / controller / View 是否已 setup；
- `page` 是否为有限整数且大于等于 1；
- mainView 是否已初始化、当前用户是否可写；
- Slide 是否满足公开的 controller ready/loading/step 边界条件。

### 6.1 分页状态观察与 Slide 对账

`dispatchPageEvent` 的 Promise 与 `unifiedPageStateChange` 具有不同语义：Promise 表示命令已被接收，统一事件通过 `status` 表示来源对账状态或终态命令失败：

```text
mainView page request
  -> manager.nextPage/prevPage/jumpPage
  -> pageState/scenePath == expected page
  -> emit { status: "success", mainView: page, page, pageCount }

Presentation page request
  -> unified API: controller.jumpPageAsync/nextPageAsync/prevPageAsync
     legacy docs API: controller.jumpPage/nextPage/prevPage
  -> onAppScenePathChange + pageState == expected page
  -> emit { status: "success", presentation: page, page, pageCount }

Slide page request
  -> Whiteboard View scenePath changes OR slide.renderEnd(page)
  -> parse View scenePath page and read latest renderEnd page
  -> emit { status: viewPage == slidePage ? "success" : "pending",
            view: viewPage, slide: slidePage,
            page: slidePage, pageCount }
  -> when the other source changes, emit again with the new status

Slide step request
  -> controller.prevStep/nextStep
  -> in-page step: no page state event because the page did not change
  -> cross-page step: use the same scenePath/renderEnd comparison events
```

- 本设计不要求修改 `@netless/slide` 或 `app-slide`。app-slide 的 Whiteboard View 由 WindowManager `AppProxy` 持有，scenePath 更新已经通过 `onAppScenePathChange` 暴露；WindowManager 只额外消费 Slide 已有的 `renderEnd` 事件。
- `prevStep`/`nextStep` 调用前必须消费 Slide 已有的 `hasPrevStep()`/`hasNextStep()` 做整份 PPT 首尾边界判断；返回 `false` 时统一命令直接 resolve `false`，不得调用 controller 或发出失败事件。该检查只放在新统一入口，不改变旧 `dispatchDocsEvent` 行为。
- View scenePath 页从 app-slide View 的 `focusScenePath` 最后一级数字解析；Slide 页取最近一次有效 `renderEnd(page)`。两侧统一为 1-based，再计算 `status`。顶层 `page` 使用 Slide 页，`pageCount` 使用 `appResult.position()` 的总页数。
- WindowManager 在 observer 安装时，如果 Slide controller ready 且非 loading，则以公开 `slideState.currentSlideIndex` 初始化最近渲染页，使 scenePath 先变化时可以与旧 Slide 页对账。如果 observer 安装早于 controller ready，后续 scenePath 事件会在同样的 ready/非 loading 条件下补做一次初始化，避免初始页没有 `renderEnd` 而丢失状态事件；初始化完成后只有 `renderEnd` 更新该值。
- `renderEnd` 和 `onAppScenePathChange` 每次都会触发 Slide `unifiedPageStateChange`，即使页码与上次相同；这是为了保证 `pending -> success` 的第二次对账不会被普通页码去重吞掉。
- WindowManager 不监听 `renderStart`、`renderError` 或 step 内部事件，也不维护命令 pending。没有收到 scenePath/renderEnd 不会锁死后续命令。
- Slide `renderError` 不直接归因到 page/step 命令。宿主可监听 Slide 的 `renderError` 后主动调用 `getPageState`。
- WindowManager 销毁时清理所有 observer；销毁开始后 `dispatchPageEvent` 返回 `false`、`getPageState` reject，并且不得重新安装 watcher。App reconnect 时清理旧 AppProxy 的 observer/cache，并在同 appId 的新 App setup 后重新安装。
- **保留风险**：`app-slide` controller 可能返回 `true`，而 `@netless/slide` 因内部 interactive、catch-up、player/frozen/paused 状态忽略命令。WindowManager 不耦合 Slide 私有 runtime 字段；此时可能 accepted `true` 但没有新的状态回调，不过不会阻断后续 page command。

## 7. Bridge 与 Native 对齐

### 7.1 Bridge

新增异步 handler：`room.dispatchPageEvent(event, options, responseCallback)`，只负责把 Web 参数传给 `manager.dispatchPageEvent`，统一输出 JSON bridge 可识别的 boolean 或 `__error`。旧 `room.dispatchDocsEvent` 保持不变。

Bridge 需要修正/统一的字段：

- canonical 字段为 `page`，不使用 `pageIndex`。
- 新接口请求只使用 `target`；`target` 为 `mainView` 或具体 appId。旧 docs 事件仍接受其原有 `appId`。
- 失败时不要把 `undefined` 当作成功；WindowManager 未挂载、目标未就绪必须回调 `false` 或结构化错误。
- 监听 WindowManager 的 `unifiedPageStateChange`，调用内部 `sdk.unifiedPageStateChange`。payload 原样包含公共字段 `target`、可选 `appId`、`page`、`pageCount`、`status`；状态观察按目标包含 `mainView`、`presentation` 或 Slide 的 `view`/`slide`，终态失败包含 `event/reason/message`。

### 7.2 Android

建议新增：

```java
room.dispatchPageEvent(WindowPageEvent event, Promise<Boolean> promise);
```

`WindowPageEvent` 的事件字符串与 Web 完全一致，`Options.page` 使用 1-based，`Options.target` 为 `mainView` 或具体 appId。不新增独立 `appId` 或 `scale` 字段；保留 `WindowDocsEvent` 和 `Room.dispatchDocsEvent`，并在 JavaDoc 中标明旧文档事件（包括既有 `scalePage`）的兼容范围。

Android 的 `PrevPage`、`NextPage`、`PrevStep`、`NextStep` 是共享的不可变事件模板，`WindowPageEvent` 和 `Options` 均不可变。使用 `WindowPageEvent.NextPage.withTarget("mainView")`、`withTarget(appId)` 或 `withOptions(options)` 创建独立事件；查询参数使用 `new WindowPageEvent.Options().withTarget(...)`。不提供“setter 可调用但只修改临时副本”的接口，避免静默失效，也避免一次调用的配置污染后续 Room 或其他调用。

新增统一分页状态回调接口。回调注册、解绑和生命周期可以复用 `dispatchDocsEvent` 现有的 Native 回调通道与对象管理方式，但事件名和 payload 独立，不把统一分页状态伪装成 DocsEvent：

```java
interface UnifiedPageStateListener {
    void onUnifiedPageStateChange(UnifiedPageStateChange state);
}
```

`WhiteSdk`/`Room` 负责注册和生命周期解绑；已有 `SlideListener.onSlidePageStateChanged` 继续兼容，不要求调用方立即迁移。
新统一事件只进入 `UnifiedPageStateListener`，不得再向旧 `SlideListener` 增加或转发 `onUnifiedPageStateChange`，避免 mainView/Presentation 事件改变旧 Slide 回调职责。

### 7.3 iOS

建议新增：

```objc
- (void)dispatchPageEvent:(WhiteWindowPageEventKey)event
                   options:(WhiteWindowPageEventOptions * _Nullable)options
         completionHandler:(void (^)(BOOL success))completionHandler;
```

新 options 的 `page`、`target` 与 Android/Harmony 同名，其中 `target` 为 `mainView` 或具体 appId；不包含独立 `appId` 或 `scale`。保留 `WhiteWindowDocsEventKey` API，避免已有头文件和调用方立即迁移。

新增统一回调协议，挂载到已存在的 `WhiteRoomCallbackDelegate`：

```objc
- (void)onUnifiedPageStateChange:(WhiteUnifiedPageStateChange *)state;
```

已有 `WhiteSlideDelegate.onSlidePageStateChanged:page:pageCount:` 继续保留。

### 7.4 Harmony

建议新增与 Android/iOS 相同语义的 `dispatchPageEvent`。新统一接口的 `WindowPageEventOptions.page` 为唯一正式字段，Harmony 与 Android/iOS 保持完全一致，不接受 `pageIndex` 别名。当前已发布旧接口中的 `pageIndex` 暂不改造、不迁移，继续保持原有行为，避免把旧接口兼容变更混入 WB-440。

新 `dispatchPageEvent` 的 Harmony 示例和单测应补上 `jumpToPage`，验证 JSON 为 `{ "page": n }`，防止 `pageIndex` 进入统一接口；当前 `dispatchDocsEvent` 的 Harmony 示例和实现暂不改造。

Harmony 新增统一回调 `onUnifiedPageStateChange(state)`，完整透传 `status`、来源页和终态失败字段；已有 Slide 页面回调保持兼容，不能只依赖当前 Harmony 尚未完整实现的 Slide callback handler。

## 8. 统一页码查询、事件回调与主白板增页

分页命令统一后，调用方必须知道当前目标页。`getPageState` 纳入 WB-440 本期契约：

```ts
getPageState(options?: {
  /** "mainView" 或具体的 Slide / netless-app-presentation appId。 */
  target?: string;
}): Promise<{
  target: "mainView" | "Slide" | "Presentation";
  appId?: string;
  page: number;
  pageCount: number;
}>;
```

统一输出 1-based `page`，避免 Native 端继续暴露 mainView 0-based index 与 Slide 1-based page 的差异；`pageCount` 始终是实际总页数，不是最大 index。该查询不应复用旧的 `querySlidePageState` 错误码和结构；旧查询继续保留。

`getPageState` 是无副作用的纯查询接口，不返回 `status/mainView/presentation/view/slide/event/reason/message` 等事件字段，不把 `unifiedPageStateChange` 的去重缓存当作查询数据源，也不把查询结果写回该缓存；主动查询不能吞掉随后到达的真实状态事件。mainView 每次读取当前 `manager.pageState`，Presentation 每次读取 controller `pageState()`，并分别校验对应 scenePath；避免状态源已变化但异步事件尚未刷新缓存时返回旧页。Slide 每次直接读取有效的 `appResult.position()`，不要求该页已经收到 `renderEnd`，因此宿主收到 Slide `renderError` 后仍可主动查询当前可观察页。目标状态非法或不可用时 reject。

目标适配规则：

| 目标 | 内部读取 | 对外转换 |
| --- | --- | --- |
| mainView | `manager.pageState.index`、`manager.pageState.length` | `page = index + 1`、`pageCount = length`（length 是实际总页数） |
| Slide | `appResult.position()` 返回 `[page, pageCount]` | 原样输出，`page` 1-based、`pageCount` 是实际总页数 |
| Presentation | `controller.pageState()` 返回 `{ index, length }` | `page = index + 1`、`pageCount = length`（length 是实际总页数） |

mainView 增页继续使用已有 WindowManager API：

```ts
await manager.addPage();
await manager.addPage({ after: true });
await manager.addPage({ scene: { name: "page-2" } });
```

Bridge/Native 的 `addPage` 只作用于 mainView，不能根据 focused App 改写成向 Presentation/Slide 增页。WindowManager 继续保留 `manager.addPage(): Promise<void>` 的现有返回签名；跨端若需要“已生效”的确认，应等待 mainView 的 `unifiedPageStateChange` 观察到 `pageCount` 更新，而不是把 Promise<void> 当作最终分页成功。当前页是否自动切换遵循现有 `manager.addPage` 语义，不由新统一分页事件改变。

`addPage` 的旧 Native 无参入口保持各平台既有业务逻辑，本期不做破坏性统一：WindowManager/Harmony 未传 `after` 时追加到末尾，Android `new AddPageParam()` 当前等价于 `after: false`，iOS `addPage` 当前等价于 `afterCurrentScene: YES`。因此跨端业务不得依赖无参默认插入位置，必须显式传入 `after`：Android 使用 `addPage(scene, after)`，iOS 使用 `addPageWithScene:afterCurrentScene:`，Harmony 使用 `addPage({ after, scene })`。本期统一的是显式参数语义与 mainView 目标，不修改旧无参方法的默认值。

该回调不把 App pageState 静默写入主白板的 `RoomState.pageState` 字段；旧 `pageState` 仍表示 mainView。本期将统一回调定义为正式契约：

```ts
type UnifiedPageStateObservation = UnifiedPageState & {
  status: "pending" | "success";
  mainView?: number;
  presentation?: number;
  view?: number;
  slide?: number;
};

type UnifiedPageStateFailure = UnifiedPageState & {
  status: "failure";
  event: PageEvent;
  reason: "commandFailed";
  message?: string;
};

type UnifiedPageStateChange = UnifiedPageStateObservation | UnifiedPageStateFailure;

manager.emitter.on("unifiedPageStateChange", handler);
```

回调规则：

- `page`、各来源页始终为 1-based 正整数，`pageCount` 始终为实际总页数；`getPageState` 的返回结构不包含这些来源字段。
- mainView 输出 `{ status: "success", mainView: page }`；原有 `pageStateChange({ index, length })` 保持不变。`pageCount` 变化也触发回调，例如 `manager.addPage()`。
- Presentation 在 scenePath 与 controller page state 确认后输出 `{ status: "success", presentation: page }`。
- Slide 的 `renderEnd` 与 Whiteboard View scenePath 变化均触发回调。两侧不一致输出 `{ status: "pending", view, slide }`，一致输出 `{ status: "success", view, slide }`；`pending` 是正常中间状态，不是失败。
- Slide 顶层 `page` 等于 `slide`，用于保持统一页码消费方式；`view` 保留另一侧真实值，调用方不得在 `status: "pending"` 时把顶层 `page` 当作两侧已一致。
- mainView/Presentation 相同状态默认去重；Slide 的两个来源事件不按普通页码去重，以保证每个触发及 `pending -> success` 都可见。
- `status: "failure"` 只用于 controller 在命令被接受后异步返回 `false` 或 reject，并携带 `event/reason/message`。它是持久的终态诊断，不表示 Slide 临时不一致。

Bridge 新增 `sdk.unifiedPageStateChange` 内部通知，Native 对外统一接收 `UnifiedPageStateChange` 对象，避免继续扩展位置参数。该回调与 `RoomState.pageState` 分开：后者继续只代表 mainView，前者覆盖所有统一分页目标、Slide 双源对账状态和明确的终态命令失败。三端不得再增加独立失败回调；`status` 字段、枚举和值大小写必须与上述 TypeScript 契约完全一致。

## 9. 测试与验收矩阵

### 9.1 WindowManager 单测 / E2E

- mainView：上一页、下一页、首尾边界、1-based 跳页转换、只读失败。
- Slide：上一页、下一页、页内上/下一 step、step 边界跨页、跳页、未 setup 失败。
- Presentation：上一页、下一页、`prevStep`/`nextStep` 不支持、跳页转换。
- 路由：不传 `target` 时的 focused App、显式 appId target、显式 mainView、无焦点回退、未知/空 target，以及旧草案 `appId` 字段拒绝。
- 查询：mainView、Slide、Presentation 的 `page/pageCount` 转换；Slide 查询绕过事件缓存读取当前 `position()`，并验证查询结果不包含事件对账字段。
- 回调：mainView 验证 `{ status:"success", mainView }`，Presentation 验证 `{ status:"success", presentation }`。Slide 必须覆盖 scenePath 先到与 renderEnd 先到两种顺序：第一次 `{ status:"pending", view, slide }`，另一侧到达后 `{ status:"success", view, slide }`；还要覆盖相同页重复来源事件、跨页 step、renderError 后主动查询、App reconnect 和销毁清理。页内 step 不产生分页状态事件。
- mainView 增页：WindowManager 默认追加、`after: true`、显式 scene、增页后 `pageState` 更新；Native 跨端用例必须显式传 `after`，并验证各端生成相同 JSON，不把旧无参默认值当作统一契约。
- 并发：连续两次调用的顺序、上一次切页未完成时的返回值、销毁后调用；销毁后的调用不得重新安装 watcher。

### 9.2 Bridge 契约测试

- 验证 `room.dispatchPageEvent` 参数顺序和 JSON 字段名。
- 验证 `room.getPageState` 的 `page/pageCount` 统一输出，以及 `room.addPage` 只操作 mainView。
- 验证新统一接口的 `page` 是 1-based，`pageIndex` 不进入正式输出；旧接口的 `pageIndex` 保持原行为并做回归验证。
- manager 未挂载、App 未注册、App 未就绪时均有回调。
- `room.dispatchDocsEvent` 回归：旧同步返回值和 `appId` 路由不变。
- 双入口隔离与内部复用：`dispatchDocsEvent` 不路由 mainView，保留同步返回及 DocsViewer/scalePage/历史 alias；两个入口对 Slide/Presentation 复用同一内部 command executor。旧入口、UI 或远端同步导致的真实状态完成后，允许由来源无关 watcher 发出统一 `unifiedPageStateChange`；`dispatchPageEvent` 不接受旧 `scalePage`/DocsViewer 路径。

### 9.3 Native

- Android/iOS/Harmony 对同一事件生成相同 JSON：事件名、大小写、可选字段、页码基准一致。
- Android/iOS/Harmony 对 `getPageState` 的方法名、参数字段、返回结构保持一致；`addPage` 的显式 `after/scene` 参数语义一致，旧无参入口默认插入位置保持平台兼容行为，不纳入统一契约。
- Android/iOS/Harmony 都能收到完整 `UnifiedPageStateChange` 对象，验证公共字段、三种 `status`、按目标出现的来源字段和 failure 专属字段，同时验证 Slide 旧回调不回归。
- 三端都覆盖 `prevPage`、`nextPage`、`jumpToPage`；`prevStep`/`nextStep` 仅覆盖 app-slide 动态 PPT，Presentation 和 mainView 验证返回 `false`。新统一接口不测试 `scalePage`；旧 `dispatchDocsEvent` 的 DocsViewer/缩放能力继续做兼容回归。
- Harmony 特别覆盖新统一接口的 `page` 字段与 JSON 结构；旧接口的 `pageIndex` 仅做不回归验证，不纳入本次改造。
- 动态 Slide 分别触发 scenePath 和 `renderEnd`，验证 `pending` 与 `success` 两次回调；静态 Presentation 和 mainView 验证 `status:"success"` 与各自来源页字段。
- 多窗口开关关闭时，旧单窗口 `nextPage`/`prevPage` 行为不回归。

## 10. 实施顺序与发布门槛

1. Jira 认证恢复后补齐 WB-440 原文、验收标准和是否必须新增公开方法名。
2. 在 WindowManager 先落地 adapter、路由和类型测试，不改旧 API。
3. 在 Bridge 新增异步 handler，并补 Harmony `page` 字段修正。
4. Android、iOS、Harmony 按同一 JSON 契约增加 Native wrapper（分页事件、页码查询、mainView 增页、page state 回调）、JavaDoc/头文件/README 和单测。
5. 构建并同步三端内嵌 Bridge 资源；分别验证资源 marker、handler 和产物 hash。
6. 在 Android、iOS、Harmony demo 中执行四种目标（mainView、Slide、Presentation、无焦点）运行探针。
7. 只有 Jira 验收标准、三端构建和运行探针均通过后，才进入版本记录和发布准备。

## 11. 待确认问题

1. **已确认：** WB-440 使用新增的异步统一入口 `dispatchPageEvent`，不修改 `dispatchDocsEvent` 的既有签名和同步语义。
2. **已确认：** Native 旧入口 `room.nextPage`/`prevPage` 及其他既有分页 API 保持业务逻辑不变；“跟随当前焦点”的目标聚合能力只通过新增统一接口 `dispatchPageEvent` 提供。
3. **已确认：** `prevStep`/`nextStep` 仅支持 `app-slide` 动态 PPT；Presentation 和 mainView 不支持这两个事件。
4. **已确认：** `scalePage` 不属于本次 WB-440 新统一接口范围；不新增统一缩放能力，旧 `dispatchDocsEvent` 的既有缩放逻辑保持不变。
5. **已确认：** 统一分页回调复用 `dispatchDocsEvent` 现有 Native 回调的注册、解绑和生命周期管理方式，使用单一 `onUnifiedPageStateChange(UnifiedPageStateChange state)` 事件完整传递 `status`、来源页和终态失败字段；iOS 挂载到 `WhiteRoomCallbackDelegate`，不新增独立 page delegate。
6. **已确认：** DocsViewer 不属于本次统一分页接口范围；静态 PPT 仅要求 `netless-app-presentation` 支持。旧 `dispatchDocsEvent` 对 DocsViewer 的兼容逻辑不在本次改造内。
7. **已确认：** 新统一接口在 Harmony/Android/iOS 统一使用 `page`，不提供 `pageIndex` 别名；旧接口的 `pageIndex` 暂不改造，保持现有行为。
8. **已确认：** 统一 API 的 Promise 采用“命令已被接收”语义；Promise 不等待回调。`unifiedPageStateChange` 使用 `status` 作为唯一状态判据：mainView/Presentation 输出 `success`；Slide 任一侧变化都触发，不一致为 `pending`、一致为 `success`；controller accepted 后异步失败输出终态 `failure`。不再提供 `result` 或独立失败事件。
9. **已确认：** 新统一请求只保留 `target?: string` 与 `page?: number`；`target` 为 `mainView` 或具体 appId，不存在独立 `appId`，也不存在 `target: "focused"`。不传 `target` 才表示跟随当前 focused App，无 focused 时回退 mainView。

## 12. 结论

当前评审基线已确认采用“新增异步 `dispatchPageEvent` + `getPageState` + `unifiedPageStateChange` + mainView `addPage`，并保留旧 `dispatchDocsEvent`”。两者保留公开名称是为了兼容边界，不代表复制两套实现：底层 controller 能力可共享，入口校验、返回值、目标范围和事件完成语义必须隔离。新增统一接口覆盖动态 `Slide`、静态 `netless-app-presentation` 和 `mainView`，不会破坏现有同步 API，也能让三端 Native 使用同一事件名、字段、页码语义和回调 payload。统一请求只包含 `target` 和可选 `page`，其中 `target` 为 `mainView` 或具体 appId；未传时跟随当前 focused App，无 focused 时回退 mainView。DocsViewer 仅保留旧 `dispatchDocsEvent` 兼容范围；Native 旧分页入口业务逻辑不变，Native 回调复用既有回调通道，iOS 挂载到 `WhiteRoomCallbackDelegate`。
