# WindowManager forceMaximized + lazy/cache 与 eager fallback 测试用例

## 执行约定

### example 配置参数

- `?force=0|1` 控制 `forceMaximized`，`?lazy=0|1` 控制 `lazySetupInMaximizedMode`，`?cache=1|3|5` 控制 `maxCachedAppsInMaximizedMode`。
- 不传参数时保持默认 `force=1`、`lazy=1`、`cache=3`；非法参数回退到上述 example 默认值并输出 warning。
- 每个 run 必须记录 URL、`window.windowManagerTestConfig` 和实际 WindowManager getter。URL 层回退值与直接传入 WindowManager 的非法 cache 归一化不是同一层契约：后者仍按 API 设计默认值 1 验证。

### 固定环境

- 使用同一台执行机、同一 Chromium 版本、同一 WindowManager/App 构建产物、同一房间资源和 token；lazy/eager 必须分开清房后执行。
- 测试房间启用可写管理端；每个 App 的 `scenePath` 使用唯一后缀，避免历史房间残留和 scene path singleton 冲突。
- App 组合至少包含 Presentation、Slide、MediaPlayer、DocsViewer；Presentation 使用有 thumbnail 和无 thumbnail 两类资源。
- harness 提供 `dumpState()`，至少返回 `attributes.forceMaximized/maximized/minimized/focus`、`runtimeCache(id/state/lastUsed)`、`activeLazyAppId`、`settingUpApps`、`queueSize`、`appProxies(isSetup/isDestroyed)`。
- 全量捕获 console：`app setup start/done`、`teardown`、`focus`、`blur freeze`、`timeout`、warning/error、pageerror、unhandledrejection；所有事件带单调时间戳。
- 每次 case 结束清理全部 App，并断言 `attributes.apps`、`appProxies`、`runtimeCache`、`settingUpApps`、待执行 queue 均为空；否则该 run 失败并保留现场。

### setup 结果分类

- `SETUP_OK`：没有 ready timeout 且真实首屏 ready 达成。
- `TIMEOUT_LOW`：触发 timeout 但最终 realReady 达成，按失败处理，不允许仅记录 warning。
- `SETUP_FAILED`：setup 报错，或 timeout 后 realReady 未达成，阻断验收。
- Presentation realReady：当前页背景图 `complete && naturalWidth > 0`；Slide realReady：`controller.ready === true`；MediaPlayer realReady：`video.readyState >= 2`；DocsViewer：首张可见页图片 load/decode 或其正式 ready 信号。

## 功能测试

### 接口契约测试

###### TC-FUNC-001 [主动API/私参][force 生效条件] forceMaximized + lazy 只在允许状态启用

- **目标**：确认 force 是房间级策略，lazy/cache 是当前实例本地策略。
- **来源场景**：SC-01
- **前置**：可写管理端；房间初始无 force；准备 lazy 参数 `forceMaximized=true`、`lazySetupInMaximizedMode=true`、`maxCachedAppsInMaximizedMode=3`。
- **步骤**：
  1. mount 管理端并请求 `forceMaximized=true`，读取 attributes 和 TeleBox 状态，确认 `attributes.forceMaximized=true`、boxState 为 maximized，且没有 normal 状态提交。
  2. mount lazy 客户端，读取 `dumpState()`，确认只有 top/focused App `isSetup=true`，其他 App 只有 shell，且 lazy 客户端本地 cache 上限为 3。
  3. 在 eager 客户端使用相同房间但 `lazySetupInMaximizedMode=false`，确认所有 App 都进入 setup 队列并分别出现 setup start/done。
- **优先级**：P0
- **前置依赖**：无

###### TC-FUNC-002 [主动API/私参][normal 拦截] force 期间禁止 normal

- **目标**：确认 force 约束对 eager 和 lazy 客户端都生效。
- **来源场景**：SC-02
- **前置**：房间 `attributes.forceMaximized=true`，分别准备 lazy 和 eager WindowManager 客户端。
- **步骤**：
  1. 在两客户端调用 `setMaximized(false)`，返回值维持原声明类型，房间 attributes.maximized 不被写成 false，并各自产生 warning。
  2. 在两客户端调用 `setBoxState("normal")`，返回值维持原声明类型，TeleBox state 不变，并产生 warning。
  3. 调用 `setMinimized(false)`，当房间仍未 maximized 时确认 no-op + warning；随后由管理端保持 maximized，再调用 `setMinimized(false)`，确认只恢复到 maximized，不出现 normal。
- **优先级**：P0
- **前置依赖**：TC-FUNC-001

###### TC-FUNC-003 [私参行为契约][eager fallback] lazy 前置条件不满足时回退 eager

- **目标**：确认 lazy 请求在 force 缺失/为 false 或初始房间为 normal 时不会误启用。
- **来源场景**：SC-03
- **前置**：准备三组独立房间：A 无 `attributes.forceMaximized`，B force=false，C force 未开启且房间为 normal；三组均传 `lazySetupInMaximizedMode=true`。
- **步骤**：
  1. 分别 mount 三组客户端，确认每组 logger 出现对应 fallback warning，且客户端本地 lazy 开关为 false。
  2. 等待所有 App setup 完成，确认所有 App 均 `isSetup=true`，setup start/done 区间不交叉。
  3. 调用 focusApp、addApp、setMinimized 往返，确认行为与默认 eager 基线一致，不读取或创建 lazy runtime cache。
- **优先级**：P0
- **前置依赖**：无

###### TC-FUNC-004 [主动API/回调API][force 清除] 显式清除 force 后回退 eager

- **目标**：确认 force 清除触发 eager 补齐，且不隐式修改房间 boxState。
- **来源场景**：SC-04
- **前置**：lazy 客户端已在 maximized 运行，至少存在 3 个 shell，其中 1 个 ready、2 个未 setup。
- **步骤**：
  1. 管理端调用 `setForceMaximized(false)`，记录 attributes 变化和 setup queue 事件，确认 force 字段被清除、lazy 本地开关关闭、补齐任务进入串行队列。
  2. 等待 `setupAllApps()` 对应 Promise/queue idle，确认所有可 setup App 为 `isSetup=true`，每个 App 只有一个未完成 setup Promise，setup 区间不交叉。
  3. 读取 boxState，确认 force 清除没有隐式调用 `setMaximized(false)`；随后显式调用 normal API，确认原有 normal 语义恢复。
- **优先级**：P0
- **前置依赖**：TC-FUNC-001

###### TC-FUNC-005 [主动API/私参][cache 参数边界] cache 上限归一化

- **目标**：确认非法 cache 配置不会造成不可控容量或异常 setup。
- **来源场景**：SC-05
- **前置**：lazy + force 房间；分别准备 `0`、负数、小数、NaN/非数字、1、3、5、超过建议上限的值。
- **步骤**：
  1. mount 每组参数并读取归一化后的 getter 与 warning，确认非法值回退到 1，合法值保持，超大值按设计 warning 但不破坏 setup。
  2. 在每组配置下 setup 2 个 App，确认 cache 计数和淘汰行为使用归一化后的值。
- **优先级**：P1
- **前置依赖**：TC-FUNC-001

###### TC-FUNC-006 [主动API][公共 API 返回类型] focusApp/addApp/closeApp 失败语义保持

- **目标**：确认只新增 warning，不破坏已有声明类型和调用方控制流。
- **来源场景**：SC-12
- **前置**：lazy + force 房间；无效 appId、重复 scenePath、正在 rootDirRemoving 三类输入。
- **步骤**：
  1. 调用 `focusApp(不存在的 appId)`，确认返回仍为 `void/undefined`，logger 出现 `focusApp ignored`，不产生 pageerror。
  2. 调用 `addApp(已打开 scenePath)`，确认返回仍为 `Promise<string | undefined>`，结果为既有 undefined 语义并出现 warning，不抛出类型外异常。
  3. 调用 `closeApp(不存在的 appId)`，确认 Promise/void 声明不改变，attributes/proxy/cache 不新增残留。
- **优先级**：P1
- **前置依赖**：TC-FUNC-001

###### TC-FUNC-007 [主动API/回调API][minimized ready 语义] minimized 下新增 App 不 setup

- **目标**：确认 shell 创建和 runtime setup 分离。
- **来源场景**：SC-13
- **前置**：lazy + force 房间进入 minimized；清空当前可见 runtime。
- **步骤**：
  1. 调用 `addApp()`，确认 Promise 返回 appId、`queryOne(appId)` 可用、`isSetup=false`，且没有该 App 的 setup start 日志。
  2. 调用 `addAppAndWaitForSetup()`，确认按当前约定在 shell 创建后返回 appId，`isSetup=false`，不触发 runtime setup。
  3. 显式解除 minimized，确认按 top/focus 优先 setup 新 App，再提交 focus，realReady 达成后才出现 focus commit。
- **优先级**：P1
- **前置依赖**：TC-FUNC-001

### 业务场景测试

###### TC-FUNC-008 [策略点][容量与 LRU] cache=1/3/5 的命中和淘汰

- **目标**：确认不同容量下 cache hit、LRU、active/pending 保护一致。
- **来源场景**：SC-05
- **前置**：Presentation/Slide/MediaPlayer/DocsViewer 至少 5 个 shell；分别运行 cache=1、3、5。
- **步骤**：
  1. 按 A→B→C→D→E 顺序 focus，记录每次 setup start/done、teardown、`lastUsed` 和 focus commit。
  2. 对已 ready 且仍在 cache 的 App 反复 focus，确认无新 setup start，仅 `lastUsed` 递增，focus 在 setup 等待外完成。
  3. 在 cache 满时 focus 新 App，确认实际淘汰项是执行前 `lastUsed` 最小且不是 active/pending 的 ready 项，teardown 完成后 cache 按配置收敛。
  4. 重聚焦被淘汰 App，确认发生一次新的 setup，并最终 `state=ready`、每个 App 最多一条 cache entry。
- **优先级**：P0
- **前置依赖**：TC-FUNC-005

###### TC-FUNC-009 [策略点][pinned 状态] teardown 失败后保留并排除淘汰

- **目标**：确认单项和 minimized 批量 teardown 的失败契约一致。
- **来源场景**：SC-06
- **前置**：注入可控 App teardown reject；cache 中同时放入健康 App 和 flaky App。
- **步骤**：
  1. 触发单项淘汰并让 flaky teardown reject，确认 cache entry 变为 `pinned`、出现 error 日志、entry 仍按容量计数。
  2. 再触发多轮 cache miss，确认 pinned App 不再被 pick 为候选、teardown 调用次数保持 1。
  3. 进入 minimized 触发批量 teardown，确认 flaky 仍为 pinned，健康 App 正常删除，后续淘汰仍跳过 pinned。
- **优先级**：P1
- **前置依赖**：TC-FUNC-008

###### TC-FUNC-010 [策略点][软超限] 无 teardown App 保留 runtime

- **目标**：确认第三方 App 无 teardown 时不被错误删除记账。
- **来源场景**：SC-07
- **前置**：cache=1；注入 `canTeardown=false` 且已 setup 的 App，再准备可 teardown 新 App。
- **步骤**：
  1. 触发新 App cache miss，确认旧 runtime 不调用 teardown、cache entry 保留并出现 no-evictable warning。
  2. 等待新 App setup 完成，确认 cache size 可以为 2，且新 App 不因软超限被拒绝。
  3. 进入 minimized，确认无 teardown App 仍不被错误销毁；清房 destroy 后确认 proxy/cache/bookkeeping 全空。
- **优先级**：P1
- **前置依赖**：TC-FUNC-008

###### TC-FUNC-011 [策略点][minimized 状态转换] minimized 往返释放与恢复

- **目标**：确认 minimized 不保留可释放 runtime，但保留 shell 语义。
- **来源场景**：SC-08
- **前置**：lazy + force maximized；至少 3 个 ready runtime，其中包含 Presentation 和 Slide。
- **步骤**：
  1. 调用 `setMinimized(true)`，确认 teardown 通过同一串行队列执行，健康 runtime 的 `isSetup` 最终为 false，shell 仍可 `queryOne`。
  2. minimized 期间 focusApp 和 addApp 不触发未授权 runtime setup；TeleBox 不提交未 ready App focus。
  3. 调用 `setMinimized(false)`，确认 top/focused App 先 setup 并 realReady，再提交 focus；其余 App 不批量预热。
- **优先级**：P0
- **前置依赖**：TC-FUNC-008

###### TC-FUNC-012 [策略点][setup 优先级] 模式化 focus/forceTop/zIndex 排序与严格串行

- **目标**：确认批量 setup 优先级和真实 setup 区间不交叉。
- **来源场景**：SC-09
- **前置**：4 个未 setup App，分别设置 forceTop、当前 focus、不同 zIndex；分别使用 `useBoxesStatus=false/true`，阻塞资源加载以放大时序。
- **步骤**：
  1. 同步 add/恢复 4 个 App，记录所有 setup start/done 时间和队列 id。
  2. `useBoxesStatus=false` 确认 start 顺序为 focus > zIndex 降序 > 插入序，forceTop 不生效；`useBoxesStatus=true` 确认为 forceTop > focus > zIndex 降序 > 插入序；任意两个 App 的 `[start,done]` 区间不重叠。
  3. setup 尚未开始时改变 attributes.focus，确认未开始任务按新优先级重排，已开始任务不中断。
- **优先级**：P0
- **前置依赖**：TC-FUNC-001

###### TC-FUNC-013 [策略点][focus 重入] cache hit 与过期 focus

- **目标**：确认快速切换不会重复 setup 或提交过期焦点。
- **来源场景**：SC-10
- **前置**：cache=3，A/B/C 均 ready；准备 D 为 cache miss。
- **步骤**：
  1. 连续执行 A→B→A，确认 A/B 均无新增 setup，focus commit 次数与显式请求对应。
  2. 连续执行 D→B→C，在 D setup 未完成时改变 focus，确认最终只提交 C，D 不获得过期 focus。
  3. 确认旧 active runtime 不在新 App ready 前提前 teardown；cache miss 完成后再按 LRU 收敛。
- **优先级**：P0
- **前置依赖**：TC-FUNC-008

###### TC-FUNC-014 [协同点][focus 事件] 布尔广播不形成反馈循环

- **目标**：复现并阻断历史 focus 事件死循环。
- **来源场景**：SC-11
- **前置**：cache=3，至少两个 App 已 setup；App emitter 和 WindowManager focus 事件均开启计数。
- **步骤**：
  1. 只执行一次 A→B focus，记录 `focus:true/false`、box focus/blur、attributes.focus 和 app 请求事件。
  2. 静置 10 秒，确认没有新增用户操作时的 focusBox/makeBoxTop 链路、没有 focus 事件持续增长、CPU 没有主线程 runaway。
  3. 反复切换 10 次，确认每次显式切换最多产生一组状态变更，pageerror 和 unhandledrejection 均为 0。
- **优先级**：P0
- **前置依赖**：TC-FUNC-008

###### TC-FUNC-015 [功能点][四类 App ready] setup/teardown/re-setup 资源契约

- **目标**：确认四类内置 App 都以真实首屏 ready 作为 setup 队列完成条件。
- **来源场景**：SC-05、SC-08、SC-18
- **前置**：四类 App 各一个唯一 scenePath；开启 lazy cache=3。
- **步骤**：
  1. 逐个 focus 四类 App，确认各自 realReady 信号在 setup done 前已经达成，且分类为 SETUP_OK。
  2. 按 LRU 淘汰其中两个，再次 focus，确认 teardown 后 listener/DOM/player 清理，重新 setup 后资源可用。
  3. 对 Presentation 检查失焦 thumbnail/恢复 page.src；对 Slide 检查 frozen/unfrozen；对 Media 检查 video.readyState；对 DocsViewer 检查首张可见页。
- **优先级**：P1
- **前置依赖**：TC-FUNC-008

###### TC-FUNC-016 [异常与恢复][setup 失败] setup 失败不污染 shell/cache

- **目标**：确认 descriptor 缺失、资源失败、setup reject 的清理语义。
- **来源场景**：SC-12
- **前置**：准备一个可控 setup reject App 和一个健康 App。
- **步骤**：
  1. 触发失败 App setup，确认 Promise reject、错误日志包含 appId、runtimeCache 不保留该 App，健康 App 不被额外淘汰。
  2. 查询失败 App，确认 shell 是否按当前 API 约定保留；`attributes.apps` 与 proxy 集合不出现不一致。
  3. 修复资源后重新 focus，确认可重新 setup，`settingUpApps` 清空且不产生重复 cache entry。
- **优先级**：P1
- **前置依赖**：TC-FUNC-008

###### TC-FUNC-017 [状态转换][teardown-during-setup] setup 与 teardown/destroy 竞态

- **目标**：确认 runtime 被释放时，进行中的 setup 不把已释放 runtime 标记为 ready。
- **来源场景**：SC-10、SC-12
- **前置**：阻塞 App setup；准备 teardown、close、destroy 三种触发。
- **步骤**：
  1. setup 运行中触发 teardown，释放阻塞后确认 setup 以 aborted/reject 结束，不提交 focus、不写 ready cache。
  2. setup 运行中关闭 App，确认 `isDestroyed=true`，后续回调不访问已删除 box/proxy，不产生 pageerror。
  3. 重新 add 同类 App，确认新 setup 可完成，旧 Promise/listener/cache 不影响新 App。
- **优先级**：P1
- **前置依赖**：TC-FUNC-016

###### TC-FUNC-018 [协同点][多客户端房间] lazy 与 force+eager 同房间

- **目标**：确认 force/box 状态共享，lazy/cache 本地化。
- **来源场景**：SC-14
- **前置**：同一房间启动 M 管理端、L lazy+cache=3 端、E force+eager 端；三端使用相同 App 列表。
- **步骤**：
  1. M 调用 `setForceMaximized(true)`，三端读取 attributes，确认 force=true、normal 被拦截；L 的 cache 内容不出现在 E/M 的本地 dumpState。
  2. L 聚焦 A/B，确认 L 只维护本地 cache；E 端所有 App setup，且 E 的 setup 串行完成。
  3. M 清除 force，确认 L 回退 eager 并补齐；E 恢复原有 normal API 语义，但不会因 L 的本地 cache 事件改变自身 runtime。
- **优先级**：P0
- **前置依赖**：TC-FUNC-001、TC-FUNC-004

###### TC-FUNC-019 [状态转换][lazy reconnect] lazy 重连恢复

- **目标**：确认 lazy reconnect 只恢复必要 runtime，并等待 focused App ready 后提交 focus。
- **来源场景**：SC-15
- **前置**：lazy + cache=3；A focused ready、B/C cached、D shell-only；模拟断开后重连。
- **步骤**：
  1. 触发 reconnect，记录 shell 重建、setup queue、runtimeCache 和 focus generation。
  2. 确认 reconnect 后不并发 setup；focused/top App realReady 后才提交 focus，过期 generation 不提交旧 focus。
  3. 确认 cache entry 不重复，B/C 按当前策略保留或重建，D 不被无条件预热；清房后所有 bookkeeping 为空。
- **优先级**：P0
- **前置依赖**：TC-FUNC-008

###### TC-FUNC-020 [状态转换][eager reconnect] eager 重连等待全部 setup

- **目标**：确认 eager `onReconnected()` Promise 覆盖所有真实 `app.setup()` 完成。
- **来源场景**：SC-15
- **前置**：force+eager 客户端；至少 4 个 App；人为延迟其中两个 realReady。
- **步骤**：
  1. 触发 reconnect 并 await `onReconnected()`，确认返回前每个 App 的 setup done/realReady 已记录。
  2. 确认 setup start/done 区间不交叉，所有 App `isSetup=true`，不创建 lazy runtimeCache。
  3. reconnect 完成后 focus 任意 App，确认不重复 setup，pageerror=0。
- **优先级**：P0
- **前置依赖**：TC-FUNC-002

###### TC-FUNC-021 [状态转换][Player seek] seek rebuild 复用模式队列

- **目标**：确认 Player seek 的全量 attributes rebuild 不绕过 lazy/eager setup 状态机。
- **来源场景**：SC-16
- **前置**：Player lazy 端和 force+eager 端各一；至少 3 个 App；准备 seek 到包含不同 focus/zIndex 的时间点。
- **步骤**：
  1. 执行 seek rebuild，记录 shell 创建、setup start/done、focus commit 和 queue id。
  2. lazy 端确认只 setup 当前 top/需要的 runtime，eager 端确认全部 setup 串行完成；两端均无重复 cache entry。
  3. seek 连续执行 3 次，确认旧 generation 的 setup/focus 不覆盖最新状态，pageerror/unhandledrejection=0。
- **优先级**：P1
- **前置依赖**：TC-FUNC-019、TC-FUNC-020

###### TC-FUNC-022 [状态转换][bindContainer] 重复绑定不重复初始化

- **目标**：确认容器重绑不重复 setup、force 同步和 App 监听。
- **来源场景**：SC-17
- **前置**：lazy 和 eager 各一端；至少 2 个 ready App；准备两个 DOM container。
- **步骤**：
  1. 连续 bindContainer A→B→A，确认 App setup start 数不增加，已有 AppContext listener 不重复，force/box state 只同步一次。
  2. 对 Presentation 触发失焦/聚焦及背景图 load/error，确认新容器仍收到正确事件，旧容器事件不影响当前 App。
  3. 销毁并重新 bind，确认旧 container listener 清理，清房 bookkeeping 为空。
- **优先级**：P1
- **前置依赖**：TC-FUNC-008

###### TC-FUNC-023 [策略点][长稳态] 连续切换与恢复不积累资源和记账

- **目标**：确认 lazy/cache 和 force+eager 在长时间操作后没有 listener、queue、proxy 或 cache bookkeeping 泄漏。
- **来源场景**：SC-19
- **前置**：分别准备 lazy+force+cache=3 和 force+eager 两个独立房间；每个房间至少 4 个 App，开启 console、dumpState、CPU、heap 和 unhandledrejection 采样。
- **步骤**：
  1. 连续 30 分钟执行 A→B→C→D focus、cache miss、minimized 往返、close/re-add、每 5 分钟一次 reconnect；确认每轮 queue 最终 idle，focus event 在操作结束后不持续增长。
  2. 每分钟记录 `appProxies.size`、`runtimeCache.size`、`settingUpApps.size`、queue size、listener 数和 JS heap，确认不存在随轮次单调增长的趋势；pinned/zombie 数量必须能与注入场景对应。
  3. 清房并等待 queue idle，确认 apps、proxies、runtimeCache、settingUpApps 全部为空，pageerror/unhandledrejection 数为 0。
- **优先级**：P1
- **前置依赖**：TC-FUNC-018、TC-FUNC-019、TC-FUNC-020

## 性能测试方案

### 测试矩阵

| 维度 | 方案 |
|---|---|
| 模式 | lazy + force + cache=1/3/5；force + eager；lazy 参数但前置条件失败的 eager fallback |
| CPU | CDP `Emulation.setCPUThrottlingRate`：1x、6x、20x |
| 重复 | 每个模式/CPU 档至少 5 次独立清房；另做 30 分钟 soak 1 次 |
| App | Presentation、Slide、MediaPlayer、DocsViewer；至少 5 个 shell 才能触发 cache=3/5 的差异 |
| 操作序列 | 冷启动 → top ready → A/B/C 命中切换 → 第 4/6 个 App miss → minimized 往返 → reconnect → seek（Player）→ 清房 |
| 证据 | console、trace、CDP metrics、OS browser CPU、dumpState、page screenshot/video、pageerror/unhandledrejection |

### 指标与对比方法

1. **不要直接比较 `allAppsReady`**：lazy 的目标是不立即 setup 非 top App；必须同时报告 `firstFocusReady`、`allAppsReady`、`cacheHitSwitch`、`cacheMissSwitch`。
2. **ready 指标**：每个 App 记录 setup start、setup done、timeoutFired、realReady；输出 P50/P95/P99、最大值和分类计数。
3. **CPU 指标**：每次操作前 warm-up 30 秒；稳态再采样 30 秒。记录 `Performance.getMetrics` 的 `TaskDuration`/wall ratio，并记录浏览器进程 `%CPU`。`TaskDuration / wall time * 100` 作为单主线程等效负载，不能把 CDP throttle 倍率当 CPU 百分比。
4. **分窗口对比**：分别统计 idle、cache-hit focus、cache-miss setup、minimized teardown、reconnect 五类窗口；lazy miss 与 eager idle 不直接比较。
5. **资源指标**：报告 runtime ready 数、cache size、pinned/zombie 数、JS heap used/total、queue size。若执行机可提供 RSS/显存，单独记录，不能用 JS heap 替代 RSS。

### 6x/20x 执行步骤

1. 固定构建和房间，清除浏览器 profile/service worker 缓存；先跑 1x 基线。
2. 对每个模式执行 5 次冷启动，run 间关闭全部 App、等待 queue idle、确认 bookkeeping 为空。
3. 设置 6x，执行同一操作序列；每次直到所有分类完成、queue idle 或 watchdog 触发。
4. 设置 20x，执行同一操作序列；单 run watchdog 15 分钟，超时保留 trace 并标记 ABORT，不自动判 PASS。
5. 每档计算成功率、timeout 分类、P50/P95/P99、最大 ready、主线程 CPU P50/P95/max、pageerror/crash 数、focus 事件总数和 cache 违规数。
6. 对任何 FAIL 先保留原始证据，再复测同档 5 次；不得先修改 harness 或放宽阈值后覆盖失败。

### S1 CPU 门槛校准与锁定

1. 在正式性能批前固定执行机、Chromium、WindowManager/App 产物、房间和采样脚本；清理浏览器缓存并重启测试页面。
2. 空房间和单 App 各采集 30 秒稳态窗口，至少各 3 个窗口；计算每个窗口的 `TaskDuration` 增量 / 墙钟时间，并保留原始 CDP metrics。
3. 初始门槛为 20%。若固定环境基线 P95 `<= 20%`，继续使用 20%；若基线 P95 `> 20%`，将门槛锁定为 `P95(baseline) + 10 个百分点`，并记录校准原因、样本和版本。
4. 锁定结果写入本次测试的 `thresholds.json`，所有 1x/6x/20x 和 lazy/eager/fallback run 使用同一门槛；性能批中不得按模式、CPU 档或失败结果重新校准。
5. CPU 门槛只判定主线程稳态负载；ready 延迟、timeout、pageerror、queue 卡死和 focus loop 仍按各自阻断门禁单独判定。

### 结果记录模板

每个 `mode × cache × throttle × run` 填一行；lazy miss 和 eager idle 不放在同一延迟列中比较。

| mode | cache | throttle | run | firstFocusReady P95 | allAppsReady P95 | hit focus P95 | miss focus P95 | realReady P95 | TIMEOUT_LOW / FAILED | idle CPU P95 | peak CPU | JS heap peak | focus events | pageerror/crash | verdict |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| lazy | 1/3/5 | 1x/6x/20x | 1-5 |  |  |  |  |  |  |  |  |  |  |  |  |
| force+eager | N/A | 1x/6x/20x | 1-5 |  |  |  |  |  |  |  |  |  |  |  |  |
| fallback eager | N/A | 1x/6x/20x | 1-5 |  |  |  |  |  |  |  |  |  |  |  |  |

### lazy/eager 对比结论表

| 对比项 | lazy + force + cache | force + eager / fallback eager | 验收解释 |
|---|---|---|---|
| 初始 setup 数 | top/当前需要的 App | 所有 App | 两者都必须按真实 ready 契约完成；不以 setup 数少直接判定 PASS |
| cache hit | 不重新 setup，仅刷新 LRU | 不重新 setup，runtime 常驻 | hit 窗口必须分别统计，6x/20x 不得出现 focus loop |
| cache miss | 允许发生串行 setup + LRU teardown | 不应因 cache miss 发生 teardown | lazy miss 的延迟不与 eager idle 直接比较，需单独报告 |
| minimized | teardown 可释放 runtime，保留 shell | 遵循 eager 原有生命周期 | 两种模式都不得出现 pageerror 或清理泄漏 |
| force 清除 | 回退 eager，补齐全部未 setup App | 已是 eager，行为不重复变化 | force 清除后房间 boxState 不被隐式修改 |
| CPU 6x/20x | 不得 runaway、超时或崩溃 | 不得 runaway、超时或崩溃 | 6x/20x 各 5/5 PASS；任意 TIMEOUT_LOW/FAILED 即 FAIL |

## 验收标准

### 阻断门禁

- P0 用例全部 PASS；P1 不得有未解释的 FAIL。
- 任意模式/CPU 档出现 `SETUP_FAILED`、pageerror、unhandledrejection、page crash、queue 永久不 idle、focus loop，整体 FAIL。
- 6x 和 20x 各 5 次必须 5/5 通过；不能以 1x 通过替代高节流验收。
- 任意 `TIMEOUT_LOW` 均 FAIL，必须依据 realReady 分布调整 ready timeout 并从头复测该档。

### 功能不变量

- force=true 的支持客户端不能通过公开 normal 路径进入 normal；force=false 后 normal 原语义恢复。
- lazy 初始只 setup 当前 top/需要的 App；eager/fallback eager 在等待完成后全部 App `isSetup=true`。
- setup/teardown 区间零交叉；同一 App 并发 setup 请求复用同一 Promise；每个 App 至多一个 cache entry。
- cache hit 不触发新 setup；cache miss 的实际淘汰与 LRU 预测一致；active/pending App 不被提前淘汰。
- pinned 和无 teardown runtime 的记账、容量计数、淘汰排除、warning/error 日志符合设计；软超限必须可解释。
- minimized 下健康 runtime 释放、shell 可查询；解除 minimized 后 top 先 ready 再 focus；清房后所有 bookkeeping 为空。
- reconnect/seek/bindContainer 不产生重复 setup、旧 focus 提交或 listener 泄漏。

### CPU/稳定性门槛

- 6x/20x 每次 run 无主线程 runaway：稳态 30 秒窗口的主线程等效负载不得连续 5 秒超过 20%；单次操作窗口记录峰值，若超过 80% 且伴随 timer 延迟、focus 事件增长或 queue 不推进，FAIL。
- 无用户操作的 10 秒 idle 窗口，focus/box focus 事件不得持续增长；建议计数为 0，若实现存在一次性同步事件，必须在首个状态收敛后停止增长。
- cache-hit focus 不得触发 setup；其 P95 focus commit 延迟以 1x 同模式基线为参照，6x/20x 不得超过该基线的 3 倍且不得超过 2 秒。cache-miss 单独报告，不套用 hit 阈值。
- lazy 与 eager 的资源结论必须同时成立：lazy ready runtime 数不超过 `cacheMax + pinned/zombie 软超限数`，eager/fallback eager 在 setup 完成后 ready runtime 数等于 App 数；不能只用 CPU 较低作为 PASS。
- 6x/20x 与 1x 的 realReady 分布、timeout 分类和 page error 必须逐档报告；所有差异都要能由 CPU throttle 或 App ready 时间解释，不能只给平均值。

### 交付物

- 每个 run 一个目录：`config.json`、console、trace、CDP metrics、OS CPU CSV、dumpState 时间线、截图/视频、失败时的 page crash/stack。
- 汇总表按 `mode × cache × throttle × run` 列出 firstFocusReady、allAppsReady、hit/miss latency、realReady P50/P95/P99、CPU P50/P95/max、heap、错误数和最终 verdict。
- 结论必须分别给出：lazy/cache 是否通过、force+eager 是否通过、lazy fallback 是否通过、6x 是否通过、20x 是否通过；不能合并成一个“整体通过”。

## 兼容性测试

来源为设计中的 force 房间协议、lazy/eager 客户端混用、只读/Player 约束和四类内置 App ready 契约。至少执行可写管理端、只读 lazy 端、force+eager 端、Player 四类角色；旧版客户端若无法约束 normal，单独记录为协议兼容风险，不计入支持版本 PASS。

## 压测

来源为既有 F1-F7 与 6x/20x 压测报告，本次扩展加入 force 清除、eager fallback、minimized、reconnect、seek、bindContainer。6x/20x 各 5 次独立清房，按上方 CPU/稳定性门槛判定；20x 单 run 超过 15 分钟标记 ABORT 并保留全部证据。

## 云测

研发未单独列为测试项，不进行测试。

## 回归测试

每次相关改动至少执行：WindowManager 单测、四 App build/test、既有 F1-F7、TC-FUNC-001/002/004/008/011/014/018/019/020，以及 1x smoke；变更涉及 setup/queue/cache 时追加完整 6x/20x 矩阵。
