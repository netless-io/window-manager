# 最大化模式下的本地 Lazy Setup 设计

> 状态：设计中，尚未实现
>
> 目标版本：待确定

## 1. 背景

`WindowManager` 在恢复房间时，会为 `attributes.apps` 中的每个 App 创建窗口，并立即调用 App 的 `setup()`。
`app-slide`、`app-docs-viewer` 和 `app-presentation` 的 `setup()` 会创建页面渲染器、控制器、监听器和 DOM。
当一个房间同时打开多个课件时，低端设备会在初始化阶段同时承担多个课件 runtime 的内存和渲染开销，可能影响首屏、交互响应和后续切换。

本设计增加一个 `WindowManager.mount()` 本地配置：

```ts
lazySetupInMaximizedMode?: boolean;
forceMaximized?: boolean;
```

`lazySetupInMaximizedMode` 只改变当前 `WindowManager` 实例如何初始化 App runtime，不写入房间 attributes，也不要求房间中的其他客户端启用同一配置；`forceMaximized` 是独立的房间级策略请求。

`manager.setMaximized(true)` 仍然使用现有 WindowManager/TeleBox 同步逻辑，因此它会继续影响房间中的其他客户端。这个共享状态变化是显式的产品行为，与本地 lazy setup 策略分开处理。

`forceMaximized` 是有写权限的房间入口用于声明房间级策略的 mount 请求；当它为 `true` 且当前实例可写时，WindowManager 在初始化阶段同时把房间级 `attributes.forceMaximized` 设置为 `true`，并调用现有 `setMaximized(true)` 把最大化状态同步到 `attributes`。该字段是共享策略，不是当前实例的本地配置：所有支持该字段的 WindowManager/TeleBox 客户端都必须禁止进入 normal，直到房间级策略被显式解除。开启 lazy 的客户端不要求也不依赖该参数写入字段，只读取房间已有值，也不能因为 lazy 配置自行调用 `setMaximized(true)`。

## 2. 目标与非目标

### 2.1 目标

- 在配置开启时，恢复全部 App 的 shell 和 Box，但只初始化最大化模式下当前最顶层 App 的 runtime。
- lazy 模式允许全局状态为 `minimized` 或 `maximized`，不允许进入 `normal`。
- 当前顶层 App 切换时，先完成新 App 的 `setup()`，再把 focus 提交给 TeleBox。
- 新 App ready 后，再释放旧 focused App 的 Slide/DocsViewer/Presentation runtime 和 DOM。
- 最大化标题栏关闭当前 App 后，先准备下一个 top App，再执行 focus。
- 配置关闭时，保留现有 AppManager、AppProxy、TeleBox 和同步行为。
- scene、View、attributes、Box 等轻量 shell 可以提前创建，不把 scene 初始化与 App runtime setup 混为一谈。

### 2.2 非目标

- 不改变房间中 `attributes.apps`、`focus`、`zIndex`、`boxStatus` 的数据结构；新增的 `attributes.forceMaximized` 是本设计明确要求的共享策略字段。
- 不把 `lazySetupInMaximizedMode` 这个本地 setup 配置同步给其他客户端，但会同步 `forceMaximized` 房间策略。
- 不改变默认 `AppProxy.destroy()` 的“彻底关闭 App”语义。
- 不在本次设计中重新设计普通窗口、最小化窗口或内容区域 close 按钮的交互。
- 不要求其他客户端也延迟 `setup()`。其他客户端根据自己的 mount 参数独立决定 eager 或 lazy。
- 不在 lazy 模式下支持 `useBoxesStatus=true`；该组合配置会告警并按 `useBoxesStatus=false` 运行。

## 3. 配置语义

### 3.1 配置关闭

```ts
WindowManager.mount({
    // 默认 false
    lazySetupInMaximizedMode: false,
    // 仅在需要把房间锁定为 maximized 时显式传 true
    forceMaximized: false,
});
```

保持当前流程：

```text
attributes.apps
    -> 创建 AppProxy
    -> 创建 Box
    -> app.setup()
    -> setup 完成后继续现有 focus / zIndex / 事件流程
```

实现时必须让这个分支尽可能不经过新的 lazy 状态机。现有 `AppManager._attributesUpdateCallback()`、`AppProxy.baseInsertApp()` 和 `AppProxy.destroy()` 的默认行为不得因为新增配置而改变。

### 3.2 配置开启

```ts
WindowManager.mount({
    lazySetupInMaximizedMode: true,
    forceMaximized: true,
});
```

初始化时执行以下步骤：

```text
读取现有房间状态
    -> 若 mount params.forceMaximized=true 且当前实例可写：写入 attributes.forceMaximized=true，并调用 manager.setMaximized(true)
    -> 读取 attributes.forceMaximized 和当前 boxState
    -> lazy=true 仅在 forceMaximized=true 且 boxState 为 minimized/maximized 时生效，否则 warning 并降级 eager
    -> 如果当前状态为 minimized，保留 minimized
    -> 创建所有 App shell / View / Box
    -> 选择最大化模式下的 top App
    -> 只 setup top App
```

`manager.boxState` 是只读 getter，不能直接赋值。由于 `minimized` 在状态组合中优先于 `maximized`，当房间恢复出的状态是 `minimized=true` 时，调用 `setMaximized(true)` 后当前状态仍然是 minimized；之后调用 `setMinimized(false)` 才会进入 maximized。这是允许的状态，而不是初始化错误。

`setMaximized(true)` 仍然是原有的共享操作，会同步房间状态，但只有 `forceMaximized: true` 的可写初始化请求可以在本流程中触发它。`lazySetupInMaximizedMode` 本身不进入 attributes，也不会调用 `setMaximized(true)`；`forceMaximized` mount 参数只由可写房间入口用于建立共享的 `attributes.forceMaximized` 和最大化状态，不会同步当前实例是否 lazy setup。

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

当共享 `attributes.forceMaximized === true` 时，上述 normal 拦截对所有支持该字段的客户端生效，不区分客户端是否开启 lazy。任何客户端调用 `setMaximized(false)` 或 `setBoxState("normal")` 都必须 no-op 并 warning；清除该字段必须通过明确的房间级管理操作，不能由删除最后一个 App、普通状态操作或 mount 卸载隐式清除。

`manager.setMinimized(true/false)` 保持可用。进入 minimized 时可以释放当前 App runtime；退出 minimized 时再按 top App 规则 setup。

如果 lazy 客户端重新把共享状态写回 `maximized=true`，这代表该配置会影响房间中其他用户。使用方必须明确接受该房间级副作用。

lazy 配置要求：完成可写 `forceMaximized=true` 初始化请求后，或房间原本已有该字段时，必须再次读取 `attributes.forceMaximized` 和当前 `boxState`；只有字段为 true 且状态为 minimized/maximized 才启用 lazy。仅带 lazy 参数的客户端不能代写字段；字段缺失、为 false 或当前为 normal 时必须 warning 并降级 eager。`forceMaximized: false` 不得清除房间已有的 true。

### 3.3 错误配置和降级

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

警告应使用 WindowManager 已有的 logger 入口，例如 `manager.Logger?.warn(...)`，不能因为配置错误直接抛错或阻止挂载。

如果当前实例不能写房间状态（只读端、Player、回放或未连接状态），且房间没有 `attributes.forceMaximized=true`，或当前房间状态为 normal，则无法保证 lazy 模式的“不允许 normal”约束。此时 `mount()` 应 warning，并将当前实例降级为默认 eager setup；它不得尝试写入 forceMaximized 或自行调用 `setMaximized(true)`。降级原因也必须进入 logger，便于定位低端设备为何没有启用 lazy。

### 3.4 forceMaximized 生命周期

房间级管理 API 定义为：

```ts
manager.setForceMaximized(force: boolean): void;
```

- `setForceMaximized(true)` 仅允许可写房间入口调用（SDK 只校验 `canOperate`，角色/“房间入口”约束由业务层保证）；它写入 `attributes.forceMaximized=true`，并调用 `setMaximized(true)`；
- `setForceMaximized(false)` 仅允许可写房间入口调用；它只清除 `attributes.forceMaximized`，不隐式调用 `setMaximized(false)`。调用方必须先清 force，再显式恢复 normal；反过来调用会被 force 期间的 no-op 拦截且不会自动重试；
- `setMaximized(false)` 在 `attributes.forceMaximized=true` 时始终 no-op + warning，即使调用者没有开启 lazy；
- force 字段从 true 变为 false 后，lazy 实例必须退出 lazy 优化并降级为 eager，补齐尚未 setup 的 runtime；此过程不自动改变房间的 maximized/minimized 状态；
- force 字段为 true 但房间状态已是 normal 时，lazy 实例不得只 setup top App，应 warning 并降级 eager；可写管理入口再次显式调用 `setForceMaximized(true)` 时才负责重新 `setMaximized(true)`。降级补齐 runtime 必须复用 `AppCreateQueue` 串行执行。

## 4. 共享状态与本地状态边界

```text
房间共享状态                         当前 WindowManager 实例状态
------------------                  ------------------------------
attributes.apps                      shell / runtime maps
attributes.focus                    settingUpApps
attributes.apps[id].state.zIndex   activeAppId
attributes.maximized               pendingFocusAppId
attributes.minimized                lazySetupInMaximizedMode
attributes.forceMaximized            effective lazy mode / force request
attributes.boxStatus
```

### 4.1 必须同步的行为

`manager.setMaximized(true)` 保持现有调用路径和同步语义，因为产品要求进入该模式时房间中的其他客户端也最大化。

### 4.2 不得同步的行为

以下内容只能是当前实例的本地状态：

- 是否延迟 App `setup()`；
- 哪些 runtime 已 setup；
- 哪些 runtime 已 suspend/teardown；
- `settingUpApps` 中的 Promise；
- 当前实例的 setup generation/token。

`attributes.forceMaximized` 是本设计唯一新增的房间级策略字段；它只约束 maximized/normal 状态，不要求未开启 lazy 的客户端延迟 App setup。未开启 lazy 的客户端仍然 eager setup，但必须遵守 `forceMaximized=true` 的 normal 禁止规则。

force 字段的设置/清除必须经过 `setForceMaximized()` 的权限校验；普通 eager 客户端不能通过 `setMaximized(false)` 绕过房间约束。

## 5. App 生命周期模型

### 5.1 三个 Map

lazy 分支建议维护以下集合：

```ts
unsetupApps: Map<string, AppShell>;
setupApps: Map<string, AppRuntime>;
settingUpApps: Map<string, Promise<AppRuntime>>;
```

`AppShell` 至少包含：

- AppProxy 和 App id；
- scene、View、attributes；
- Box 和窗口几何信息；
- setup 所需的 App kind/options。

`AppRuntime` 表示 `app.setup()` 成功后产生的 Slide、DocsViewer、Presentation 或其他 App runtime。

`setupApps` 保持 Map 而不是单一变量，为后续“最大化模式下多个没有被遮挡的 App 可以同时 setup”等策略留出扩展空间。本次默认策略仍然只允许一个最大化 top App 进入 runtime。

### 5.2 setup 与 teardown

AppProxy 构造阶段允许提前完成：

- scene 初始化；
- 根据 `scenePath` 创建 View；
- `AppPageStateImpl` 创建；
- scene callback 和 attributes 绑定。

这些步骤不等于 App runtime setup。

lazy 分支需要将 runtime 释放与最终销毁区分开：

```text
teardownSetup()/disposeRuntime()
    只释放 Slide / DocsViewer / Presentation runtime、监听器和 DOM

destroy()
    保持现有最终销毁语义：释放 AppProxy、分页状态、View、Box 等全部资源
```

blur 或失去 top focus 时调用 runtime teardown，不调用当前完整的 `destroy()`，否则会把仍需保留的 scene、View 和 shell 一起销毁。

### 5.3 setup 失败

- setup Promise 失败时，从 `settingUpApps` 移除任务；
- 保留 shell，避免 attributes.apps 与本地 Box 集合不一致；
- 不提交该 App 的 focus；
- 根据现有错误事件和日志约定上报原始错误；
- 如果仍有旧 active App，旧 App 保持 active，直到新 App 成功；
- 如果没有 active App，TeleBox 不应 focus 一个尚未 setup 的 Box。

## 6. top App 选择规则

### 6.1 全局窗口状态模式

当 `useBoxesStatus === false` 时，top App 使用以下优先级：

1. `maxForceTopBox` 对应的 App；
2. `attributes.focus` 指向且存在的 App；
3. 最大化窗口中 `zIndex` 最大的 App；
4. 按现有恢复顺序选择可用 App。

该顺序必须与 TeleBox 的 `maxForceTopBox || topBox` 语义一致，不能只按 attributes.focus 或 zIndex 选择一个 TeleBox 实际不会显示在最上层的 App。

### 6.2 `useBoxesStatus` 的限制

lazy 模式下 `useBoxesStatus` 无效，始终使用全局窗口状态。传入 `useBoxesStatus=true` 时，初始化 warning 后强制按 `false` 创建 BoxManager、AppManager 和 TeleBoxManager。

这样可以避免同一实例同时维护全局 `maximized/minimized` 与每个 Box 的 `boxStatus`，也避免 top App 选择规则与 MaxTitleBar 的独立状态发生冲突。

## 7. 初始化时序

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
    |       -> 进入现有 eager setup 流程
    |
    +-- lazySetupInMaximizedMode = true
            -> 校验 lazy 配置和可写能力
            -> 仅 forceMaximized=true 的可写初始化请求调用 manager.setMaximized(true)
            -> 读取 attributes.forceMaximized 和当前 boxState；字段缺失/为 false 或状态为 normal 时 warning 并降级 eager
            -> 保留 minimized 状态，不强制解除最小化
            -> 创建所有 App shell / View / Box
            -> setup 当前可见 top App；minimized 时不 setup
            -> setup 成功后提交 focus
```

lazy 配置校验应在 `mount()` 初始化阶段完成；状态归一化应放在 BoxManager 创建后、`internalEmitter.emit("onCreated")` 之前，使 `onCreated()` 注册的 autorun 看到一致的最大化状态。不要清理 minimized。归一化必须幂等，重复执行不能反复向房间写入相同状态。

如果 mount 事务在共享 `maximized=true` 写入后失败，应使用 mount 前保存的状态尝试恢复原值，避免留下半初始化的房间状态。App setup 失败属于单 App 错误，不应回滚整个房间的最大化状态。

## 8. Focus 切换时序

lazy 分支中，`attributes.focus` 可以先发生变化，但它不能立即被当作“runtime 已可操作”的证明。

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
setup 目标 App（复用 settingUpApps Promise）
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
teardown 原 active App runtime
    |
    v
更新 activeAppId
```

提交 focus 前，操作路由仍应使用 `activeAppId`，不能因为 `attributes.focus` 已变化就提前把分页、事件或 unified page control 路由到尚未 setup 的 App。

setup 任务需要 generation/token，防止快速连续切换 A -> B -> C 时，B 的过期 Promise 在 C 之后完成并错误地重新激活 B。

## 9. 最大化标题栏 close

本次 lazy 场景重点是最大化标题栏的 close，不优先改造 Box 内容区域中的 close。

lazy 模式下 TeleBox UI 不允许用户进入 normal：

- 最大化状态下隐藏或 disabled Maximize/Restore 按钮；
- 标题栏双击也不能触发 maximized 到 normal；
- Minimize 按钮继续保留，允许进入 minimized；
- Close 按钮继续保留。

现有 `forceNormal` 语义是“只保留 close 按钮”，不能直接复用来表达这个需求。TeleBox 应增加明确的 `disableNormalTransition` 或等价内部配置，并同时拦截按钮事件和双击事件。

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
    -> WindowManager setup 下一个 App
    -> setup 成功
    -> TeleBox commitFocus(nextBox)
```

建议为 TeleBox 增加窄范围的延迟能力，例如标题栏 close 使用 `deferFocus`，或者提供一个由 WindowManager 明确调用的 `commitFocus`。异步 Promise 不应直接塞进 TeleBox 的同步事件处理函数。

配置关闭时，仍执行原有的 `remove -> focusTopBox()`，不能让 TeleBox 的默认行为变成异步。

如果删除最后一个 Box，TeleBox 当前实现可能自动执行 `setMaximized(false)`。lazy 模式不允许该自动转换直接生效：WindowManager/TeleBox 应在删除路径中识别 lazy 状态，保留共享 maximized 标志，或者只在房间没有任何 App 且产品明确允许空窗口时执行一次受控清理。不能出现 false -> true 的反复共享写入。

空 App 集合的内部清理仍遵循现有的 App 数量相关标题栏逻辑，但不能覆盖显式的全屏控制。`fullscreen` 状态和 `setFullscreen()` 的优先级高于 App 数量推导：当调用方显式设置全屏状态时，标题栏必须按该状态显示或隐藏；后续 Box 增删只允许更新非全屏场景下的默认可见性。这样既保持当前逻辑，也保证即使没有 App，`setFullscreen(true/false)` 仍能按原语义控制最大化标题栏。

## 10. 页面恢复

lazy setup 不能丢失 App 原本的页面位置。

- `fullPath` 是恢复指定 scene/page 的首选权威值；
- App View 在 setup 前可以先设置 `focusScenePath`；
- AppProxy 必须在创建 `AppPageStateImpl` 前同步创建 View，避免分页状态持有未定义的 View；
- runtime teardown 后再次 setup 前，必须重新挂载 `fullPath`/scenePath 属性监听，并立即按当前 `fullPath` 恢复 View；
- Presentation 已经可以从 View path 解析页面；
- Dynamic DocsViewer 应优先使用 App View 的 path，而不是只读取全局 `displayer.state.sceneState.index`；
- Slide 需要协调 `fullPath` 与 storage 中的 `state.currentSlideIndex`，避免 setup 后先跳到目标页又被旧 storage state 改回去。

页面恢复应在目标 App 的 setup 流程内完成，不能在 focus 提交之后再异步修正页面，否则用户会先看到错误页面。

## 11. TeleBox 与 WindowManager 的职责

### WindowManager

- 判断当前实例是否启用 lazy setup；
- 创建和维护 shell/runtime Map；
- 根据 focus 和 zIndex 选择 top App；lazy 模式下不读取 `boxStatus`；
- 串行化 setup、generation 校验和 runtime teardown；
- 在 setup ready 后提交 focus；
- 拦截所有现有 focus/zIndex 提交点，避免 shell 创建完成就提前显示或 focus 未 setup App；
- 维持默认 eager 分支不变。

### TeleBox

- 继续管理 Box 的几何、zIndex、标题栏和同步事件；
- 默认情况下保持同步 focus 行为；
- 仅在 WindowManager 请求时延迟最大化标题栏 close 后的自动 focus；
- 接收 WindowManager 的 `forceMaximized` 构造参数和运行时 setter；为 true 时屏蔽 normal/restore UI、双击和对应的同步事件，为 false 时恢复原有 UI；
- 不负责调用 App 的 `setup()`，也不持有 WindowManager 的 runtime Map。

## 12. App runtime teardown 契约

当前 `NetlessApp` 接口只有 `setup()`，现有 `destroy` 事件表示 AppProxy 的最终销毁。不能在每次失焦时复用最终 `destroy` 事件，否则会污染注册 hook、重复挂载监听器，并让同一个 AppContext 进入不可恢复状态。

实现 lazy runtime 释放前，需要增加一个可选的 App 侧 teardown 契约，例如：

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

- `teardown()` 只释放 Slide/DocsViewer/Presentation runtime、DOM、监听器和资源；
- `destroy` 事件仍只用于 AppProxy 最终销毁；
- teardown 后允许重新创建新的 AppContext 并再次执行 `setup()`；
- 每次 `setup()` 必须拥有独立的 setup scope；teardown 必须清理本次 setup 在 `context.emitter`（该 emitter 由 AppProxy 复用）上注册的全部监听器和订阅，不能依赖创建新的 AppContext 自动获得新的事件总线；
- WindowManager 在允许 re-setup 前应确认旧 setup scope 已释放，避免同一 App 多次切换后 destroy/事件监听器线性累积；
- `teardown()` 必须幂等，重复调用不能抛错；
- 没有实现 teardown 的第三方 App 不能被静默地当作可安全 suspend 的 App。

对未实现 teardown 的 App，建议首期采用以下策略之一并明确记录：

1. 该 App 保留 runtime，不获得完整的内存收益；或
2. 当前实例对该 App 永久保留 runtime 并 warning；首期不做“对房间降级 eager”的模糊处理，避免把 per-App 保留 runtime 与 per-instance 降级混为一谈。

`app-slide`、`app-docs-viewer`、`app-presentation` 都需要逐一实现并验证该契约。不能仅在 WindowManager 内部调用现有 `destroy` 事件代替。

## 13. 兼容性要求

### 未开启配置

- `AppManager._attributesUpdateCallback()` 的创建顺序和 setup 行为不变；
- `manager.focusApp()`、TeleBox 本地点击、远端 zIndex/focus 更新保持现有语义；
- `destroy()` 继续执行完整 App 销毁；
- 不引入新的异步 focus 等待。
- 当 `attributes.forceMaximized=true` 时，`setMaximized(false)` / `setBoxState("normal")` 对所有客户端均为 no-op + warning；force=false 后才恢复原有 normal 转换语义。

### `forceMaximized` 协议兼容

- `attributes.forceMaximized` 是房间级协议字段，不是仅供 lazy 客户端读取的本地标记；
- 支持该字段的 WindowManager/TeleBox 版本必须在 API、远端 reaction、标题栏按钮、双击和删除空集合路径统一禁止 normal；
- 未升级的旧客户端无法被该字段自动约束，接入方必须保证房间内使用兼容版本，或明确接受旧客户端仍可能写入 normal；
- `MountParams.forceMaximized` 与 `lazySetupInMaximizedMode` 必须同步透传到 Whiteboard-bridge、iOS、Android、Harmony 的 mount 协议；
- 清除 `forceMaximized` 必须由明确的房间级管理 API 完成，不能由普通客户端 mount/unmount 或关闭最后一个 App 隐式清除。

### 开启配置

- 只改变当前实例的 App runtime 创建时机；
- `attributes.apps`、focus、zIndex 和关闭同步协议不改变；
- `manager.setMaximized(true)` 只由显式 `forceMaximized=true` 的可写初始化请求或房间管理 API 触发；lazy 客户端只读取策略字段；
- 其他客户端不需要新增配置；
- setup 失败不能破坏已有 shell 或房间 App 列表。
- `appsChange` 仍表示 App shell 列表变化，不表示 App runtime 已 ready；`onAppSetup` 或 `addAppAndWaitForSetup()` 才表示 setup 完成。
- Native/Bridge 不应把 `focusedChange` 直接当作 lazy runtime ready 信号；需要使用 setup 完成信号或 WindowManager 的本地 active focus 状态。

## 14. 重连、Focus 和新增 App 的补充设计

### 14.1 重连

当前 `AppProxy.onReconnected()` 会销毁后通过 `baseInsertApp()` 重建，默认会让每个 App 重新 eager setup。lazy 模式必须分流：

```text
重连
    -> 恢复所有 App shell / View / Box
    -> minimized：不 setup runtime
    -> maximized：只 setup 当前 top App
    -> setup ready 后再提交 focus
```

重连路径必须复用同一个 `settingUpApps` 和 focus generation，不能通过旧的 eager `baseInsertApp()` 绕过 lazy 状态机。

Player 的 `onPlayerSeekDone()` 触发全量 attributes 重建，必须按同一 lazy reconnect 流程处理：先恢复 shell，再按当前 minimized/maximized 状态只 setup 允许的 App，不能让全量 `_attributesUpdateCallback()` 把所有 App 重新 eager setup。

### 14.2 Focus 拦截清单

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

### 14.3 新增 App

- 远端新增 App：先创建 shell，只有它成为当前 top App 时才 setup；
- 当前客户端 `addApp()`：沿用现有 focus 语义，若新 App 成为 top，则由 lazy coordinator setup 后提交 focus；
- `addAppAndWaitForSetup()`：这是显式的 ready API，即使目标 App 不是当前 top，也必须 setup 完成后再 resolve；
- `forceTop` App 的选择必须与 TeleBox 一致，初始化 top 使用 `maxForceTopBox`/`topBox`；标题栏 close 与 close 后的下一 top 必须复用同一个 focus coordinator 选择结果，不能一个按 forceTop、另一个按 focused/topBox；
- 新增 App 不能直接调用旧 eager `baseInsertApp()` 绕过 Map 和 coordinator。

lazy 实例处于 `minimized` 时，当前客户端新增 App 不会自动解除最小化；新 App 只创建 shell，直到调用方显式解除最小化，才按 top App coordinator setup。这样可以保持“最小化期间不创建重 runtime”的性能约束。

本地点击未 setup App 时，WindowManager 会先暂时撤销 TeleBox 的本地视觉 focus，但不会把仍然有效的房间级 `attributes.focus` 写成 `undefined`；旧 focused App 会保持为共享 active，直到新 App setup 成功后再提交新的 focus。

## 15. 审计问题与修复结论

| 审计项 | 设计修复 |
| --- | --- |
| R1 minimized 是共享状态 | 不再“本地清理 minimized”；允许 minimized。只有显式 `forceMaximized=true` 的可写入口负责调用 `setMaximized(true)`，lazy 客户端不自行写入。 |
| R2 退出 maximized 后出现空 shell | 由共享 `attributes.forceMaximized=true` 统一禁止 normal；所有支持该字段的客户端从 API、远端 reaction、按钮、双击和删除空集合路径拦截。 |
| R3 reconnect 绕过 lazy | 增加 lazy reconnect 分支，只恢复 shell，按 minimized/maximized 选择 setup 数量。 |
| R4 没有 teardown 钩子 | 增加 App 侧可选 teardown 契约，禁止复用最终 destroy 事件；三个内置 App 需要同步改造。 |
| R5 setup 前提交 focus | 增加 focus coordinator，盘点并改道所有现有 focus/zIndex 提交点；TeleBox 本地点击也需要同步 defer hook。 |
| R6 只读端无法保证最大化 | lazy 客户端只读取 `attributes.forceMaximized`；字段不存在时 warning 并降级 eager，不尝试写入。由可写房间入口负责首次设置该字段。 |
| R7 mount/onCreated 时序 | 配置校验在 mount，状态归一化在 BoxManager 创建后、onCreated 之前；mount 失败恢复共享状态。 |
| R8 forceTop 选择不一致 | 初始化 top 选择遵循 `maxForceTopBox`/`topBox`；标题栏 close 与下一 top 使用同一个 focus coordinator 选择结果。 |
| R9 Bridge 把 appsChange 当 ready | 明确 `appsChange` 只表示 shell，Bridge/native 使用 setup 完成信号。 |
| R10 新增 App 绕过 lazy | 本地和远端新增 App 统一进入 lazy coordinator；`addAppAndWaitForSetup()` 保留显式 ready 语义。 |
| M1 解除 minimized 绕过 coordinator | `minimized=false` 事件和 `addApp()` 的自动解除最小化都先 setup top，再提交 focus/zIndex。 |
| M2 close 目标与 forceTop 不一致 | 初始化 top、标题栏 close 目标和 close 后下一 top 统一由 coordinator 选择，避免删除未 setup 的错误 Box。 |
| M3 teardown 监听器累积 | 每次 setup 建立独立 scope；teardown 必须清理复用 `context.emitter` 上的本次监听器后才能 re-setup。 |
| M4 bind/rebuild 绕过 lazy | 每次 `bindContainer()`、reconnect 和 Player seek rebuild 都幂等重放 force 状态、shell 恢复和 top setup。 |
| H2 forceMaximized 生命周期不完整 | 定义 `setForceMaximized(true/false)`、force 清除后的 lazy -> eager 行为，以及 force=true 但当前 normal 时的 warning/eager 降级。 |
| M5 force 与 lazy 自举歧义 | `forceMaximized=true` 且可写时先写字段并 setMaximized(true)，再读取字段和 boxState；仅 lazy 参数要求读取已有 force 状态。 |
| M6 eager normal API 未定义 | force=true 时 `setMaximized(false)` / `setBoxState("normal")` 统一 no-op + warning；force=false 后恢复原语义。 |
| M7 TeleBox 动态策略缺口 | WindowManager 同时通过构造参数和运行时 setter向 TeleBox 传递 force 状态，确保按钮、双击和事件路径一致。 |

## 16. 测试计划

实现前后至少覆盖以下场景：

1. 默认配置恢复多个 App，所有 App 仍按原流程 setup。
2. lazy 配置恢复多个 App，仅 maximized top App setup，其余 App 只有 shell。
3. 房间初始为 minimized，lazy mount 保留 minimized；解除 minimized 后进入 maximized 并 setup top App。
4. lazy 配置下任何入口都不能进入 normal，且 TeleBox normal/restore 按钮和双击均无效。
5. lazy + `useBoxesStatus=true` 只 warning，实际使用 `useBoxesStatus=false`。
6. 只读端或 Player 在 force 字段缺失，或 force=true 但当前 normal 时 warning 并降级 eager。
7. 可写房间入口使用 `forceMaximized=true` 同时写入房间字段并调用 `setMaximized(true)`；只读 lazy 客户端读取该字段后启用 lazy，不尝试写入或调用 `setMaximized(true)`。
8. 房间没有 `forceMaximized=true` 时，lazy 客户端 warning 并 eager setup；未开启 lazy 的客户端仍遵守已存在的 forceMaximized。
9. `manager.setMaximized(true)` 仍同步到房间，未开启 lazy 的另一客户端保持 eager setup。
10. `setForceMaximized(false)` 只清除房间策略；force 清除后 eager 客户端恢复 normal 能力，lazy 实例转为 eager 并补齐 runtime。
11. force=true 时任何客户端调用 `setMaximized(false)` / `setBoxState("normal")` 都 no-op + warning。
12. legacy 客户端写入 normal 后，支持 force 的新客户端在 normal 状态下不进入 lazy；可写管理入口重新 force 后恢复 maximized。
13. focus A -> B 时，B setup 完成前 TeleBox 不提交 B focus，A runtime 不提前销毁。
14. 快速 A -> B -> C 切换时，过期 B setup 完成后不会重新 focus B。
15. 最大化标题栏关闭 A 后，B setup 完成再 focus B。
16. 解除 minimized 时先 setup top，再提交 focus；`addApp()` 在 minimized 下也遵循该顺序。
17. `addAppAndWaitForSetup()` 对非 top App 也真正完成 setup 后再 resolve。
18. 关闭最后一个 App 时，不发生意外的 false -> true 状态抖动。
19. 空 App 集合下保留现有 App 数量相关标题栏逻辑，但 `setFullscreen(true/false)` 优先级更高并能覆盖该默认推导。
20. `forceTop` App 的 setup/focus 选择与 TeleBox top 语义一致。
21. Slide、DocsViewer、Presentation setup 后恢复正确的 `fullPath` / page index。
22. setup/teardown 失败时 shell 保留、focus 不提交、错误可观测。
23. reconnect、Player seek rebuild、重复 `bindContainer()` 后不会重复 setup 或重复同步最大化状态。
24. `appsChange`、`onAppSetup`、`addAppAndWaitForSetup()` 的 ready 语义分别正确。

实现说明：lazy focus 等待 AppProxy 的创建窗口最多 2 秒；超时会通过 `room.logger.warn` 记录并放弃本次 focus 请求，后续 focus 请求仍可继续执行。force 清除、zIndex pending flush、teardown 幂等和监听器卫生属于集成回归测试重点，当前单元测试只锁定 setup 失败、descriptor 缺失和 setup 完成态等核心状态机行为。

## 17. 实现检查清单

- [ ] 在 `MountParams` 增加 `lazySetupInMaximizedMode?: boolean`，默认行为为 `false`。
- [ ] 在 `MountParams` 增加 `forceMaximized?: boolean`；仅可写房间入口用它同时写入 `attributes.forceMaximized=true` 并调用 `setMaximized(true)`。
- [ ] lazy 模式仅在读取到 `attributes.forceMaximized=true` 时生效；字段缺失时 warning 并降级 eager。
- [ ] `attributes.forceMaximized=true` 时所有支持该字段的客户端只允许 minimized/maximized，统一拦截 normal。
- [ ] 定义并实现 `setForceMaximized(true/false)` 的写权限、属性更新和 force 清除后的 lazy -> eager 降级。
- [ ] force=true 时 eager/lazy 客户端的 normal API 统一 no-op + warning；force=false 后恢复原有行为。
- [ ] lazy + `useBoxesStatus=true` 在 mount warning，并按 false 创建。
- [ ] lazy 客户端读取不到 `attributes.forceMaximized=true` 时 warning 并降级 eager，不尝试写入 forceMaximized。
- [ ] 将 lazy setup 状态限制在当前 WindowManager 实例；仅同步房间级 `forceMaximized` 策略字段。
- [ ] 在 BoxManager 创建后、onCreated 前执行最大化归一化，不自动解除 minimized。
- [ ] 保留 scene/View shell 初始化，延迟 App runtime setup。
- [ ] 增加 `unsetupApps`、`setupApps`、`settingUpApps` 和 active/pending focus 状态。
- [ ] 增加明确的 App runtime teardown 契约，并同步改造三个内置 App。
- [ ] 在 setup 完成后才提交 TeleBox focus。
- [ ] 盘点并改道所有现有 focus/zIndex 提交点。
- [ ] 为最大化标题栏 close 增加延迟自动 focus 的最小 TeleBox 能力。
- [ ] 在 TeleBox UI 中禁用 normal/restore 按钮和双击恢复。
- [ ] 通过 TeleBox 构造参数和运行时 setter 同步 force 状态，确保 UI 与事件拦截一致。
- [ ] 为 reconnect 和新增 App 增加 lazy 分支。
- [ ] 为 `minimized=false`、`addApp()` 自动解除最小化、Player seek rebuild 和重复 `bindContainer()` 增加 lazy coordinator 分支。
- [ ] 为每次 setup 建立可清理的 setup scope，teardown 后确认 `context.emitter` 监听器无残留。
- [ ] 确定删除最后一个 App 后的无抖动最大化策略。
- [ ] 排查 Bridge/native 对 appsChange、focusedChange、onAppSetup 的 ready 假设。
- [ ] 同步 Bridge、iOS、Android、Harmony 的 `forceMaximized` / `lazySetupInMaximizedMode` mount 参数透传。
- [ ] 为默认 eager 分支增加回归测试，确认行为无变化。

## 18. 相关源码与文档

- [`WindowManager.mount()`](../../src/index.ts)
- [`AppManager` 生命周期](../../src/AppManager.ts)
- [`AppProxy` 创建与销毁](../../src/App/AppProxy.ts)
- [`BoxManager` 状态桥接](../../src/BoxManager.ts)
- [`TeleBoxManager` 最大化标题栏 close](../../../telebox-insider/src/TeleBoxManager/index.ts)
- [`app-slide` runtime](../../../slide-app/packages/app-slide)
- [`app-docs-viewer` runtime](../../../slide-app/packages/app-docs-viewer)
- [`app-presentation` runtime](../../../netless-app-presentation)
- [WindowManager API](../api.md)
- [WindowManager 概念](../concept.md)
