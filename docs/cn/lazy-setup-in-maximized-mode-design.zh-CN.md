# 最大化模式 Lazy Setup 与多 App Runtime 缓存设计

> 2026-09-24 修订：以下 v2 历史目标中，“真实 setup 永不重叠”已改为正常串行、超过 10 秒且有不同 pending 时让出调度占用；Slide runtime 保留，资源活动条件为 focus + 前台 + 非最小化。lazy 新增 App 与同步/API/TeleBox focus 共用一个最新 pending，不再为新增 App 保留独立 setup 排队项。以 §7.3–7.4、§9.1、§14、§16.3 的更新为准，不将逻辑让出声称为物理取消。

> 状态：v2 设计。v1 的"单 runtime 缓存 lazy setup"已随 `b182b15`、`ba2750a` 部分实现（当前 `window-manager@1.0.23-beta.0`）；本文档在 v1 基础上增补四项设计并移除已过时的结论：
>
> 1. `maxCachedAppsInMaximizedMode` 多 App runtime LRU 缓存（v1 只保留一个 top App runtime 的结论作废）；
> 2. 严格串行的真实 `setup()` 队列（上一个 App `setup()` 完成后才开始下一个，而不只是创建串行）；
> 3. 初始化与批量重建时，`activeAppId`（focusedId）优先渲染；
> 4. `app-presentation` 失焦缩略图降级（参考 `app-slide` frozen/unfrozen，只依据 `isFocused`，直接走 DOM 变化，不调用 white-sdk scene API）。
>
> 目标版本：window-manager 1.0.23（进行中）；配套 `app-slide`、`app-docs-viewer`、`app-presentation`、`app-media-player`。
> 注意：工作区 `docs/apis/whiteboard-upstream-apis.md` 仍记录 `window-manager@1.0.22`、`app-slide@0.2.104` 等已发版版本，与本文档描述的本地源码版本（`1.0.23-beta.0`、`0.2.105-beta.0` 等）存在滞后。

## 1. 背景

`WindowManager` 在恢复房间时，会为 `attributes.apps` 中的每个 App 创建窗口，并调用 App 的 `setup()`。
`app-slide`、`app-docs-viewer`、`app-presentation`、`app-media-player` 的 `setup()` 会创建页面渲染器、控制器、播放器和 DOM。
当一个房间同时打开多个课件时，低端设备会在初始化阶段同时承担多个课件 runtime 的内存和渲染开销，可能影响首屏、交互响应和后续切换。

本设计围绕 `WindowManager.mount()` 的本地配置展开：

```ts
lazySetupInMaximizedMode?: boolean;
forceMaximized?: boolean;
maxCachedAppsInMaximizedMode?: number;
```

`lazySetupInMaximizedMode` 只改变当前 `WindowManager` 实例如何初始化与缓存 App runtime，不写入房间 attributes，也不要求房间中的其他客户端启用同一配置；`forceMaximized` 是独立的房间级策略请求；`maxCachedAppsInMaximizedMode` 是 lazy 模式下的 runtime 缓存目标容量。对没有 `teardown()`、无法安全淘汰的 App，它是软上限。

`manager.setMaximized(true)` 仍然使用现有 WindowManager/TeleBox 同步逻辑，因此它会继续影响房间中的其他客户端。这个共享状态变化是显式的产品行为，与本地 lazy setup 策略分开处理。

`forceMaximized` 是有写权限的房间入口用于声明房间级策略的 mount 请求；当它为 `true`、当前实例可写且有效 `useBoxesStatus=false` 时，WindowManager 在初始化阶段同时把房间级 `attributes.forceMaximized` 设置为 `true`，并调用现有 `setMaximized(true)` 把最大化状态同步到 `attributes`。该字段是共享策略，但有效 `useBoxesStatus=true` 的客户端本地忽略；其余支持该字段的 WindowManager/TeleBox 客户端必须禁止进入 normal，直到房间级策略被显式解除。开启 lazy 的客户端不要求也不依赖该参数写入字段，只读取房间已有值，也不能因为 lazy 配置自行调用 `setMaximized(true)`。

## 2. 现状与差距（代码事实）

以下为 v2 实现前（`window-manager@1.0.23-beta.0`，commit `ba2750a`）已核实的**审计基线**。本节描述的差距（单缓存、setup 并发、reconnect 并发、App 提前返回）已在 1.0.23 的 v2 实现中修复（见 §20 勾选项），保留本节作为设计依据与回归对照。文中源码行号为基线快照，现行代码以符号名为准。

### 2.1 lazy setup 已部分实现，但只有单 runtime 缓存

- `_attributesUpdateCallback()` 将所有 App 加入 `AppCreateQueue` 依次创建。
- lazy 模式已生效：`AppManager.activeLazyAppId` 只记录一个当前 lazy App（`src/AppManager.ts`）；`ensureLazyFocus()` 等待新 App `ensureSetup()` 完成、提交 focus 后 teardown 旧 App（`src/AppManager.ts` ensureLazyFocus）。
- `AppProxy.teardown()` 已实现 App 侧 teardown 契约调用：未实现 teardown 的 App 会 warning 并保留 runtime（`src/App/AppProxy.ts` teardown）。
- 因此 v1 文档中"设计中，尚未实现"以及"`setupApps` 本次仍然只允许一个最大化 top App 进入 runtime"的结论已过时：lazy 单缓存已实现，本文档 v2 将其推广为可配置的多缓存。

### 2.2 现有队列只保证"创建串行"，不保证"setup 完成串行"

- `AppCreateQueue.invoke()` 依次等待每个 invoker Promise 完成（`src/Utils/AppCreateQueue.ts` invoke），但 eager 模式中 `AppProxy.setupApp()` 是通过 `setTimeout(..., SETUP_APP_DELAY)` 异步启动真正的 `finishAppSetup()`（`src/App/AppProxy.ts` setupApp），invoker 本身不等待 `app.setup()` 完成。
- 因此队列任务结束时，实际的 `app.setup()` 可能尚未开始或仍在执行，多个课件的真实 setup 仍是并发的，初始化内存峰值没有消除。
- `setupAllApps()` 是 `for...of + await ensureSetup()`，本身串行（`src/AppManager.ts` setupAllApps，唯一调用点 `src/index.ts`），但初始化主流程没有统一等待它。
- 重连 `onReconnected()` 对所有 AppProxy 使用 `Promise.all()` 并发重建（`src/AppManager.ts` onReconnected），会并发触发多个 App 的 setup。
- lazy focus 路径（`ensureLazyFocus`）虽然 `await ensureSetup()`，但各焦点切换 Promise 之间只按到达顺序排队，没有与初始 eager setup、reconnect 共享同一个串行队列。

**结论：需要一个跨路径统一的"真实 setup 串行队列"，队列任务必须等待 `app.setup()` 完成（见第 7 节）。**

### 2.3 内置 App `setup()` 都会提前返回，资源加载尾部异步

| App | `setup()` 返回时机 | 真实资源就绪时机 | 结论 |
| --- | --- | --- | --- |
| app-slide | 同步返回；创建并 mount `SlideDocsViewer` | `SlideController` 构造函数中立即 `initialize()` 启动资源加载，`readyPromise` 在首个 `renderEnd` 后才完成，但只注册回调、未返回给 WindowManager 等待 | 当前不是 setup 完成串行 |
| app-docs-viewer | 同步返回；静态文档创建 viewer | 静态页面在 `PageEl` 中直接设置 `<img src>`，图片加载在返回后继续 | 不等待资源 ready |
| app-presentation | 返回 `prepareScenesPromise`（场景写入完成） | `Presentation` 构造时即 `new Preload(...)` 并 `touch(0, true)`，默认最多预加载 5 个链接；重 runtime 在此之前已创建 | 部分异步，不是完整 runtime ready |
| app-media-player | 同步返回；`ReactDOM.render()` 后立即返回 | `componentDidMount()` 异步执行 `initPlayer()`，中间至少等待一帧后才初始化 video.js | 明显不等待播放器初始化 |

代码依据：

- app-slide：`setup()` 创建并 mount `SlideDocsViewer`（`slide-app/packages/app-slide/src/index.ts:120`）；`SlideController` 构造即 `initialize()`（`slide-app/packages/app-slide/src/SlideController/index.ts:497`）；`readyPromise` 仅注册回调（`slide-app/packages/app-slide/src/index.ts:187`）。
- app-docs-viewer：setup 同步构造 viewer（`slide-app/packages/app-docs-viewer/src/index.ts:37`）；静态页面图片直接设 `src`（`slide-app/packages/app-docs-viewer/src/PageRenderer/PageEl.ts:29`）。
- app-presentation：`Preload` 构造即 `touch(0, true)`（`netless-app-presentation/src/preload.ts:38-45`），并继续安排后续预加载（`netless-app-presentation/src/preload.ts:46-62`）；setup 最后只等待场景写入（`netless-app-presentation/src/app-presentation.ts:1207-1212`）。
- app-media-player：setup 内直接 `ReactDOM.render()`（`app-media-player/packages/app-media-player/src/index.tsx:35`）；播放器初始化在 `componentDidMount()` 异步进行（`app-media-player/packages/app-media-player/src/components/MediaPlayer.tsx:193`、`:313`）。

四个 App 当前都已实现 `teardown`，满足 runtime cache 的释放入口：

- app-slide：`slide-app/packages/app-slide/src/index.ts:400`
- app-docs-viewer：`slide-app/packages/app-docs-viewer/src/index.ts:114`
- app-presentation：`netless-app-presentation/src/app-presentation.ts:1214`
- app-media-player：`app-media-player/packages/app-media-player/src/index.tsx:84`

**结论：即使 WindowManager 侧完成串行改造，各 App 仍需把"首个可见资源 ready"纳入 `setup()` 返回值（见第 14 节），否则串行只是形式上的。**

## 3. 目标与非目标

### 3.1 目标

- 在 lazy 配置开启时，恢复全部 App 的 shell 和 Box；runtime 缓存上限由 `maxCachedAppsInMaximizedMode` 控制：
  - 默认 `1`，保持已实现的现状行为（只保留当前 top App runtime）；
  - 配置为 N（N ≥ 2）时，最多保留 N 个已成功 setup 的 App runtime；第 N+1 个 App 需要 runtime 时，按 LRU 淘汰最久未使用的缓存项。
- 命中缓存的 App 切换回来时不重新 `setup()`，只更新 LRU 使用时间。
- 所有真实 `setup()` 严格串行：上一个 App 的 `setup()` Promise 完成后，才开始下一个 App 的 `setup()`；初始化、重连、seek 重建、补齐、显式等待 API 全部走同一队列。
- 初始化与批量重建时，`activeAppId`（`attributes.focus` / top App）优先渲染：串行队列中的待 setup 任务按"聚焦 App 优先"排序。
- lazy 模式允许全局状态为 `minimized` 或 `maximized`，不允许进入 `normal`。
- 新 App ready 后，才提交 focus；被淘汰的缓存 App 在确定不再需要展示后 teardown，teardown 与 setup 不并发。
- 最大化标题栏关闭当前 App 后，先准备下一个 top App，再执行 focus。
- `app-presentation` 失焦且仍被缓存时，把当前页大图降级为 `previewURL` 缩略图（直接 DOM 变化），重新聚焦时恢复，降低缓存 runtime 的内存占用。
- 配置关闭时，保留现有 AppManager、AppProxy、TeleBox 和同步行为（唯一例外见第 7 节：初始化 setup 也纳入串行队列，用于消除 eager 模式的内存峰值）。
- scene、View、attributes、Box 等轻量 shell 可以提前创建，不把 scene 初始化与 App runtime setup 混为一谈。

### 3.2 非目标

- 不改变房间中 `attributes.apps`、`focus`、`zIndex`、`boxStatus` 的数据结构；新增的 `attributes.forceMaximized` 是本设计明确要求的共享策略字段。
- 不把 `lazySetupInMaximizedMode`、`maxCachedAppsInMaximizedMode` 这类本地配置同步给其他客户端，但会同步 `forceMaximized` 房间策略。
- 不改变默认 `AppProxy.destroy()` 的"彻底关闭 App"语义。
- 不在本次设计中重新设计普通窗口、最小化窗口或内容区域 close 按钮的交互。
- 不要求其他客户端也延迟 `setup()`。其他客户端根据自己的 mount 参数独立决定 eager 或 lazy。
- 不在 lazy 模式下支持 `useBoxesStatus=true`；该组合配置会告警并按 `useBoxesStatus=false` 运行。
- `maxCachedAppsInMaximizedMode` 是可安全淘汰 runtime 的缓存目标容量，不是 setup 并发数；没有 `teardown()` 的 App 可使其软超限，setup 并发数恒为 1。
- 初始化阶段不因缓存配置为 N 而预热 N 个 runtime：初始化仍然只 setup 当前 top App，缓存按需填充。若未来需要预热，应另设 `initialWarmupCount` 并复用同一串行队列，本文不展开。

## 4. 配置语义

### 4.1 配置总览

```ts
WindowManager.mount({
    // 默认 false：关闭 lazy，全部 App eager setup（但真实 setup 串行，见第 7 节）
    lazySetupInMaximizedMode: false,
    // 仅在需要把房间锁定为 maximized 时由可写入口显式传 true
    forceMaximized: false,
    // 默认 1：仅 lazySetupInMaximizedMode=true 时生效
    maxCachedAppsInMaximizedMode: 1,
    // 独立窗口状态；生效时忽略 forceMaximized，且 App 的 forceTop/forceNormal 才有效
    useBoxesStatus: false,
});
```

窗口策略互斥：有效的 `useBoxesStatus=true` 表示每个窗口独立管理状态，此时本地忽略 mount/API/房间 attributes 中的 `forceMaximized`；`useBoxesStatus=false` 时，App 配置中的 `forceTop`、`forceNormal` 只保留同步字段，不参与本地 Box、top 选择或 setup 优先级。有效 lazy 模式仍按既有规则优先降级为 `useBoxesStatus=false`，再启用 `forceMaximized`。

### 4.2 `maxCachedAppsInMaximizedMode` 语义

- 类型 `number`，默认 `1`；仅在 `lazySetupInMaximizedMode=true` 时生效，lazy 关闭时忽略。
- 表示"最多保留多少个已成功 `setup()` 的 App runtime"。
- 非法值回退：`undefined`/`NaN`/小于 1/非整数 时回退为 `1`，并通过 `manager.Logger?.warn(...)` 告警，不抛错。
- 上限建议：由接入方自行约束（例如 ≤ 10）；WindowManager 不做硬上限，但会在值过大时 warning 提示内存风险。

示例（cache = 5）：

```text
打开 1 -> setup 1，缓存 [1]
打开 2 -> setup 2，缓存 [1, 2]
打开 3 -> setup 3，缓存 [1, 2, 3]
打开 4 -> setup 4，缓存 [1, 2, 3, 4]
打开 5 -> setup 5，缓存 [1, 2, 3, 4, 5]
打开 6 -> 6 未命中缓存 -> teardown 最久未使用的 1（LRU）-> setup 6，缓存 [2, 3, 4, 5, 6]
切回 2 -> 命中缓存，不重新 setup，仅更新 LRU 顺序，缓存 [3, 4, 5, 6, 2]
```

cache = 1 时与已实现的现状完全一致：新 App setup 完成后 teardown 旧 App（见 6.4 节淘汰时序）。

### 4.3 配置关闭（eager）

保持当前流程：

```text
attributes.apps
    -> 创建 AppProxy
    -> 创建 Box
    -> app.setup()（真实 setup 进入串行队列）
    -> setup 完成后继续现有 focus / zIndex / 事件流程
```

实现上 eager 分支只新增两件事：真实 setup 进入串行队列、批量任务按聚焦优先排序。现有 `AppManager._attributesUpdateCallback()`、`AppProxy.baseInsertApp()` 和 `AppProxy.destroy()` 的默认行为不得因为新增配置而改变。

### 4.4 配置开启（lazy）

初始化时执行以下步骤：

```text
读取现有房间状态
    -> 若 mount params.forceMaximized=true 且当前实例可写：写入 attributes.forceMaximized=true，并调用 manager.setMaximized(true)
    -> 读取 attributes.forceMaximized 和当前 boxState
    -> lazy=true 仅在 forceMaximized=true 且 boxState 为 minimized/maximized 时生效，否则 warning 并降级 eager
    -> 如果当前状态为 minimized，保留 minimized
    -> 创建所有 App shell / View / Box
    -> 选择最大化模式下的 top App（activeAppId 优先）
    -> 只 setup top App（串行队列），其余 App 保持 shell；缓存按需填充
```

`manager.boxState` 是只读 getter，不能直接赋值。由于 `minimized` 在状态组合中优先于 `maximized`，当房间恢复出的状态是 `minimized=true` 时，调用 `setMaximized(true)` 后当前状态仍然是 minimized；之后调用 `setMinimized(false)` 才会进入 maximized。这是允许的状态，而不是初始化错误。

lazy 模式的状态约束为：

| 当前状态 | 允许的转换 | 被禁止的转换 |
| --- | --- | --- |
| `maximized` | `minimized`、关闭 App | `normal` |
| `minimized` | `maximized`、关闭 App | `normal` |
| `normal` | 仅 `forceMaximized=true` 且可写的 mount 初始化请求可转为 `maximized` | 仅带 lazy 参数时继续保持 normal；该实例降级 eager |

因此以下入口在 lazy 模式下必须被统一拦截：

- `manager.setMaximized(false)`；
- `manager.setBoxState("normal")`；
- TeleBox 的 Maximize/Restore 按钮和标题栏双击；
- 远端 attributes 写入 `maximized=false` 后的本地 reaction；
- 删除最后一个 Box 时 TeleBox 的自动 `setMaximized(false)`。

当共享 `attributes.forceMaximized === true` 时，上述 normal 拦截对所有使用全局窗口状态（有效 `useBoxesStatus=false`）且支持该字段的客户端生效，不区分客户端是否开启 lazy。有效 `useBoxesStatus=true` 的客户端忽略该房间策略。其余客户端调用 `setMaximized(false)` 或 `setBoxState("normal")` 都必须 no-op 并 warning；清除该字段必须通过明确的房间级管理操作，不能由删除最后一个 App、普通状态操作或 mount 卸载隐式清除。

`manager.setMinimized(true/false)` 保持可用。进入 minimized 时串行 teardown 全部缓存 runtime；退出 minimized 时按 top App 规则重新 setup（见 6.5 节）。

lazy 配置要求：完成可写 `forceMaximized=true` 初始化请求后，或房间原本已有该字段时，必须再次读取 `attributes.forceMaximized` 和当前 `boxState`；只有字段为 true 且状态为 minimized/maximized 才启用 lazy。仅带 lazy 参数的客户端不能代写字段；字段缺失、为 false 或当前为 normal 时必须 warning 并降级 eager。`forceMaximized: false` 不得清除房间已有的 true。

### 4.5 错误配置和降级

lazy 模式只支持全局窗口状态管理，即等价于 `useBoxesStatus=false`。如果传入：

```ts
{
    lazySetupInMaximizedMode: true,
    useBoxesStatus: true,
}
```

`mount()` 初始化时应通过当前房间 logger 发出 warning，并使用有效配置：

```text
lazySetupInMaximizedMode = true
effectiveUseBoxesStatus = false
```

非 lazy 场景传入 `useBoxesStatus=true` 与 `forceMaximized=true` 时，`useBoxesStatus` 生效，`forceMaximized` warning 后忽略且不得写入房间；房间已经存在 `attributes.forceMaximized=true` 时也只做本地忽略，不清除共享字段。此模式下只有 `forceTop` / `forceNormal` 有效。反之，有效 `useBoxesStatus=false` 时忽略每个 App 的 `forceTop` / `forceNormal`。

如果当前实例不能写房间状态（只读端、Player、回放或未连接状态），且房间没有 `attributes.forceMaximized=true`，或当前房间状态为 normal，则无法保证 lazy 模式的"不允许 normal"约束。此时 `mount()` 应 warning，并将当前实例降级为默认 eager setup；它不得尝试写入 forceMaximized 或自行调用 `setMaximized(true)`。降级原因也必须进入 logger，便于定位低端设备为何没有启用 lazy。

### 4.6 forceMaximized 生命周期

房间级管理 API 定义为：

```ts
manager.setForceMaximized(force: boolean): void;
```

- `setForceMaximized(true)` 仅允许可写房间入口调用（SDK 只校验 `canOperate`，角色/"房间入口"约束由业务层保证）；它写入 `attributes.forceMaximized=true`，并调用 `setMaximized(true)`；
- `setForceMaximized(false)` 仅允许可写房间入口调用；它只清除 `attributes.forceMaximized`，不隐式调用 `setMaximized(false)`。调用方必须先清 force，再显式恢复 normal；反过来调用会被 force 期间的 no-op 拦截且不会自动重试；
- `setMaximized(false)` 在 `attributes.forceMaximized=true` 时始终 no-op + warning，即使调用者没有开启 lazy；
- force 字段从 true 变为 false 后，lazy 实例必须退出 lazy 优化并降级为 eager，补齐尚未 setup 的 runtime；补齐任务进入串行队列并按聚焦优先排序；此过程不自动改变房间的 maximized/minimized 状态；
- force 字段为 true 但房间状态已是 normal 时，lazy 实例不得只 setup top App，应 warning 并降级 eager；可写管理入口再次显式调用 `setForceMaximized(true)` 时才负责重新 `setMaximized(true)`。降级补齐 runtime 必须复用串行 setup 队列。
  **可达性说明（2026-09-19）**：该分支为**防御性兜底**——`forceMaximized=true` 的状态机已在 API、远端 reaction、标题栏与删除路径阻止 normal，正常业务下不可达（仅未升级的 legacy 客户端理论性写入时触发）。业务侧保证客户端版本兼容时，可视作不可达说明保留。

## 5. 共享状态与本地状态边界

```text
房间共享状态                         当前 WindowManager 实例状态
------------------                  ------------------------------
attributes.apps                      shell / runtimeCache (LRU)
attributes.focus                     settingUpApps
attributes.apps[id].state.zIndex   activeAppId
attributes.maximized               pendingFocusAppId
attributes.minimized                lazySetupInMaximizedMode
attributes.forceMaximized            maxCachedAppsInMaximizedMode（本地生效值）
attributes.boxStatus                 setup generation/token
```

### 5.1 必须同步的行为

`manager.setMaximized(true)` 保持现有调用路径和同步语义，因为产品要求进入该模式时房间中的其他客户端也最大化。

### 5.2 不得同步的行为

以下内容只能是当前实例的本地状态：

- 是否延迟 App `setup()`；
- runtime 缓存内容与 LRU 顺序；
- 哪些 runtime 已 suspend/teardown；
- `settingUpApps` 中的 Promise；
- 当前实例的 setup generation/token。

`attributes.forceMaximized` 是本设计唯一新增的房间级策略字段；它只约束有效 `useBoxesStatus=false` 客户端的 maximized/normal 状态，不要求未开启 lazy 的客户端延迟 App setup。未开启 lazy 且使用全局窗口状态的客户端仍然 eager setup，但必须遵守 `forceMaximized=true` 的 normal 禁止规则；独立窗口状态客户端本地忽略。

force 字段的设置/清除必须经过 `setForceMaximized()` 的权限校验；普通 eager 客户端不能通过 `setMaximized(false)` 绕过房间约束。

## 6. App 生命周期模型

### 6.1 缓存与并发集合

lazy 分支维护以下集合：

```ts
// runtime 缓存：插入顺序无关，按 lastUsed 做 LRU（单调访问序号）
// 状态机：setting-up → ready → tearing-down（淘汰/最小化释放）
//   pinned：teardown 抛错后的钉住态（记账保留、按容量计数、排除淘汰，
//   聚焦时按"runtime 存活"处理，不重新 setup）
runtimeCache: Map<string, {
    lastUsed: number;
    state: "setting-up" | "ready" | "tearing-down" | "pinned";
}>;
settingUpApps: Map<string, Promise<void>>;
```

实现说明（1.0.23 已按此落地）：v1 草案中的 `unsetupApps` 集合不再单独维护——App shell 状态由 `AppProxy` 既有机制承接：`setupDescriptor`/`deferredSetup` 表示"已创建待 setup 的 shell"，`isSetup` 表示 runtime 是否就绪。避免两份 shell 状态漂移。

`AppShell` 的内容（AppProxy、scene、View、attributes、Box 几何、kind/options）全部保留在 AppProxy 上；`runtimeCache` 的一项表示一个已创建（或在创建中）的 App runtime；`state` 用于避免对同一 App 并发 setup/teardown。`settingUpApps` 保证同一 App 的重复 setup 请求复用同一个 Promise，不会重复执行 `app.setup()`。

对于未实现可选 `teardown()` 的第三方 App，`maxCachedAppsInMaximizedMode` 是软上限：WindowManager 不具备安全释放其 runtime 的契约，因此淘汰和 minimized 批量释放都必须跳过该 App，并保留 `runtimeCache` 记账。它可以使实际缓存数量超过配置值，但不会形成“runtime 仍活着、缓存却忘记它”的隐形资源。之后重新 focused 时，该条目直接 cache hit，不再次执行 `setup()`。即使 lazy -> eager -> lazy 等模式切换曾清除缓存记账，只要 `AppProxy.isSetup=true`，setup 调度器也只重新登记缓存条目，不会重复调用 App `setup()`。

teardown 与 setup 的竞态由 AppProxy 的 setup 代次（`setupRunGeneration`）守卫：teardown/destroy 会递增代次。若 setup 尚未完成，不向 App 的 `teardown(context, setupResult)` 传入不存在的结果；旧 setup 返回后才用实际结果执行物理 teardown，随后将旧 attempt 按"中止"结算，不标记 ready。晚到的旧 attempt 不能结算新 attempt。若 App 已被 destroy，仍对晚到且成功创建的 runtime 尝试清理；物理 teardown 失败写 error，不能当作清理成功。

### 6.2 setup 与 teardown

AppProxy 构造阶段允许提前完成：

- scene 初始化；
- 根据 `scenePath` 创建 View；
- `AppPageStateImpl` 创建；
- scene callback 和 attributes 绑定。

这些步骤不等于 App runtime setup（已实现的 `deferredSetup` 机制即为此服务（`src/App/AppProxy.ts` setupApp 内））。

runtime 释放与最终销毁继续区分：

```text
teardown()
    只释放 Slide / DocsViewer / Presentation / MediaPlayer runtime、监听器和 DOM
    已实现：src/App/AppProxy.ts `teardown()`

destroy()
    保持现有最终销毁语义：释放 AppProxy、分页状态、View、Box 等全部资源
```

缓存淘汰或 minimized 释放调用 runtime teardown，不调用当前完整的 `destroy()`，否则会把仍需保留的 scene、View 和 shell 一起销毁。

### 6.3 setup 失败

- setup Promise 失败时，从 `settingUpApps` 移除任务，且该 App 不占用 runtimeCache slot（不进入缓存，也不触发对其他缓存项的淘汰）；
- 保留 shell，避免 attributes.apps 与本地 Box 集合不一致；
- 不提交该 App 的 focus；
- 根据现有错误事件和日志约定上报原始错误；
- 如果仍有旧 active App，旧 App 保持 active，直到新 App 成功；
- 只有“用户在本端 TeleBox 切换课件且当前可写”触发的冷 setup 才有权执行 fallback，而且恢复动作只能在该 handoff 的串行任务 `finally` 阶段执行：共享 focus 仍指向有效旧 App 时只把本地 TeleBox 对齐回该 App，不写共享状态；共享 focus 为空或仍指向 setup 失败目标时，从现有 TeleBox 中排除失败目标，选择 `zIndex` 最大的 App，并同步房间 focus 与本地 TeleBox；不得先写入 `focus: undefined` 中间态，也不得再次选择失败目标形成重试循环；
- `focusApp(appId)` 是程序化定向请求，不具备 fallback 权限；目标 setup 失败时返回 `false`，不得恢复 previous、选择最高 `zIndex` 或改写为 `focus: undefined`；
- 由 `attributes.focus` 同步触发的被动 setup 不得执行 fallback，即使当前客户端可写也不能反向覆盖同步来的权威焦点；它只能保持本地 TeleBox 与当前 Attribute 一致，等待焦点来源端处理；
- 只读端在任何 setup 来源下都不得选择 previous 或最高 `zIndex` App，也不得只修改本地 TeleBox 形成分叉；即使 Attribute 指向的目标在本机 setup 失败，也只聚焦该 Box 并等待共享 focus 更新；
- 如果排除失败目标后没有其他 App，保留当前共享 focus 并上报失败，不得 focus 一个尚未 setup 的 Box。

TeleBox 切换出现短暂 `focus: undefined` 的根因是事件顺序：聚焦新 Box 时，TeleBox 会同步遍历 boxes；当旧 Box 排在目标 Box 前面时，会先发旧 Box 的 `blurred`，再发新 Box 的 `focused`。旧实现会在 `blurred` 回调中立即清空共享 focus。lazy 模式必须先用 `pendingLazyFocusAppId/pendingLazyBlurredAppId` 吸收该瞬态，fallback 只能作为这一次 TeleBox handoff 串行任务结束后的最后检查：generation 仍有效、没有更新的 pending 目标，且共享 focus 为空或仍指向 setup 失败目标时，才排除失败目标并选择最高 `zIndex`。普通 `attributes.focus=undefined`、初始化、重连、`focusApp(appId)` 和内部程序化 focus 均不得调用该 fallback。

### 6.4 LRU 淘汰时序

需要淘汰时（缓存满且出现 cache miss）：

1. 淘汰目标 = `runtimeCache` 中 `lastUsed` 最小、且**不是**当前 `activeAppId` / `pendingFocusAppId`、`state === "ready"` 的项；
2. 若候选目标是当前可见 App（仅 cache=1 的切换场景会出现），则先 setup 新 App，新 App ready 并提交 focus 后再 teardown 旧 App（保持已实现的现状体验：旧画面保留到新画面就绪）；
3. 其余情况（cache ≥ 2 溢出）先 teardown LRU 项，再进入串行 setup 队列，避免瞬时 runtime 数超过配置值；
4. 正常路径下 teardown 与 setup 通过同一串行队列协调；超过 10 秒且存在不同最新目标时，旧 setup 仅让出调度租约，实际异步工作仍可能重叠；
5. teardown **抛错**时缓存条目置为 `pinned`（保留记账、按容量计数、排除后续淘汰、error 日志），不阻塞队列；无 teardown 实现的条目同样保留记账并跳过淘汰（见 §13 与本节软超限语义）；
6. `tearing-down` 状态的项不参与命中：对它的 focus 请求视为 cache miss，等待 teardown 完成后重新 setup。

App 被关闭/删除时，仅撤销与该 appId 匹配、尚未启动的最新 pending，并使它的活动 attempt 失效；不得清除后来到达的其他目标。最小化和切后台不是 App 删除，仍接收并保留最新 pending。进行中的 setup 收到 teardown 请求时先失效旧 attempt，待旧 setup 返回后清理，再重新仲裁最新 pending。teardown 请求从发起起运行满 10 秒，经 Room logger.error 上报一次；报警不强制中断第三方 JS，也不将必需清理标记为完成。若 teardown 永不返回，后续 setup 仍可能受阻，需据日志定位异常 App。

这里的“软超限”不是把无 teardown App 移出 `runtimeCache`：它仍作为 `ready` 条目参与记账和 focus 命中，只是不再是可淘汰候选。只有 App 最终 destroy 时才删除该条目。

容量语义说明：cache=1 的交接期（新 App setup 完成 → 旧 App teardown 完成）允许瞬时存在 2 个 runtime。这是"切换时旧画面保留到新画面就绪"的现状体验语义，与第 3 条（cache ≥ 2 严格先淘汰后 setup）并存；两者不可同时成立，以体验优先。

### 6.5 minimized 与缓存的交互

- 进入 minimized：串行 teardown 全部**可挂起**（ready 且可 teardown）的缓存 runtime，并**移除其缓存条目**——LRU 顺序随之清空，退出后按需重新填充，不做批量预热。`pinned` 与未实现 teardown 的条目无法释放，保留记账并按容量计数（见 §6.4/§13）；
- 退出 minimized：按 top App 规则 setup（聚焦优先，串行队列），其余 App 按需重新填充缓存。

## 7. 严格串行的真实 setup 队列

### 7.1 队列定义

WindowManager（AppManager）增加统一的真实 setup 队列：

```ts
private setupQueue: Promise<void> = Promise.resolve();

private enqueueSetup(task: () => Promise<void>): Promise<void> {
    const next = this.setupQueue.then(task, task);
    this.setupQueue = next.catch(() => undefined);
    return next;
}
```

关键点是队列任务必须等待真实 setup 完成：

```ts
await appProxy.baseInsertApp(...);   // shell / Box 创建
await appProxy.ensureSetup();        // 等待 app.setup() Promise 完成
```

而不是只等待 `baseInsertApp()`。`ensureSetup()` 最终会等待 `app.setup()` 的 Promise 完成（`src/App/AppProxy.ts` ensureSetup / runAppSetup）。

eager 路径原先经 `setupApp()` 中 `setTimeout(..., SETUP_APP_DELAY)` 直接启动 `finishAppSetup()`，造成不受控并发；已改为：延迟启动语义保留（属性同步保护），但延迟后的执行交给 `manager.enqueueEagerSetup()` 进入串行队列。

### 7.2 必须入队的路径

以下路径全部复用同一队列，不允许绕过：

- 初始 eager setup（`_attributesUpdateCallback` / `setupAllApps()`）；
- lazy 模式的首次 top App setup；
- cache miss 后的 setup（含 focus 切换）；
- reconnect（`AppManager.onReconnected()`，已由 `Promise.all()` 改为逐 App 串行重建）；
- Player seek rebuild（`onPlayerSeekDone()` 全量重建）；
- `forceMaximized` 清除后的 eager 补齐；
- `addAppAndWaitForSetup()`：eager 沿用串行 setup 队列；lazy 只等待最新 focus pending 驱动的 setup，不直接插入第二条 setup 队列。

`AppCreateQueue` 保持现有职责（AppProxy/Box 创建串行 + ready 事件），不再承担"setup 完成串行"的语义；两者可以并存。

### 7.3 优先级排序：聚焦 App 优先渲染

队列不能是固定 FIFO：批量入队（初始化、reconnect、seek、补齐）时，`activeAppId`（`attributes.focus` / top App）必须最先 setup，保证首屏是用户正在看的 App。

- 队列实现为"每次取任务时按优先级挑选"的调度器，而不是固定 list shift；
- 批量任务的排序键（从高到低）：
  1. 有效 `useBoxesStatus=true` 时，`maxForceTopBox` 对应 App（与 TeleBox top 语义一致）；
  2. `attributes.focus` 指向且存在的 App；
  3. 其余 App 按当前 `zIndex` 降序；
  4. `attributes.apps` 插入顺序兜底；
- 有效 `useBoxesStatus=false`（包括 lazy）时 `forceTop` 无效，因此排序直接从 focus 开始；
- eager 单个新增任务按优先级插入；lazy 新增 App 仅通过统一 focus pending 触发 setup，尚未开始的中间目标被最新目标覆盖；
- 已开始的真实 setup 不重排；lazy 下存在不同 pending 且运行满 10 秒时可让出调度占用，真实 Promise 保留。旧任务晚完成不能释放新任务的占用或提交旧焦点；没有 pending 则继续等待。teardown 等必做清理不按此规则让出。

### 7.4 与 lazy focus 队列的关系

同步 focus、`focusApp(appId)`、TeleBox 和本地新增 App 共用 `LatestTaskQueue` 的一个 pending 槽，再通过 `SetupQueue` 执行当前目标的真实 setup；`SetupQueue` 不积压 lazy 新增 App 的独立等待任务。最小化/后台只关闭消费门禁，不停止写 pending；恢复时用原 setup 起始时间重新判断完成或 10 秒让出。真实 setup 与调度占用分开，A→E→A 复用原 A Promise。真实 setup 运行满 10 秒时经 Room logger.error 记录一次；这不代表第三方 setup 已被物理中断。

最新目标写入 pending 时，撤销 `SetupQueue` 中尚未启动、目标不同的旧 setup；已启动的 setup 仍按完成或 10 秒让出规则处理，因此 A 正在执行、B 已排队、E 成为最新目标时，不再先执行 B。TeleBox 目标在异步缓存清理后、setup 后及写入共享 focus 前，均须确认 AppProxy 仍是当前实例、未销毁且 App 仍在房间 attributes 中；关闭期间失效的目标不能重新提交。点击主画布即使共享 focus 已是 `undefined`，也要写入最新的 mainView pending，以撤销尚未提交的 TeleBox 切换。

## 8. 初始化时序（聚焦优先）

```text
WindowManager.mount()
    |
    v
创建 / 获取 WindowManager 实例
    |
    v
ensureAttributes()
    |
    v
创建 AppManager、BoxManager、TeleBox
    |
    v
恢复房间中的 apps shell
    |
    +-- lazySetupInMaximizedMode = false
    |       -> 进入现有 eager setup 流程（真实 setup 进入串行队列，聚焦 App 最先）
    |
    +-- lazySetupInMaximizedMode = true
            -> 校验 lazy 配置和可写能力
            -> 仅 forceMaximized=true 的可写初始化请求调用 manager.setMaximized(true)
            -> 读取 attributes.forceMaximized 和当前 boxState；字段缺失/为 false 或状态为 normal 时 warning 并降级 eager
            -> 保留 minimized 状态，不强制解除最小化
            -> 创建所有 App shell / View / Box
            -> setup 当前可见 top App（activeAppId 优先；minimized 时不 setup）
            -> setup 成功后提交 focus；其余 App 保持 shell，缓存按需填充
```

初始化只 setup 一个 App，与 `maxCachedAppsInMaximizedMode` 的数值无关（不预热，见 3.2 节）。

lazy 配置校验应在 `mount()` 初始化阶段完成；状态归一化应放在 BoxManager 创建后、`internalEmitter.emit("onCreated")` 之前，使 `onCreated()` 注册的 autorun 看到一致的最大化状态。不要清理 minimized。归一化必须幂等，重复执行不能反复向房间写入相同状态。

如果 mount 事务在共享 `maximized=true` 写入后失败，应使用 mount 前保存的状态尝试恢复原值，避免留下半初始化的房间状态。App setup 失败属于单 App 错误，不应回滚整个房间的最大化状态。

## 9. Focus 切换时序（多缓存）

lazy 分支中，`attributes.focus` 可以先发生变化，但它不能立即被当作"runtime 已可操作"的证明。

```text
监听 attributes.focus
    |
    v
记录 pendingFocusAppId
    |
    v
确保目标 App shell 存在
    |
    v
命中缓存？
    +-- 是 -> 更新 lastUsed，直接提交 focus
    |
    +-- 否 -> 按需淘汰（6.4 节）-> 串行队列 setup（复用 settingUpApps Promise）
                    |
                    v
              目标 App ready
                    |
                    +-- generation 仍然有效？ -- 否 -> 丢弃过期结果
                    |
                    是
                    |
                    v
              向 TeleBox 提交 focus / zIndex
                    |
                    v
              按需 teardown 被淘汰的缓存项
                    |
                    v
              更新 activeAppId
```

提交 focus 前，操作路由仍应使用 `activeAppId`，不能因为 `attributes.focus` 已变化就提前把分页、事件或 unified page control 路由到尚未 setup 的 App。

setup 任务需要 generation/token，防止快速连续切换 A -> B -> C 时，B 的过期 Promise 在 C 之后完成并错误地重新激活 B。

### 9.1 接入方调用注意事项：focus 后立即翻页

`focusApp()` 在 lazy 模式下是异步提交：`attributes.focus` 可以已经指向目标 App，但目标 runtime 仍可能处于 pending 或 setup 中。与此同时，`dispatchDocsEvent()` 未显式传入目标时，会在调用瞬间使用当前已聚焦 App 解析目标。因此，接入方不得用 fire-and-forget 的 `focusApp()` 紧接分页命令：

```ts
// 错误：没有等待 C 完成 setup 和 focus 提交。
void manager.focusApp(cAppId);
void manager.dispatchDocsEvent("nextPage");
```

Native 对外分页 API 不要求也不应为了规避该竞态而暴露 `appId`。标准调用顺序是先等待目标 App 完成 setup 和 focus 提交，再对“当前已提交焦点”执行分页：

```ts
const committed = await manager.focusApp(cAppId);
if (committed) {
    await manager.dispatchDocsEvent("nextPage");
}
```

如果 Native 层把未提交映射为异常，也可以提供以下等价的 await 形式；第二行只允许在第一行成功完成后执行：

```csharp
await manager.FocusApp(cId);
await manager.DispatchDocsEvent("nextPage");
```

`focusApp()` 的异步结果必须贯穿 WindowManager、Whiteboard-bridge 和 Native SDK：成功只表示目标 runtime 已 setup、Box focus 已提交且 App focus 事件已完成；请求被更新请求取代、超时或 setup 失败必须返回失败或 reject。调用方收到失败后不得继续发送依赖该 focus 的分页命令。现有同步/void 重载可以为兼容保留，但不得用于上述有顺序依赖的调用。

App focus 事件本身也是 completion barrier：App 的 `context.emitter.on("focus")` listener 必须返回本次异步资源切换的 Promise，不能用 `void` 丢弃；WindowManager 通过 `Emittery.emit()` 等待该 Promise。以 Slide 为例，`focus(true)` 只有在 `release()`、player 重建及 `setSlideState()` 完成后才成功；重复的同状态 focus 必须复用正在执行的 Promise。listener reject 或 focus-event watchdog 超时时，本次 lazy `focusApp()` 返回 `false`，不得先提交成功。App 内部可以串行 freeze/unfreeze，但只有把同一 Promise 逐层返回到 WindowManager，串行才同时构成对调用方有效的完成屏障。

这里的 pending 需要区分两层：三种来源均先进入同一最新 pending；旧 setup 完成，或运行已满 10 秒且有不同目标时，才在前台且非最小化条件下处理新目标。让出不强制中断真实 JS 工作。被取代的 `focusApp(C)` waiter 则立即返回 `false`，不取消 C setup、不移除 E pending，也不能在 E 完成后返回 C 成功。API 的独立 10 秒期限从调用开始计时，因此可以先返回 false、目标之后才显示。

focus 通知失败/超时后，去重记录整体置为 unknown，不回滚旧布尔值；同状态和反向状态都能重试，旧通知不能覆盖新记录。通知以 runtime epoch 和 activity revision 隔离。Slide 的 focus、visibility、minimized 使用同一资源串行链；`runtimeActivity` 事件通知包含 cache 外仍存活的实例，恢复不依赖新 focus 事件。

`focusApp` 的 `appId: string` 是必填参数，不提供无参数清焦点语义。其 pending、被取代或 setup 失败路径不得用 `focus: undefined` 作为中间回退；`focus: undefined` 只由既有的主动 blur、最小化、关闭 focused App 等业务流程产生。

各端映射如下：Android 保留 `focusApp(String)`，新增 `focusApp(String, Promise<Boolean>)`；iOS 保留 `focusApp:`，新增 `focusApp:completionHandler:`；Harmony 的 `focusApp(appId)` 返回 `Promise<boolean>`。非 lazy 模式不能因为新增 await 契约而改变原时序：WindowManager 仍在 `focusApp()` 调用栈内同步执行原有 `focusBox/makeBoxTop`，随后返回立即 resolve 的 `true`；只有 lazy 模式等待 setup 与 focus commit。

Web 的 `target` / `appId` 仍可作为高级定向能力保留，但不是 Android 等 Native SDK 的标准公开用法；Native 的 `dispatchDocsEvent` 默认操作当前已提交的聚焦课件。若业务允许其他调用方在两次 await 之间再次切换焦点，则需要在更高层串行化“focus + command”，不能依靠 fire-and-forget 调用维持目标稳定。

Slide 的 Magix 同步事件使用 `${appId}:${event}` 命名空间隔离。C、D 的 `nextPage` / `nextStep` 事件只能进入 C、D 各自的 Slide 实例和状态；未 setup 的只读端没有相应监听器，后续 setup 时从该 App 的 storage 状态恢复。这些事件不会进入 E 的 Slide 队列。若观察到 E 被翻页，应首先检查调用方是否省略了 `target`，导致命令在调用时直接解析为 E，而不是把它判断为 C、D 事件跨 App 泄漏。

## 10. 最大化标题栏 close

lazy 场景重点是最大化标题栏的 close，不优先改造 Box 内容区域中的 close。

lazy 模式下 TeleBox UI 不允许用户进入 normal：

- 最大化状态下隐藏或 disabled Maximize/Restore 按钮；
- 标题栏双击也不能触发 maximized 到 normal；
- Minimize 按钮继续保留，允许进入 minimized；
- Close 按钮继续保留。

现有 `forceNormal` 语义是"只保留 close 按钮"，不能直接复用来表达这个需求。TeleBox 应增加明确的 `disableNormalTransition` 或等价内部配置，并同时拦截按钮事件和双击事件。

当前 TeleBox 最大化标题栏 close 的行为近似为：

```text
remove 当前 top Box
    -> focusTopBox()
```

lazy 模式下必须改为：

```text
remove 当前 App / Box
    -> 找到下一个最大化 top Box
    -> 暂不立即 focus
    -> WindowManager setup 下一个 App（命中缓存则直接提交）
    -> 就绪
    -> TeleBox commitFocus(nextBox)
```

建议为 TeleBox 增加窄范围的延迟能力，例如标题栏 close 使用 `deferFocus`，或者提供一个由 WindowManager 明确调用的 `commitFocus`。异步 Promise 不应直接塞进 TeleBox 的同步事件处理函数。

配置关闭时，仍执行原有的 `remove -> focusTopBox()`，不能让 TeleBox 的默认行为变成异步。

如果删除最后一个 Box，TeleBox 当前实现可能自动执行 `setMaximized(false)`。lazy 模式不允许该自动转换直接生效：WindowManager/TeleBox 应在删除路径中识别 lazy 状态，保留共享 maximized 标志，或者只在房间没有任何 App 且产品明确允许空窗口时执行一次受控清理。不能出现 false -> true 的反复共享写入。

空 App 集合的内部清理仍遵循现有的 App 数量相关标题栏逻辑，但不能覆盖显式的全屏控制。`fullscreen` 状态和 `setFullscreen()` 的优先级高于 App 数量推导：当调用方显式设置全屏状态时，标题栏必须按该状态显示或隐藏；后续 Box 增删只允许更新非全屏场景下的默认可见性。这样既保持当前逻辑，也保证即使没有 App，`setFullscreen(true/false)` 仍能按原语义控制最大化标题栏。

## 11. 页面恢复

lazy setup 不能丢失 App 原本的页面位置。

- `fullPath` 是恢复指定 scene/page 的首选权威值；
- App View 在 setup 前可以先设置 `focusScenePath`；
- AppProxy 必须在创建 `AppPageStateImpl` 前同步创建 View，避免分页状态持有未定义的 View；
- runtime teardown 后再次 setup 前，必须重新挂载 `fullPath`/scenePath 属性监听，并立即按当前 `fullPath` 恢复 View（已实现的 `attachSetupScope()` 重挂即为此服务（`src/App/AppProxy.ts` ensureSetup））；
- Presentation 已经可以从 View path 解析页面；
- Dynamic DocsViewer 应优先使用 App View 的 path，而不是只读取全局 `displayer.state.sceneState.index`；
- Slide 需要协调 `fullPath` 与 storage 中的 `state.currentSlideIndex`，避免 setup 后先跳到目标页又被旧 storage state 改回去。

页面恢复应在目标 App 的 setup 流程内完成，不能在 focus 提交之后再异步修正页面，否则用户会先看到错误页面。

## 12. TeleBox 与 WindowManager 的职责

### WindowManager

- 判断当前实例是否启用 lazy setup；维护 `maxCachedAppsInMaximizedMode` 生效值；
- 创建和维护 shell / `runtimeCache`（LRU）；
- 根据 focus 和 zIndex 选择 top App；lazy 模式下不读取 `boxStatus`；
- 维护严格串行 setup 队列（含聚焦优先排序）、generation 校验和 runtime teardown；
- 在 setup ready 后提交 focus；
- 拦截所有现有 focus/zIndex 提交点，避免 shell 创建完成就提前显示或 focus 未 setup App；
- 维持默认 eager 分支行为不变（仅 setup 串行化）。

### TeleBox

- 继续管理 Box 的几何、zIndex、标题栏和同步事件；
- 默认情况下保持同步 focus 行为；
- 仅在 WindowManager 请求时延迟最大化标题栏 close 后的自动 focus；
- 接收 WindowManager 的 `forceMaximized` 构造参数和运行时 setter；为 true 时屏蔽 normal/restore UI、双击和对应的同步事件，为 false 时恢复原有 UI；
- 不负责调用 App 的 `setup()`，也不持有 WindowManager 的 runtime 缓存。

## 13. App runtime teardown 契约

`NetlessApp` 接口已扩展可选 teardown 契约（`src/typings.ts` NetlessApp、`src/App/AppProxy.ts` teardown/destroy）：

```ts
interface NetlessApp {
    setup(context: AppContext): SetupResult | Promise<SetupResult>;
    teardown?: (
        context: AppContext,
        setupResult: SetupResult,
    ) => void | Promise<void>;
}
```

约束如下：

- `teardown()` 只释放 Slide/DocsViewer/Presentation/MediaPlayer runtime、DOM、监听器和资源；
- `destroy` 事件仍只用于 AppProxy 最终销毁；
- teardown 后允许重新创建新的 AppContext 并再次执行 `setup()`；
- 每次 `setup()` 必须拥有独立的 setup scope；teardown 必须清理本次 setup 在 `context.emitter`（该 emitter 由 AppProxy 复用）上注册的全部监听器和订阅，不能依赖创建新的 AppContext 自动获得新的事件总线；
- WindowManager 在允许 re-setup 前应确认旧 setup scope 已释放，避免同一 App 多次切换后 destroy/事件监听器线性累积；
- `teardown()` 必须幂等，重复调用不能抛错；
- 没有实现 teardown 的第三方 App 不能被静默地当作可安全 suspend 的 App（现状：teardown 无实现分支 warning 并永久保留 runtime）。**已实现策略**：`canTeardown=false` 的条目保留 runtime 与缓存记账、不参与淘汰、minimized 批量释放时跳过——缓存按其数量软超限（见 §6.4）；已实现 teardown 但**执行中抛错**的 App，其缓存条目置为 `pinned`（保留记账、排除淘汰、error 日志），直到 runtime 被证明可再次安全释放。

v1 中"三个内置 App 需要同步实现 teardown"的结论已过时：`app-slide`、`app-docs-viewer`、`app-presentation`、`app-media-player` 四个 App 均已实现 `teardown`（见 2.3 节路径）。v2 剩余工作是各 App 的 setup ready 契约（第 14 节）与 presentation 失焦降级（第 15 节）。

## 14. 内置 App setup 串行化改造

WindowManager 侧串行队列只能保证"调用串行"。要真正做到"上一个课件的首屏资源就绪后才开始下一个课件"，四个内置 App 必须让 `setup()` 的返回 Promise 覆盖首屏关键资源，同时提供超时与失败路径，避免 setup 队列被单个 App 永久阻塞。

契约更新（2026-09-24）：以下严格 ready 能力已接入 Slide/Presentation；docs-viewer/media-player 仍沿用其原有 ready 超时策略，本次未扩大改造范围。

- `setup()` 返回的 Promise 必须在"首屏可见资源 ready"后 resolve；
- 默认 5s（可由 AppOptions `setupReadyTimeout` 覆盖）是首屏警告阈值；新宿主 `context.waitForActualSetupReady=true` 时继续等真实 ready，旧宿主/eager 保留超时 resolve 的兼容行为。
- 新 lazy 契约下，Slide 首帧错误、Presentation 已发起请求的首图失败和 ready 前 disposal 均终止 setup；不能把失败当成 ready。
- 超时让出不 cancel 后台加载本身，也不伪造 setup 成功。
- 区分首屏警告（默认 5s）、宿主当前工作让出阈值（10s）、focus listener 超时和 API 调用期限。后两者失败不取消 pending。
- `app setup start/done/duration` 记录真实工作；正常路径串行，10s 异常让出后可能重叠，并输出 warn。该机制不能中断同步阻塞主线程的 JS。

### 14.1 app-slide

- `SlideDocsViewer.mount()` 暴露 ready Promise；
- ready = `SlideController.readyPromise`，至少等待首个 `renderEnd`；
- `app-slide.setup()` 返回该 Promise；
- 渲染失败（slide error）映射为 reject；新 lazy 宿主上超时仅 warn、继续等待，旧宿主/eager 保留 warn + resolve。

### 14.2 app-docs-viewer

- 静态 viewer：等待首个可见页面图片 `load`/`decode`；
- Dynamic viewer：至少等待 DOM mount 与首个 View render tick；
- 不等待所有页面图片，否则大 PDF 会长时间阻塞 setup 队列；
- 保持 PageRenderer 现有的可见页懒加载不变。

### 14.3 app-presentation

- `Preload` 增加启动控制：setup 阶段聚焦当前页（`touch(pageIndex, true)`）；后续页面预加载**维持既有 Preload 链**——当前页 onload 后经 `requestIdleCallback`（100ms timeout 兜底）递进，`maxLinks=5` 限流，不与 setup 队列联动（v1 草案"延迟到队列空闲"不再要求）；
- 不重排 `prepareScenes()` 与重 runtime 的创建顺序（该顺序重构侵入 setup 主体，收益有限）：以"创建后立即聚焦当前页 Preload + setup 等待当前页首图"达成同等内存目标；
- setup 返回当前页首图 ready（背景 `<img>` complete 且 naturalWidth > 0）；新 lazy 宿主上 5s 仅 warn，首图 error 则失败；旧宿主/eager 保留有界等待；
- 该 App 同时落地第 15 节的失焦缩略图降级。

### 14.4 app-media-player

- 给 `MediaPlayer` 组件增加 ready callback/Promise；
- setup 至少等待 video.js 实例创建完成；若产品要求首帧可见，则等待 `loadedmetadata`；
- `initPlayer()` 增加取消 token：teardown 发生在初始化完成前时，取消后续 DOM 写入；
- `componentWillUnmount()` 必须与未完成的 `initPlayer()` 协同，避免"已卸载 DOM"异步异常；
- ready 等待超时可配置：per-app AppOptions `setupReadyTimeout` > 全局 `setOptions({ setupReadyTimeout })` > 默认 5s。

### 14.5 验收标准

- 记录每个 App setup 开始/结束时间；正常串行，超过 10s 且有不同 pending 的逻辑让出必须有 warn，不把异常重叠计为真实取消。
- 新 lazy 宿主的 Slide 首帧、Presentation 首图不得晚于 setup 成功；旧宿主/eager 及本次未改造 App 的超时兼容路径单独记录。

## 15. app-presentation 失焦缩略图降级（frozen/unfrozen 模式）

### 15.1 参考模型：app-slide freezer

`app-slide` 已有一套失焦降级机制（`slide-app/packages/app-slide/src/utils/freezer.ts`）：

- `FreezableSlide { freeze; unfreeze }`，`useFreezer` 默认关，`FreezerLength = 2`；
- 通过 `WindowManager.register({ kind, src, addHooks })` 的 kind 级 emitter 监听 `"focus"` 事件维护按 zIndex 排序的 LRU 焦点队列；队列超长时冻结 zIndex 最低者；
- `freeze()` → `slide.frozen()`：截图缓存当前画面、销毁 player/WebGL，保留状态与 DOM；`unfreeze()` → `slide.release()`：重建 player、按 storage 恢复页码/动画；
- frozen 与 teardown 的区别：frozen 保留 Slide 实例与 DOM、可快速恢复；teardown 彻底销毁 runtime，需要完整 setup 重建。

`app-presentation` 需要一个类似定位更轻的机制：**不销毁播放器/渲染器，只在失焦且仍被缓存时，把页面大图 DOM 替换为低分辨率缩略图**，释放全量位图内存；重新聚焦时换回大图。

### 15.2 white-sdk 背景渲染链路（为什么必须走 DOM，而不是 scene API）

关键事实（white-web-sdk 源码）：

- PPT 每页图片由 scene 的 `ppt`（`PptDescription { src, width, height, previewURL? }`）描述；`SceneNode` 构造时把它包装成第 0 号组件 `BackgroundImage`（`white-sdk/model/src/scene/SceneNode.ts:14-24`）。
- 背景层的渲染是**真实 DOM `<img>`**：`BackgroundImageComponent` 对静态转换图直接渲染 `<img src={ppt.src} width height>`（`white-sdk/render/src/views/others/BackgroundImage.tsx:68-77`），挂在 orderIndex 0、className 为 `background` 的纯 HTML 引擎层（`white-sdk/render/src/views/RegisterImplement.ts:33-38`）；画笔在其上的 SVG/canvas 层。`app-presentation` 自身的主图 `<img>` 已被废弃（注释保留在 `netless-app-presentation/src/presentation.ts:93-95`、`updateImage()` 只剩 Preload 触发，`netless-app-presentation/src/app-presentation.ts:1238-1241`）。
- `page.thumbnail` 正是 `ppt2page()` 从 `ppt.previewURL` 映射而来（`netless-app-presentation/src/app-presentation.ts:147-155`；`PresentationPage.thumbnail?: string`，`netless-app-presentation/src/presentation.ts:9-15`）。

为什么不能用 scene API 重置背景：

- 没有原地修改背景的 API，只能对同名场景重新 `putScenes`（`white-sdk/web-sdk/src/displayer/Room.ts:300`）；
- `putScenes` 是整节点替换：旧 `SceneNode`（连同全部板书组件）被只含新背景的新节点顶掉，场景 id 变化（`white-sdk/model/src/scene/SceneManager.ts:120-143`）；
- 它是 `stateTrigger.activeUpdate("sceneState", ...)` 的 akko mutation，会**同步广播给房间所有人并持久化**（`white-sdk/web-sdk/src/displayer/RoomImplement.ts:1061-1081`）；
- 场景变化触发场景渲染整体重建（`white-sdk/render/src/render/WhiteboardRender.ts:131-154`），背景 `<img>` 重新挂载/重新拉流解码，房间内每个端都要做一遍；
- 场景 id 变化使 `ViewFocusScene` 失效、`focusScenePath` 复位（`white-sdk/web-sdk/src/displayer/views/ViewFocusScene.ts:62-68`），undo 栈也要重绑。

**结论：失焦降级是纯本地视觉优化，必须只做 DOM 层的 `img.src` 替换，禁止调用任何 scene API（`putScenes`/`removeScenes`/`cleanCurrentScene` 等）。**

### 15.3 设计

**焦点信号（window-manager 侧）**

`focus: boolean` 事件（`src/typings.ts`，1.0.23 已实现发射）有三个来源，统一经 `AppProxy.emitAppFocusEvent()` 出口（带变更去重，setup 完成时的初次同步强制发射）：

1. **attributes.focus autorun（权威来源）**：`AppManager.onFocusChange()` 在焦点变化时向旧 focused App 发 `false`、新 focused App 发 `true`。此来源覆盖程序化/远端 focus 变化，且在只读端、Player 上同样工作——v1 草案"由 AppProxy 监听 Box focus/blur"的单一来源在 eager 模式（`focusBox` 默认 skipUpdate 不触发 telebox Focused/Blurred）与只读端（BoxManager 有 `canOperate` 门禁）存在覆盖缺口，已废弃该依赖；
2. **box focus/blur 事件**：本地点击等场景在 attributes 同步前提供早期信号；
3. **setup 完成同步**：`finishAppSetup` 成功后按当前 `isFocused` 强制发射一次，保证 App 在 setup 期间订阅后能看到一致的初值。

同时提供只读 getter `AppContext.isFocused(): boolean`。注意：事件只保证"最终一致"，可能重复（去重后跨来源仍可能连续发射同向值），App 侧必须幂等处理。

订阅 `focus:boolean` 并执行资源副作用的内置 App，其资源焦点状态遵循以下约束：

- 每次 runtime setup 完成时，资源状态从 `focused=true` 开始，而不是用当时的 `box.focus` 初始化。这样 setup 期间已经被 pending focus 替换的旧目标，仍会接受并执行 setup 后补发的首个 `focus(false)`；
- App 同步记录最后一个已接受的焦点状态；与该状态相同的重复事件直接忽略，避免重复 freeze/unfreeze、Preload pause/resume 或 DOM 资源降级；
- `app-slide` 的 freeze/unfreeze 可能异步完成，相反状态必须按收到顺序串行执行。例如 `false -> true -> false` 必须完整保序，不能 latest-wins 合并；否则正在完成的 freeze 可能覆盖后续 unfreeze；
- `app-presentation` 当前降级/恢复操作为同步流程，可在整段 handler 入口按已应用状态去重，无需异步队列；
- lazy 已关闭、controller 尚未创建，或 `focus(false)` 不满足 maximized/minimized 降级条件时，不推进 App 的已接受状态。后续条件成立后的同值事件仍需有机会执行。

`app-docs-viewer` 与 `app-media-player` 当前均不订阅 App `focus:boolean`，因此重复或重叠 focus 事件在这两个 App 内没有执行路径，不需要维护无副作用的焦点状态：

- DocsViewer 没有 freeze/unfreeze 或失焦资源降级契约。为 focus 事件新增空状态变量不能减少任何开销；把失焦映射为销毁图片/View 会改变缓存命中的恢复成本，需要单独设计；
- MediaPlayer 在 App 失焦后仍按共享 attributes 继续同步播放，这是当前产品语义。现有 `visibilitychange` 仅用于带 `__pcmProxy` 的浏览器标签页隐藏/显示处理，不是 App focus 事件，也不能用 App focus guard 合并；
- 如果后续为两者增加本地 suspend/resume，必须在增加副作用的同一变更中加入状态去重；只要操作含异步过程，就必须像 app-slide 一样保序并覆盖失败重试。

**app-presentation 侧行为**

前提：整套失焦降级是 lazy 模式专属的缓存优化——事件处理器触发时**动态**检查 `windowManager.lazySetupInMaximizedMode`（运行时可能变化，如 forceMaximized 被清除后实例降级 eager），非 lazy 模式直接忽略 focus 事件；eager 模式即使处于 maximized 状态也不降级。

在 `setup()` 中订阅 `context.emitter.on("focus", isFocused)`（并注册进本次 setup scope，teardown 时清理）：

```text
focus=false（失焦）
    条件：本 App 未被 teardown（仍在缓存中），且当前 boxState 为 maximized/minimized
    动作：把当前页背景 <img> 的 src 替换为 page.thumbnail（即 ppt.previewURL）
          - page.thumbnail 不存在 -> 跳过，保持原样
          - 同时暂停 Preload（销毁 in-flight <link rel=preload>，停止后续调度）
          - 纯 DOM 赋值，不调用任何 white-sdk scene API

focus=true（重新聚焦）
    动作：把背景 <img> 的 src 恢复为当前页完整大图 src（page.src）
          - 恢复 Preload：preload.touch(pageIndex, true)
          - 同样纯 DOM 赋值
```

条件说明：

- "CachedApps 非 1"由"失焦且未被 teardown"自然覆盖：cache=1 的 lazy 模式下失焦会很快 teardown（DOM 随之移除），替换是无害的空操作；多缓存时失焦 App 长期驻留，替换才有意义；
- 增加 `boxState ∈ {maximized, minimized}` 守卫，避免 eager normal 平铺窗口下可见 App 的画质回退（lazy 模式不可能出现 normal，该守卫只为 eager 复用同一逻辑时兜底）；
- 只依据 `isFocused` 判断（辅以 lazy 与 boxState 守卫），不读 zIndex、不判断遮挡；
- `app-slide` 的 blur freeze（`context.emitter.on("focus")` → `SlideController.freeze()/unfreeze()`）遵循完全相同的守卫链（lazy 前提 + maximized/minimized），实现位于 app-slide setup 的 focus 订阅。
- `app-slide` 同时跟踪权威 focus 与 `document.visibilityState`：仅 `focused && visible && !minimized` 时允许 `unfreeze()`；失焦、浏览器进入后台或 minimized 任一条件成立时保持/进入 `freeze()`。后台收到 `focus=true` 只记录目标状态，回到前台后再解冻。

**背景 `<img>` 的定位方式**

- 替换目标是 `context.getView()` 容器内 background 引擎层（className `background`，orderIndex 0）中的 `<img>`；通过 DOM 查询定位（可按 `alt="background"` 等稳定特征），**不经过 scene/model API**；
- 需要记录原始 `src`（或直接从 `pageIndex$` 对应 `page.src` 取回），供恢复时使用。

### 15.4 边界与风险

- **React 重渲染覆盖（已实现缓解）**：背景 `<img>` 由 SDK 的 React 组件渲染，场景节点变化或 onError 重试可能触发重渲染、把 `src` 写回大图。实现方式：在 view 容器上注册**捕获阶段** `load` 监听（`load` 不冒泡但捕获可用），失焦 episode 期间任何背景图完成加载都立即重新应用缩略图 src——同时覆盖远端翻页、React 重渲染与 SDK onError 重试三条路径；URL 比较按解析后的绝对 href 进行，保证循环终止；
- **远端翻页**：失焦期间远端翻页会生成新场景的新背景 `<img>`（大图），由上述 load 捕获监听自动重新降级；失焦 episode 内翻到无 `previewURL` 的页时跳过该页、后续有缩略图的页继续降级（episode 标志与"当前页已降级"分离为两个状态：`blurEpisode` / `reDegradeEnabled`）；
- **缩略图自身加载失败（已实现缓解）**：捕获阶段 `error` 监听在背景图 error 且处于失焦 episode 时关闭 `reDegradeEnabled`，停止本 episode 的重降级，避免与 SDK 背景组件自身的 onError 重试（最多 3 次）来回拉锯；聚焦恢复时仍强制 `restore()` 全图，破损缩略图不会停留到聚焦态；
- **恢复时机**：`focus=true` 的事件发射点应在 `focusBox`/`makeBoxTop` 之后、App 完全可见之前，恢复大图有网络/解码延迟时短暂显示缩略图属于可接受降级；
- **浏览器内存**：`src` 替换后旧大图由 GC 释放；恢复时大图通常命中 HTTP 缓存，代价可控；
- **与 teardown 的竞态**：失焦替换后立即 teardown 是合法序列：teardown 移除 DOM，替换逻辑必须幂等且不抛错；teardown 后收到的过期 focus 事件必须被 setup scope 清理机制忽略；
- **thumbnail 缺失**：转换任务未生成 `previewURL` 时直接跳过，不做本地降采样兜底（保持行为可预期；后续如需兜底另立配置）；
- **侵入 SDK 内部 DOM 的说明**：直接改 SDK 渲染的 `<img>` 属于受控的白盒优化。若未来 white-sdk 提供官方的背景降级 API（如 `view.setBackgroundSrc()`），应迁移过去并删除 DOM 查询逻辑。

### 15.5 验收标准

- cache ≥ 2 时，presentation 失焦后其背景 `<img>` src 等于 `page.thumbnail`（存在时），重新聚焦后恢复为 `page.src`；
- `page.thumbnail` 缺失时不发生任何 src 变化；
- 全程不触发 `putScenes`/`removeScenes`/`cleanCurrentScene`，房间 `sceneState` 无 diff、其他客户端无感知；
- 失焦期间远端翻页后，新页背景同样被降级；
- 失焦替换后立即 teardown 不抛错、无内存泄漏（监听器随 setup scope 清理）；
- cache=1（失焦即 teardown）与 eager normal 模式下行为与现状完全一致。

## 16. 重连、Focus 和新增 App 的补充设计

### 16.1 重连

基线状态：`AppProxy.onReconnected()` 销毁后经 `baseInsertApp()` 重建并重新 setup，`AppManager.onReconnected()` 原先使用 `Promise.all()` 并发。现已改造为分流并串行化：

```text
重连
    -> 恢复所有 App shell / View / Box
    -> minimized：不 setup runtime
    -> maximized：按第 7.3 节优先级串行 setup（聚焦 App 最先；cache 模式下只保留允许数量的 runtime）
    -> setup ready 后再提交 focus
```

重连路径必须复用同一个 `settingUpApps`、setup 串行队列和 focus generation，不能通过旧的 eager `baseInsertApp()` 绕过 lazy 状态机。

Player 的 `onPlayerSeekDone()` 触发全量 attributes 重建，必须按同一流程处理：先恢复 shell，再按当前 minimized/maximized 状态串行 setup 允许的 App，不能让全量 `_attributesUpdateCallback()` 并发 setup 所有 App。

### 16.2 Focus 拦截清单

需要统一经过 lazy focus coordinator 的入口包括：

- `AppManager.onFocusChange()`；
- `AppManager.focusByAttributes()`；
- `BoxManager.updateBoxState()` 中延迟的 `focusBox()`；
- TeleBox collector 的 `minimized=false` 事件（解除最小化后不得直接 `setAppFocus()`/`focusBox()` 未 setup 的 top App）；
- `AppProxy` zIndex reaction 中的 `setZIndex()` + `focusBox()`；
- `AppProxy` setup / addApp 路径中的初始 focus；
- `AppManager.addApp()` 在 minimized 状态下先解除最小化的路径（`afterAddApp()`）；
- `WindowManager.focusApp()`；
- TeleBox 本地点击、标题栏 close 后的 `focusTopBox()`；
- 远端 focus、zIndex 和 reconnect 恢复。

eager 模式下 coordinator 必须同步放行这些请求；lazy 模式下未 setup 的目标只能进入 pending，不能先变更 TeleBox focus 或 zIndex。

解除最小化统一执行：`setMinimized(false)` -> 重新计算 top App -> setup 成功 -> 提交 focus/zIndex。不能沿用 TeleBox `minimized` 事件中的同步 focus 快路径。

### 16.3 新增 App

- 远端新增 App：先创建 shell，只有它成为当前 top App 时才 setup；
- 当前客户端 `addApp()`：沿用现有 focus 语义，若新 App 成为 top，则由 lazy coordinator setup 后提交 focus；
- `addAppAndWaitForSetup()`：这是显式的 ready API。lazy 下新增 App 沿用 `addApp()` 的焦点语义，只有它仍是最新目标时才由统一 pending setup；setup 成功才 resolve。若被新目标覆盖、创建或等待超时，则 reject，但不销毁已创建的 App shell；真实 setup 失败才沿用失败清理。API 从调用起最多等待 20 秒，其中旧 setup 的让出阈值为其开始后的 10 秒，新目标开始 setup 后至多使用剩余期限；创建阶段也占用这 20 秒预算；
- 仅有效 `useBoxesStatus=true` 时，`forceTop` App 的选择与 TeleBox 一致；lazy 使用全局窗口状态，忽略 `forceTop`，初始化、标题栏 close 与下一 top 均由 focus/zIndex coordinator 选择；
- 新增 App 不能直接调用旧 eager `baseInsertApp()` 绕过缓存与 coordinator。

lazy 实例处于 `minimized` 时，当前客户端新增 App 不会自动解除最小化；新 App 只创建 shell，直到调用方显式解除最小化，才按 top App coordinator setup。`addAppAndWaitForSetup()` 不再把 shell 创建误报为 ready；20 秒内未能 setup 则拒绝等待，但保留 shell。这样可以保持"最小化期间不创建重 runtime"的性能约束。

本地点击未 setup App 时，WindowManager 会先暂时撤销 TeleBox 的本地视觉 focus，但不会把仍然有效的房间级 `attributes.focus` 写成 `undefined`；旧 focused App 会保持为共享 active，直到新 App setup 成功后再提交新的 focus。

## 17. 兼容性要求

### 未开启配置

- `AppManager._attributesUpdateCallback()` 的创建顺序和 setup 行为不变（真实 setup 串行化对调用方不可见，只改变时序重叠）；
- `manager.focusApp()`、TeleBox 本地点击、远端 zIndex/focus 更新保持现有语义；
- `destroy()` 继续执行完整 App 销毁；
- 不引入新的异步 focus 等待。
- 当 `attributes.forceMaximized=true` 且当前客户端有效 `useBoxesStatus=false` 时，`setMaximized(false)` / `setBoxState("normal")` 为 no-op + warning；有效 `useBoxesStatus=true` 的客户端本地忽略该字段并保留独立窗口语义。

### `forceMaximized` 协议兼容

- `attributes.forceMaximized` 是房间级协议字段，不是仅供 lazy 客户端读取的本地标记；
- 支持该字段的 WindowManager/TeleBox 版本必须在有效 `useBoxesStatus=false` 时，从 API、远端 reaction、标题栏按钮、双击和删除空集合路径统一禁止 normal；有效 `useBoxesStatus=true` 时不得消费该字段；
- 未升级的旧客户端无法被该字段自动约束，接入方必须保证房间内使用兼容版本，或明确接受旧客户端仍可能写入 normal；
- `MountParams.forceMaximized`、`lazySetupInMaximizedMode`、`maxCachedAppsInMaximizedMode` 必须同步透传到 Whiteboard-bridge、iOS、Android、Harmony 的 mount 协议；
- 清除 `forceMaximized` 必须由明确的房间级管理 API 完成，不能由普通客户端 mount/unmount 或关闭最后一个 App 隐式清除。

### 开启配置

- 只改变当前实例的 App runtime 创建与缓存策略；
- `attributes.apps`、focus、zIndex 和关闭同步协议不改变；
- `manager.setMaximized(true)` 只由显式 `forceMaximized=true` 的可写初始化请求或房间管理 API 触发；lazy 客户端只读取策略字段；
- 其他客户端不需要新增配置；
- setup 失败不能破坏已有 shell 或房间 App 列表；
- `appsChange` 仍表示 App shell 列表变化，不表示 App runtime 已 ready；`onAppSetup` 或 `addAppAndWaitForSetup()` 才表示 setup 完成；
- Native/Bridge 不应把 `focusedChange` 直接当作 lazy runtime ready 信号；需要使用 setup 完成信号或 WindowManager 的本地 active focus 状态。

## 18. 审计问题与修复结论

| 审计项 | 设计修复 |
| --- | --- |
| R1 minimized 是共享状态 | 不再"本地清理 minimized"；允许 minimized。只有显式 `forceMaximized=true` 的可写入口负责调用 `setMaximized(true)`，lazy 客户端不自行写入。 |
| R2 退出 maximized 后出现空 shell | 由共享 `attributes.forceMaximized=true` 禁止全局窗口模式进入 normal；有效 `useBoxesStatus=true` 的客户端本地忽略，其他客户端从 API、远端 reaction、按钮、双击和删除空集合路径拦截。 |
| R3 reconnect 绕过 lazy | 增加 lazy reconnect 分支，先恢复 shell，再按优先级串行 setup。 |
| R4 没有 teardown 钩子 | 不调用最终 destroy 事件代替 teardown；保留 runtime 与 cache 记账并允许软超限，再次 focused 直接复用且不重复 setup。代价是该 runtime 只能在 App 最终 destroy 时释放，第三方 App 数量过多会增加内存压力。 |
| R5 setup 前提交 focus | focus coordinator 盘点并改道所有现有 focus/zIndex 提交点；TeleBox 本地点击同步 defer。 |
| R6 只读端无法保证最大化 | lazy 客户端只读取 `attributes.forceMaximized`；字段不存在时 warning 并降级 eager，不尝试写入。 |
| R7 mount/onCreated 时序 | 配置校验在 mount，状态归一化在 BoxManager 创建后、onCreated 之前；mount 失败恢复共享状态。 |
| R8 forceTop 模式泄漏 | `forceTop`/`forceNormal` 仅在有效 `useBoxesStatus=true` 时消费；全局窗口状态保留同步字段但不影响 Box、top 或 setup 优先级。 |
| R9 Bridge 把 appsChange 当 ready | `appsChange` 只表示 shell，Bridge/native 使用 setup 完成信号。 |
| R10 新增 App 绕过 lazy | 本地和远端新增 App 统一进入 coordinator；`addAppAndWaitForSetup()` 保留显式 ready 语义。 |
| M1 解除 minimized 绕过 coordinator | `minimized=false` 事件和 `addApp()` 的自动解除最小化都先 setup top，再提交 focus/zIndex。 |
| M2 close 目标与窗口模式不一致 | 独立窗口模式按 forceTop，其他模式按 focus/zIndex；初始化、标题栏 close 和 close 后下一 top 统一由 coordinator 选择。 |
| M3 teardown 监听器累积 | 每次 setup 建立独立 scope；teardown 必须清理复用 `context.emitter` 上的本次监听器后才能 re-setup。 |
| M4 bind/rebuild 绕过 lazy | 每次 `bindContainer()`、reconnect 和 Player seek rebuild 都幂等重放 force 状态、shell 恢复和 top setup。 |
| H2 forceMaximized 生命周期不完整 | 定义 `setForceMaximized(true/false)`、force 清除后的 lazy -> eager 行为，以及 force=true 但当前 normal 时的 warning/eager 降级。 |
| M5 force 与 lazy 自举歧义 | `forceMaximized=true` 且可写时先写字段并 setMaximized(true)，再读取字段和 boxState；仅 lazy 参数要求读取已有 force 状态。 |
| M6 eager normal API 未定义 | force=true 时 `setMaximized(false)` / `setBoxState("normal")` 统一 no-op + warning；force=false 后恢复原语义。 |
| M7 TeleBox 动态策略缺口 | WindowManager 同时通过构造参数和运行时 setter 向 TeleBox 传递 force 状态，确保按钮、双击和事件路径一致。 |
| R11 单 runtime 缓存（v1 结论过时） | 新增 `maxCachedAppsInMaximizedMode`，`runtimeCache` 改为 LRU 多缓存；默认 1 保持现状行为。 |
| R12 队列只保证创建串行，setup 并发 | 新增统一真实 setup 串行队列，任务必须 `await ensureSetup()`；eager `setTimeout` 路径纳入队列。 |
| R13 reconnect/seek `Promise.all` 并发重建 | reconnect、seek rebuild 改为串行队列 + 聚焦优先排序。 |
| R14 各 App `setup()` 提前返回、资源尾部异步 | 四个内置 App 增加 setup ready 契约（首屏资源 + 超时 + 失败路径）。 |
| R15 presentation 失焦后仍持有全量大图 | 失焦缩略图降级（第 15 节），纯 DOM 替换，禁用 scene API。 |
| R16 `AppEmitterEvent.focus` 已声明未发射 | WindowManager 补齐 per-App `focus: boolean` 发射与 `AppContext.isFocused()`，作为 App 感知 isFocused 的唯一通道。 |

## 19. 测试计划

实现前后至少覆盖以下场景：

**基础与状态机**

1. 默认配置恢复多个 App，所有 App 仍按原流程 setup，行为与时序对调用方无感知差异。
2. lazy 配置恢复多个 App，仅 maximized top App setup，其余 App 只有 shell。
3. 房间初始为 minimized，lazy mount 保留 minimized；解除 minimized 后进入 maximized 并 setup top App。
4. lazy 配置下任何入口都不能进入 normal，且 TeleBox normal/restore 按钮和双击均无效。
5. lazy + `useBoxesStatus=true` 只 warning，实际使用 `useBoxesStatus=false`。
6. 只读端或 Player 在 force 字段缺失，或 force=true 但当前 normal 时 warning 并降级 eager。
7. 可写房间入口使用 `forceMaximized=true` 同时写入房间字段并调用 `setMaximized(true)`；只读 lazy 客户端读取该字段后启用 lazy，不尝试写入。
8. 房间没有 `forceMaximized=true` 时，lazy 客户端 warning 并 eager setup；未开启 lazy 且使用全局窗口状态的客户端仍遵守已存在的 forceMaximized。
9. `manager.setMaximized(true)` 仍同步到房间，未开启 lazy 的另一客户端保持 eager setup。
10. `setForceMaximized(false)` 只清除房间策略；force 清除后 eager 客户端恢复 normal 能力，lazy 实例转为 eager 并按串行队列补齐 runtime。
11. force=true 时有效 `useBoxesStatus=false` 的客户端调用 `setMaximized(false)` / `setBoxState("normal")` 都 no-op + warning。
12. legacy 客户端写入 normal 后，支持 force 的新客户端在 normal 状态下不进入 lazy；可写管理入口重新 force 后恢复 maximized。
13. 非 lazy 的 `useBoxesStatus=true + forceMaximized=true` 只启用独立窗口状态，不写 force 字段；已有房间 force 字段也不拦截该客户端进入 normal。
14. `useBoxesStatus=false` 时，本地新增和远端恢复 App 的 `forceTop`/`forceNormal` 均不影响 Box、top 或 setup 排序；切回 true 后原有同步字段仍可生效。

**串行 setup 与缓存**

15. 初始恢复多个 App（eager）时，前一个 App 的 `app.setup()` 完成后才开始下一个；setup 开始/结束时间区间不交叉（观测点：串行队列输出的 `app setup start/done/duration` info 日志）。
16. cache=1 时与现状行为一致：新 App ready 后 teardown 旧 App。
17. cache=5 时打开 1~5 均不 teardown；打开 6 时 LRU 项 1 被淘汰，缓存变为 [2,3,4,5,6]。
18. 命中缓存的 App 切回时不重新 `setup()`，仅更新 LRU 顺序；同一 App 的并发 setup 请求复用同一 Promise。
19. 快速切换 A -> B -> C 时，过期 B setup 完成后不会重新 focus B。
20. teardown 与 setup 不并发；`tearing-down` 项不参与缓存命中。
21. reconnect 与 Player seek rebuild 不使用 `Promise.all()` 并发 setup，全部走串行队列。
22. TeleBox 用户切换触发的 setup 失败后 shell 保留、失败目标 focus 不提交、不占用缓存 slot、不触发对其他缓存项的淘汰；只在 handoff 最后的 `finally` 阶段恢复：Attribute 仍是有效 previous 时仅做本地对齐，否则排除失败目标并 focus 最高 zIndex App，全程不写 `focus: undefined`。相同失败若来自 `focusApp(appId)`、Attribute 同步、初始化、重连或内部程序化 focus，则不得 fallback。
23. `addAppAndWaitForSetup()` 对非 top App 也真正完成 setup 后再 resolve。
24. media-player 在 setup 未完成时 teardown 不产生异步 DOM 异常（取消 token 生效）。
25. 进入 minimized 串行释放全部缓存 runtime；退出 minimized 后聚焦 App 最先恢复。
26. force 清除后的补齐按聚焦优先排序；重复 `bindContainer()` 不重复 setup 或重复同步最大化状态。
27. 聚焦优先：批量 setup（初始化/reconnect/seek/补齐）中 `attributes.focus` App 的 setup 开始时间早于其余 App。
28. `maxCachedAppsInMaximizedMode` 非法值（0、负数、小数、非数字）回退 1 并 warning。

**Focus / close / 页面 / 回调语义**

29. focus A -> B 时，B setup 完成前 TeleBox 不提交 B focus，A runtime 不提前销毁（cache=1）；cache≥2 时 A 进入缓存不销毁。
30. 最大化标题栏关闭 A 后，B 就绪再 focus B。
31. 解除 minimized 时先 setup top，再提交 focus；`addApp()` 在 minimized 下也遵循该顺序。
32. 关闭最后一个 App 时，不发生意外的 false -> true 状态抖动。
33. 空 App 集合下保留现有标题栏逻辑，但 `setFullscreen(true/false)` 优先级更高。
34. `forceTop` App 仅在 `useBoxesStatus=true` 时参与 setup/focus 选择；lazy/global 模式忽略。
35. Slide、DocsViewer、Presentation setup 后恢复正确的 `fullPath` / page index。
36. `appsChange`、`onAppSetup`、`addAppAndWaitForSetup()` 的 ready 语义分别正确。
36a. 快速执行 `focusApp(C) -> focusApp(D) -> focusApp(E)` 并穿插分页命令：只有 `await focusApp(appId)` 成功提交后，后续无 appId 的 `dispatchDocsEvent` 才能操作该当前焦点；返回失败时不得继续。Bridge/Native 必须真实等待 Web Promise 并传回成功、被取代、超时和 setup 失败结果，不能用 void/fire-and-forget 冒充完成。
36b. 第三方 App 未实现 `teardown()` 时，超过 cache 配置、进入 minimized 和再次 focused 均不调用 teardown；runtimeCache 允许软超限并保留该 App 的 ready 记账，再次 focused 不重复调用 setup。缓存记账因模式切换缺失时，已 setup runtime 只重新登记、不重复 setup。
36c. Slide 已失焦冻结后进入后台，后台期间收到 `focus=true` 不立即解冻；回到前台时仅当前 focused Slide 解冻，未 focused 或 minimized Slide 保持冻结。

**presentation 失焦缩略图降级**

37. cache ≥ 2 时 presentation 失焦后背景 `<img>` src 变为 `page.thumbnail`，重新聚焦后恢复 `page.src`；全程不调用 scene API、房间 sceneState 无 diff。
38. `page.thumbnail` 缺失时失焦不改变任何 src。
39. 失焦期间远端翻页，新页背景同样被降级；重新聚焦后当前页为大图。
40. 失焦替换后立即 teardown 幂等不抛错；teardown 后过期 focus 事件被忽略。
41. cache=1 与 eager normal 模式下降级逻辑不生效，行为与现状一致。
42. 失焦后 Preload 暂停、聚焦后恢复当前页预加载。

实现说明（已实现部分）：lazy focus 等待 AppProxy 的创建窗口最多 2 秒（`ensureLazyFocus` 轮询）；超时通过 logger warn 记录并放弃本次 focus 请求。当前单元测试已锁定 setup 失败、descriptor 缺失和 setup 完成态等核心状态机行为；force 清除、zIndex pending flush、teardown 幂和监听器卫生、串行队列与缓存淘汰属于集成回归测试重点。

## 20. 实现检查清单

**配置与状态**

- [x] 在 `MountParams` 增加 `maxCachedAppsInMaximizedMode?: number`（默认 1，非法值回退 1 + warning，仅 lazy 生效）。
- [x] 在 `MountParams` 增加 `lazySetupInMaximizedMode?: boolean`（默认 `false`）与 `forceMaximized?: boolean`；后者仅可写房间入口用于写入 `attributes.forceMaximized=true` 并调用 `setMaximized(true)`。
- [x] lazy 模式仅在读取到 `attributes.forceMaximized=true` 时生效；字段缺失时 warning 并降级 eager。
- [x] `attributes.forceMaximized=true` 时，有效 `useBoxesStatus=false` 的客户端只允许 minimized/maximized；独立窗口状态客户端本地忽略。
- [x] 定义并实现 `setForceMaximized(true/false)` 的写权限、属性更新和 force 清除后的 lazy -> eager 降级。
- [x] lazy + `useBoxesStatus=true` 在 mount warning，并按 false 创建。
- [x] 窗口策略互斥：`useBoxesStatus=true` 忽略 `forceMaximized`；false 时忽略 App 的 `forceTop`/`forceNormal`，同步字段与公开类型保持兼容。
- [x] 将 lazy setup 状态与 runtime 缓存限制在当前 WindowManager 实例；仅同步房间级 `forceMaximized` 策略字段。
- [x] 在 BoxManager 创建后、onCreated 前执行最大化归一化，不自动解除 minimized。

**串行 setup 队列与缓存**

- [x] 实现 `runtimeCache`（LRU：单调访问序号 + setting-up/ready/tearing-down/pinned 状态）与 `settingUpApps` Promise 复用。
- [x] 实现统一真实 setup 串行队列（任务必须 `await ensureSetup()`），并把 7.2 节全部路径接入。
- [x] 移除 eager `setupApp()` 中 `setTimeout` 造成的 setup 并发（延迟启动保留、执行入队）。
- [x] 队列调度器支持按有效模式取任务（独立窗口：forceTop > focus > zIndex；全局/lazy：focus > zIndex），focus 变化可重排未开始任务。
- [x] reconnect / Player seek rebuild 移除 `Promise.all()`，改走串行队列。
- [x] 实现 6.4 节 LRU 淘汰时序（cache=1 保持"新 ready 后 teardown 旧"；cache≥2 溢出先淘汰后 setup）。
- [x] 进入 minimized 串行释放全部缓存 runtime；退出 minimized 聚焦优先恢复。
- [x] teardown-during-setup 竞态守卫：AppProxy setup 代次（`setupRunGeneration`），teardown/destroy 递增，进行中的 setup 完成后按中止处理（不标记 ready、不占缓存 slot）。

**shell 与 App 契约**

- [x] 保留 scene/View shell 初始化，延迟 App runtime setup。
- [x] 补齐 `AppEmitterEvent.focus: boolean` 的发射点（attributes autorun 权威来源 + box 事件 + setup 同步，经 `emitAppFocusEvent` 去重）与 `AppContext.isFocused()` getter。
- [x] app-slide：setup 返回首个 `renderEnd` ready Promise（含超时/失败路径）。
- [x] app-docs-viewer：静态等待首张可见页图片 load/decode；dynamic 等待首个 render tick（含超时）。
- [x] app-presentation：Preload 启动控制（setup 聚焦当前页）；setup 返回当前页首图 ready（5s 超时）；不重排创建顺序（见 14.3）。
- [x] app-media-player：ready callback + video.js 实例就绪；`initPlayer()` 取消 token 与 `componentWillUnmount()` 协同。
- [x] app-presentation：失焦缩略图降级（第 15 节，含 Preload 暂停/恢复、远端翻页重降级、teardown 竞态处理）。

**Focus 与 TeleBox**

- [x] 在 setup 完成后才提交 TeleBox focus。
- [ ] 盘点并改道所有现有 focus/zIndex 提交点（16.2 节清单）。
- [ ] 为最大化标题栏 close 增加延迟自动 focus 的最小 TeleBox 能力。
- [ ] 在 TeleBox UI 中禁用 normal/restore 按钮和双击恢复。
- [x] 通过 TeleBox 构造参数和运行时 setter 同步 force 状态，确保 UI 与事件拦截一致。

**跨端与回归**

- [ ] 为 reconnect 和新增 App 增加 lazy 分支（reconnect 已串行化，新增 App 的 lazy coordinator 分支待做）。
- [ ] 为 `minimized=false`、`addApp()` 自动解除最小化、Player seek rebuild 和重复 `bindContainer()` 增加 lazy coordinator 分支。
- [x] 为每次 setup 建立可清理的 setup scope，teardown 后确认 `context.emitter` 监听器无残留。
- [ ] 确定删除最后一个 App 后的无抖动最大化策略。
- [ ] 排查 Bridge/native 对 appsChange、focusedChange、onAppSetup 的 ready 假设。
- [ ] 同步 Bridge、iOS、Android、Harmony 的 `forceMaximized` / `lazySetupInMaximizedMode` / `maxCachedAppsInMaximizedMode` mount 参数透传。
- [ ] 为默认 eager 分支增加回归测试，确认除 setup 串行化外行为无变化。

## 21. 相关源码与文档

- [`WindowManager.mount()`](../../src/index.ts)
- [`AppManager` 生命周期](../../src/AppManager.ts)
- [`AppProxy` 创建与销毁](../../src/App/AppProxy.ts)
- [`AppCreateQueue`](../../src/Utils/AppCreateQueue.ts)
- [`BoxManager` 状态桥接](../../src/BoxManager.ts)
- [`TeleBoxManager` 最大化标题栏 close](../../../telebox-insider/src/TeleBoxManager/index.ts)
- [`app-slide` runtime 与 freezer](../../../slide-app/packages/app-slide)（`src/utils/freezer.ts`、`src/SlideController/index.ts`）
- [`app-docs-viewer` runtime](../../../slide-app/packages/app-docs-viewer)
- [`app-presentation` runtime](../../../netless-app-presentation)（`src/preload.ts`、`src/presentation.ts`）
- [`app-media-player` runtime](../../../app-media-player/packages/app-media-player)
- [white-sdk 背景渲染](../../../white-sdk)（`render/src/views/others/BackgroundImage.tsx`、`model/src/scene/SceneNode.ts`、`web-sdk/src/displayer/RoomImplement.ts`）
- [WindowManager API](../api.md)
- [WindowManager 概念](../concept.md)
