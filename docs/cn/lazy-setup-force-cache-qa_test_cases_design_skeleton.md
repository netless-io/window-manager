# WindowManager forceMaximized + lazy/cache 与 eager fallback 测试设计骨架

**数据来源**：

- `docs/cn/lazy-setup-in-maximized-mode-design.zh-CN.md`
- 工作区 `ai/records/2026/2026-09-18-window-manager-lazy-setup-v2-multi-cache-design.md`
- 工作区 `ai/records/2026/2026-09-19-lazy-setup-v2-verify-stress-report.md`
- 当前实现：`repos/window-manager` `22e03d0`

## 1. 需求摘要

- **解决什么问题**：在房间被 `forceMaximized` 锁定时，允许当前客户端只为需要显示的 App 创建 runtime，并用多 App LRU 缓存控制内存；关闭 lazy 或 force 策略后回退到原有 eager 语义。
- **核心行为 / 设计承诺**：force 为房间级约束；lazy/cache 只影响当前 WindowManager；setup、teardown 严格串行；未 setup 的 App 不得先提交 focus；eager 仍 setup 全部 App，但 setup 同样经过串行队列。
- **QA 实际测试边界**：覆盖单客户端、多客户端房间状态、公共 API、四类内置 App、cache=1/3/5、minimized、reconnect、seek、bindContainer、force 清除和 CPU 6x/20x。native/Bridge 参数透传只验证 Web 侧输入输出契约，跨端真机另列执行项。
- **HLD 已明确的关键验收口径**：lazy 仅在 `attributes.forceMaximized=true` 且房间为 maximized/minimized 时生效；cache 命中不重 setup；LRU 淘汰可预测；setup 区间不交叉；force 期间 normal API no-op；minimized 不保留可释放 runtime。
- **全局仍待确认口径**：应用侧 `onAppSetup` 是否要求“每次 runtime setup”还是“每个 App 首次 setup”；完整 RSS/显存预算阈值；跨端协议最终版本和设备矩阵。

## 1.1 执行参数与性能门槛

- **example 参数**：`?force=0|1`、`?lazy=0|1`、`?cache=1|3|5`；缺省保持 `force=1`、`lazy=1`、`cache=3`。非法 URL 参数回退到对应缺省值并输出 warning；最终值从 `window.windowManagerTestConfig` 记录。
- **S1 CPU 门槛**：固定执行机、Chromium、构建产物和房间后，先执行空房间与单 App 各 30 秒基线。主指标为 `Performance.getMetrics` 的 `TaskDuration` 增量 / 窗口墙钟时间；初始门槛为 20%。若固定基线 P95 已高于 20%，将门槛一次性修订为 `P95(baseline) + 10 percentage points`，并在性能批开始前锁定；性能批期间不得为通过单次失败临时放宽。

## 2. 设计收敛结论

- **核心测试对象划分**：force 策略与模式回退、runtime cache 状态机、setup/focus 协同、公共 API 与 App 生命周期、多客户端房间协同、性能与稳定性。
- **高优先级对象**：策略回退、cache 状态机、setup/focus 协同。它们分别决定是否误入 normal、是否重复 setup/错误淘汰、是否产生焦点死循环或未 ready 先展示。
- **整体设计重点**：所有 lazy 结果必须与 eager 对照；所有 6x/20x 结果必须记录 `realReady`、timeout 分类、CPU 主线程负载、pageerror、focus 事件计数和 runtime 状态，而不能只记录“页面打开成功”。

## 3. 功能测试设计

### 3.1 测试对象骨架表

| 测试对象 | 对象类型 | 设计承诺 | 关键覆盖面 | 详细用例归属 | 优先级 |
|---|---|---|---|---|---|
| force 策略与模式回退 | 策略型 | force 是房间级约束；lazy 的启用条件、关闭和 eager fallback 可判定 | 生效条件、状态转换、normal 拦截、回退补齐、非法配置 | 接口契约测试 | P0 |
| runtime cache 状态机 | 状态型 | `setting-up/ready/tearing-down/pinned` 和 LRU/cache 上限行为正确 | cache=1/3/5、命中、淘汰、软超限、pinned、minimized | 业务场景测试 | P0 |
| setup/focus 串行协同 | 协同型 | setup/teardown 不交叉，未 ready 不 focus，focus 事件布尔语义不形成回环 | 优先级、重入、过期 focus、事件次数、teardown 竞态 | 业务场景测试 | P0 |
| 公共 API 与 App 生命周期 | 契约型 | API 返回类型和 ready 语义保持，shell/runtime/destroy 边界清楚 | add/focus/close/minimized、非 top wait、重复 setup、失败清理 | 接口契约测试 | P1 |
| 房间协同与恢复 | 协同型 | 多客户端共享 force，lazy/cache 本地化；reconnect/seek/bindContainer 不破坏状态 | lazy/eager 客户端、只读端、重连、seek、重复绑定 | 业务场景测试 | P0 |
| 性能与稳定性 | 策略型 | lazy 降低未使用 runtime；eager 保持功能完整；6x/20x 不出现超时、死循环或崩溃 | CPU、ready 延迟、队列、heap、page crash、soak | 业务场景测试 | P0 |

### 3.2 测试设计重点

- **优先覆盖**：同一房间 lazy/eager 对照、force 清除后补齐、cache=1/3/5、minimized 往返、reconnect/seek、6x/20x 稳定性。
- **主要判断方式**：浏览器 console 事件、`dumpState()`、App ready/teardown/focus 日志、DOM/播放器状态、WindowManager 公共 API 返回值、CDP `Performance.getMetrics` 和系统进程 CPU 采样。
- **不展开内容**：WindowManager 单元测试已经验证的纯队列算法不作为 E2E 重复实现；native/Bridge 真机参数透传、显存和完整 RSS 由跨端专项执行，但本方案定义其 Web 侧证据接口。

### 3.3 场景追溯表

| 场景ID | 主归属对象 | 关联对象 | 优先级 | 场景描述 | 脑图节点 | 详细用例 |
|---|---|---|---|---|---|---|
| SC-01 | force 策略与模式回退 | 房间协同与恢复 | P0 | 可写客户端开启 force 后进入 maximized，lazy 客户端按条件启用 | force 生效 | TC-FUNC-001 |
| SC-02 | force 策略与模式回退 | 公共 API 与 App 生命周期 | P0 | force 期间 normal/maximized API 被拦截，状态和 warning 一致 | normal 拦截 | TC-FUNC-002 |
| SC-03 | force 策略与模式回退 | 性能与稳定性 | P0 | lazy 配置前置条件不满足时回退 eager，全部 App 仍完成 setup | eager fallback | TC-FUNC-003 |
| SC-04 | force 策略与模式回退 | 房间协同与恢复 | P0 | 显式清除 force 后 lazy 客户端回退 eager 并补齐 runtime | force 清除 | TC-FUNC-004 |
| SC-05 | runtime cache 状态机 | 性能与稳定性 | P0 | cache=1/3/5 的命中、容量和 LRU 淘汰一致 | 容量与 LRU | TC-FUNC-005, TC-FUNC-008 |
| SC-06 | runtime cache 状态机 | 公共 API 与 App 生命周期 | P1 | teardown 失败进入 pinned，后续淘汰不重复调用 | pinned | TC-FUNC-009 |
| SC-07 | runtime cache 状态机 | 公共 API 与 App 生命周期 | P1 | 无 teardown App 保留 runtime，允许软超限并有 warning | 软超限 | TC-FUNC-010 |
| SC-08 | runtime cache 状态机 | 房间协同与恢复 | P0 | minimized 释放可释放 runtime，shell 保留，解除后 top 优先恢复 | minimized | TC-FUNC-011 |
| SC-09 | setup/focus 串行协同 | runtime cache 状态机 | P0 | 多 App setup 串行，global/lazy 忽略 forceTop，独立窗口模式保留 forceTop 优先级 | setup 排序 | TC-FUNC-012 |
| SC-10 | setup/focus 串行协同 | 公共 API 与 App 生命周期 | P0 | cache hit 不重新 setup，过期 focus 不提交 | focus 重入 | TC-FUNC-013, TC-FUNC-017 |
| SC-11 | setup/focus 串行协同 | 性能与稳定性 | P0 | focus 布尔广播与旧请求语义不形成循环 | focus 事件 | TC-FUNC-014 |
| SC-12 | 公共 API 与 App 生命周期 | runtime cache 状态机 | P1 | add/focus/close/wait API 的返回值和 shell/runtime 生命周期正确 | API 契约 | TC-FUNC-006, TC-FUNC-016, TC-FUNC-017 |
| SC-13 | 公共 API 与 App 生命周期 | 房间协同与恢复 | P1 | minimized 下 addApp 只建 shell、记录 warning 并返回 appId | minimized API | TC-FUNC-007 |
| SC-14 | 房间协同与恢复 | setup/focus 串行协同 | P0 | lazy 客户端和 eager 客户端同房间观察到一致 force/box 状态 | 多客户端 | TC-FUNC-018 |
| SC-15 | 房间协同与恢复 | runtime cache 状态机 | P0 | reconnect 后 lazy 只恢复必要 runtime，eager 等待全部 setup | reconnect | TC-FUNC-019, TC-FUNC-020 |
| SC-16 | 房间协同与恢复 | runtime cache 状态机 | P1 | Player seek rebuild 不产生并发 setup 或重复 cache entry | seek | TC-FUNC-021 |
| SC-17 | 房间协同与恢复 | setup/focus 串行协同 | P1 | 重复 bindContainer 不重复 setup、focus 或 force 同步 | bindContainer | TC-FUNC-022 |
| SC-18 | 性能与稳定性 | runtime cache 状态机 | P0 | 1x/6x/20x 下 lazy 与 eager 的 ready、CPU、错误、缓存结果可对比 | CPU 对比 | TC-FUNC-015 + 性能测试方案 |
| SC-19 | 性能与稳定性 | 房间协同与恢复 | P1 | 连续 30 分钟切换/重连 soak 不增长 listener、queue 或 stale bookkeeping | soak | TC-FUNC-023 |

### 3.4 对象级关键场景与待确认项

### force 策略与模式回退

- **关键场景**：`SC-01`、`SC-02`、`SC-03`、`SC-04`。
- **待确认**：force 清除 API 是否要求调用方等待所有 eager setup 完成；当前设计只要求任务进入串行队列。

### runtime cache 状态机

- **关键场景**：`SC-05`、`SC-06`、`SC-07`、`SC-08`。
- **待确认**：pinned runtime 的实际 RSS/显存是否纳入产品容量门槛；当前设计只要求按 cache slot 计数并排除淘汰。

### setup/focus 串行协同

- **关键场景**：`SC-09`、`SC-10`、`SC-11`。
- **待确认**：同一 App 多次 setup 后 `onAppSetup` 是否允许多次触发；当前实现语义是每次 setup 完成均可触发，订阅方必须幂等。

### 公共 API 与 App 生命周期

- **关键场景**：`SC-12`、`SC-13`。
- **已对齐**：`addApp()` 在 minimized + lazy 下只创建 shell、记录 warning 并返回 appId，解除 minimized 后再 setup。

### 房间协同与恢复

- **关键场景**：`SC-14`、`SC-15`、`SC-16`、`SC-17`。
- **待确认**：多客户端测试是否必须包含旧版客户端；设计要求兼容版本之间强制 normal 约束一致，旧版不具备该能力时需单独标记非阻断兼容风险。

### 性能与稳定性

- **关键场景**：`SC-18`、`SC-19`。
- **待确认**：最终 CPU/heap/RSS 绝对门槛需结合固定执行机基线确认；本方案先采用“绝对 runaway 门槛 + eager 相对回归门槛”。

## 4. 性能测试

- **是否测试**：是。来源为设计中的 runtime 内存优化目标、setup ready 超时约束和用户明确要求的 CPU 6x/20x 对比。
- **方案**：固定 Chromium、机器、资源、App 顺序和房间数据；分别运行 lazy `cache=1/3/5`、force+eager、lazy 前置条件失败后的 eager fallback；每种模式先 1x，再 6x、20x，各 5 次冷启动和 1 次 30 分钟稳态。
- **主要指标**：first-focus-ready、all-apps-ready、cache miss/hit latency、`realReady` P50/P95/P99、TIMEOUT_LOW/SETUP_FAILED 数、主线程 CPU load、OS browser CPU、JS heap、pageerror、page crash、focus 事件计数、setup/teardown 区间。

## 5. 兼容性测试

- **是否测试**：是。来源为 force 房间协议、lazy/eager 客户端混用、只读/Player、Web SDK 与四类内置 App 的设计约束。
- **方案**：至少覆盖可写管理端、只读 lazy 端、eager 端三种角色；四类 App 各至少一个场景；旧版客户端仅做“不能被 force 约束”的显式风险确认，不与新版本 PASS 混合。

## 6. 压测

- **是否测试**：是。来源为既有报告 6x/20x 方案以及本次新增 lazy/eager 对比要求。
- **方案**：每档 5 次独立清房；每次执行初始化、切换命中、cache miss、LRU、minimized、reconnect；每个 run 都保存 `dumpState`、console、CDP metrics 和视频/trace。
- **判定**：6x/20x 不允许将超时降级为 warning；任何 TIMEOUT_LOW、SETUP_FAILED、pageerror、focus loop、queue 卡死、stale bookkeeping 均失败。

## 7. 云测

研发未单独列为测试项，不进行测试。

## 8. 回归测试

- **是否测试**：是。来源为设计 §17/§20 的 eager 行为保持、已有 F1-F7、force API 和跨路径回归要求。
- **方案**：每次实现变更至少执行：WindowManager 198+ 单测、四 App 测试/build、F1-F7、lazy/eager 对照 smoke、force lifecycle、多客户端 E2E、6x/20x 各 5 次。

## 9. 产物映射与边界

- **脑图对象**：使用 3.1 的六个测试对象；性能、兼容性、压测、云测、回归作为根节点专项分支。
- **详细用例归属**：force 策略与公共 API进入接口契约测试；其余进入业务场景测试。
- **P0/P1 双向追溯**：`SC-01` 至 `SC-19` 全部需要在骨架、脑图、详细用例或专项测试方案中可回查。
- **非 QA 范围**：纯单元测试实现细节、跨端真机发布门禁、实际显存硬指标由对应仓库/设备专项执行，但结果必须回填本方案的专项结论。
