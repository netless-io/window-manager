# MainView `originSize` 统一原始尺寸设计

## 1. 目标

WindowManager 当前使用第一个写入 attributes 的可写端本地 `mainView.size` 作为 camera 的参考尺寸。
不同终端的容器尺寸、宽高比和加入顺序不同，因此同一个 `mainViewCamera.scale` 可能显示不同的世界区域。

本设计为 mainView 增加固定的房间原始基准，同时保留 `scalePptToFit()` 显式替换当前同步视口的能力：

- 四端通过 `WindowManager.mount({ originSize })` 配置完全相同的原始尺寸；
- `originSize` 只能在 mount 时传入，单个 manager 生命周期内不能被 camera API 动态修改；
- 新的可写端显式 mount 不同 `originSize` 时，可以原子重建房间 origin contract；
- origin camera 固定为 `{ centerX: 0, centerY: 0, scale: 1 }`；
- 正常 camera API 只修改当前 camera，不受写入端本地像素尺寸影响；
- `scalePptToFit()` 的优先级高于 origin 基准，可以原子替换当前同步 size/camera；
- `fitOriginSizeAndCamera()` 将当前同步 size/camera 恢复为 origin 基准；
- 未配置 `originSize` 时完整保留 legacy 行为。

该规则只覆盖 WindowManager mainView。Slide、Presentation 的 App View 继续使用 `addApp()` attributes
中的 `originSize`，不读取也不跟随本次 mainView mount 重置。

## 2. 数据模型

启用 origin 模式后，WindowManager attributes 保存两组 camera reference：

```ts
type OriginMainViewAttributes = {
    // 固定基准，初始化后任何公开 camera API 都不能修改。
    originSize: Size & { id: string }
    originCamera: Camera & { id: string }

    // 当前生效的共享参考视口，允许明确的业务 API 修改。
    mainViewSize: Size & { id: string }
    mainViewCamera: Camera & { id: string }

}
```

| 字段 | 是否可变 | 含义 |
| --- | --- | --- |
| `originSize` | 生命周期内否 | mount 配置建立的房间原始参考尺寸；新的 writable mount 可以重建 |
| `originCamera` | 生命周期内否 | 固定恢复目标 `{ centerX: 0, centerY: 0, scale: 1 }`；重建时恢复默认值 |
| `mainViewSize` | 是 | 当前生效的共享参考尺寸 |
| `mainViewCamera` | 是 | 相对当前 `mainViewSize` 表达的共享 camera |

空房间首次初始化时必须原子写入：

```text
originSize       = mount originSize
originCamera     = { centerX: 0, centerY: 0, scale: 1 }
mainViewSize     = originSize
mainViewCamera   = originCamera
```

`originSize/originCamera` 是恢复基准，`mainViewSize/mainViewCamera` 是渲染和同步使用的 active pair。
一旦 `mainViewSize` 被 `scalePptToFit()` 替换，本地换算必须使用 `mainViewSize`，不能继续固定使用
`originSize`。

已有 legacy `mainViewSize/mainViewCamera` 的房间首次启用 origin 模式时，传入 `originSize` 的可写端
必须按 mount 配置原子重建 origin pair 和 active pair：

```text
originSize       = mount originSize
originCamera     = { centerX: 0, centerY: 0, scale: 1 }
mainViewSize     = mount originSize
mainViewCamera   = originCamera
```

这次初始化会丢弃历史房间由首个旧客户端本地尺寸生成的 active pair，使 `originSize` 第一次设置时立即
成为 MainView 的同步换算基准。只读端不能完成该同步写入，因此保持 legacy 模式，等待可写端先初始化。

已有 origin attributes 且显式 mount 的 `originSize` 不同时，可写端必须原子重建 origin pair 和 active pair：

```text
originSize       = new mount originSize
originCamera     = { centerX: 0, centerY: 0, scale: 1 }
mainViewSize     = new mount originSize
mainViewCamera   = originCamera
```

重建同时替换 origin pair 和 active pair，语义等同于以新基准执行一次同步的 fit origin。只替换
`originSize` 会让 active pair 继续引用旧尺寸，无法保证新基准立即作用到 MainView scale，因此不允许。

## 3. 配置与房间契约

配置入口只有：

```ts
await WindowManager.mount({
    room,
    container,
    originSize: { width: 1920, height: 1080 },
})
```

限制：

- width、height 必须是有限正数；
- 正常运行时，同一个房间的所有端应传入完全相同的 width、height；
- 不提供运行时 setter；更换 originSize 必须销毁当前 manager，再由可写端使用新值重新 mount；
- 可写端 mount 配置与 attributes `originSize` 不一致时，以本次 mount 配置为准原子重建 origin pair 和 active pair；
- 只读端不能覆盖 attributes；attributes 没有 `originSize` 时保持 legacy，已有 `originSize` 时忽略本地不一致配置；
- origin 模式必须保留 `originCamera`、`originSize`、`mainViewSize`、`mainViewCamera` 四个字段；不再使用额外版本字段；
- `originCamera` 必须等于固定默认值，业务不能通过 attributes 修改。

多个可写端同时初始化时，只要 mount 的 `originSize` 一致，写入内容完全相同，不再由先进入房间的终端
尺寸决定原始基准。多个可写端同时发布不同 camera 仍然是最后写入生效，originSize 不解决 camera
控制权竞争。若多个可写端使用不同 originSize 反复 mount，最后写入的完整 contract 生效，其他已挂载端
会出现 contract 不一致；该重置能力用于受控配置升级，不能替代多端统一配置。

## 4. active pair 与本地 View 换算

设：

```text
M = attributes.mainViewSize
C = attributes.mainViewCamera
L = 当前终端真实 mainView.size
```

本地 baseScale：

```text
baseScale = min(L.width / M.width, L.height / M.height)
```

active camera 转本地 camera：

```text
local.centerX = C.centerX
local.centerY = C.centerY
local.scale   = C.scale * baseScale
```

本地 camera 反向转换为 active camera：

```text
C.centerX = local.centerX
C.centerY = local.centerY
C.scale   = local.scale / baseScale
```

center 是世界坐标，不随 View 像素尺寸变化。正反换算必须使用同一个稳定布局快照：

```ts
type CameraLayoutSnapshot = {
    revision: number
    mainViewSize: Size
    localSize: Size
    baseScale: number
}
```

resize、横竖屏和 `setContainerSizeRatio()` 期间不能使用旧 local camera 配合新 local size 反算，否则会
污染 `mainViewCamera.scale`。布局变化本身只重放 active pair，不发布 attributes。

## 5. API 与状态变化

### 5.1 完整矩阵

| 业务入口 | `originSize` | `originCamera` | `mainViewSize` | `mainViewCamera` |
| --- | --- | --- | --- | --- |
| 空房间初始化 origin 模式 | 设置为 mount 配置 | 设置为默认 origin camera | 设置为 `originSize` | 设置为 `originCamera` |
| 旧房间首次启用 origin 模式 | 设置为 mount 配置 | 设置为默认 origin camera | 设置为 `originSize` | 设置为 `originCamera` |
| writable mount 重置已有 v2 origin 模式 | 设置为新 mount 配置 | 恢复默认 origin camera | 设置为新 `originSize` | 设置为默认 origin camera |
| `moveCamera()` | 不变 | 不变 | 不变 | 更新 |
| `moveCameraToContain()` | 不变 | 不变 | 不变 | 更新 |
| `scalePptToFit()` | 不变 | 不变 | 更新 | 更新 |
| `fitOriginSizeAndCamera()` | 不变 | 不变 | 恢复为 `originSize` | 恢复为 `originCamera` |
| 容器 resize | 不变 | 不变 | 不变 | 不变 |
| `setContainerSizeRatio()` | 不变 | 不变 | 不变 | 不变 |
| `setCameraBound()` | 不变 | 不变 | 不变 | 不变 |

内部入口：

| 内部入口 | `originSize` | `originCamera` | `mainViewSize` | `mainViewCamera` |
| --- | --- | --- | --- | --- |
| `setCameraAndSize()` | 不变 | 不变 | 更新 | 更新 |

`setCameraAndSize()` 不是公开 API。origin 模式下只能由明确需要替换 active pair 的业务场景调用，不能再
被初始化、Broadcaster 切换、普通 move API 等路径复用。

### 5.2 `moveCamera()`

启用 origin 模式后，API 参数属于当前 active pair 的逻辑 camera。WindowManager 合并 partial camera
后，使用当前 `mainViewSize` 转成本地 camera。attributes 只更新 `mainViewCamera`，不修改任何 size
或 origin 字段。

### 5.3 `moveCameraToContain()`

contain 应基于当前 `mainViewSize` 计算共享逻辑 camera：

```text
mainScale = min(mainViewSize.width / rectangle.width,
                mainViewSize.height / rectangle.height)
```

然后再转换成本地 scale。不能先基于调用端 local size contain 再反算，否则调用端宽高比会进入共享结果。

### 5.4 `scalePptToFit()`

该 API 明确高于 origin 基准。WindowManager 在调用底层 fit 时保存不受本地 CameraBound 影响的逻辑
target camera，以及该 camera 所属的 active reference size。布局和动画稳定后，将逻辑 target 换算到最终
本地 `mainView.size`，作为新的 active pair：

```text
R = target camera 计算时的 attributes.mainViewSize
C = 不受本地 CameraBound 影响的逻辑 target camera
L = final local mainView.size

mainViewSize         = L
mainViewCamera.scale = C.scale * min(L.width / R.width, L.height / R.height)
mainViewCamera.centerX = C.centerX
mainViewCamera.centerY = C.centerY
```

两者必须原子写入。因为新的 `mainViewSize` 等于 `L`，新 active pair 在调用端对应的 baseScale 为 `1`；
其他端再根据自己的 local size 执行换算。

`scalePptToFit()` 默认可能使用连续动画，因此不能在调用底层 API 后立即提交。应在最后一次 camera 更新
停止后延迟提交，并取消旧的待提交任务；延迟用于等待动画和布局稳定，提交值仍来自保存的逻辑 target，
不能重新采集可能已经被 CameraBound 或其他本地状态修改的 `view.camera`。

该协调逻辑只在 origin 模式启用。WindowManager 在调用原始 `scalePptToFit()` 期间识别其是否真的触发了
被接管的 `moveCameraToContain()`：没有 PPT、没有触发 contain 时保持 SDK 的 no-op，不写 attributes；
触发 contain 时将该操作标记为 active-pair capture。若此时正在 resize 或切换容器比例，contain 操作必须
保留到布局稳定后执行，再原子提交最终 `mainViewSize/mainViewCamera`，不能先单独发布中间 camera。
contain operation 清理后到 active pair 提交前，WindowManager 必须独立保留待提交的逻辑 camera；期间发生的
partial camera API、resize 或 rebind 都以该 camera 为基准，后续 camera 操作继续并入同一次 active-pair
capture，不能回退读取旧 attributes，也不能在 pair 提交后再执行 camera-only 覆盖。
若延迟提交期间调用 `setCameraBound()`，CameraBound 只修改调用端本地 View，不修改保存的逻辑 target，
也不能进入最终提交的 active pair。
未配置 `originSize` 时继续使用原有调用和采集路径。

### 5.5 `fitOriginSizeAndCamera()`

新增公开 API：

```ts
manager.fitOriginSizeAndCamera()
```

调用后原子写入：

```text
mainViewSize   = originSize
mainViewCamera = originCamera
```

origin pair 自身不发生变化。本地随后按恢复后的 active pair 重新计算 camera。未启用 originSize 时该方法
不执行任何操作。

### 5.6 `setCameraBound()`

CameraBound 保持 legacy 的本地 View 语义：

- 只应用于当前终端的 `mainView`；
- 不进入 WindowManager attributes；
- 不修改 origin pair 或 active pair；
- 不把 CameraBound 限制后的本地 camera 反向发布为 `mainViewCamera`；
- 不同端设置不同 CameraBound 时，允许最终本地画面不同。

`white-web-sdk@2.16.57` 中 CameraBound 的具体作用范围是：

- 调用 `setCameraBound()` 时，新边界可以立即修正当前本地 camera；
- 设备滚轮、触控和 hand tool camera 操作受 CameraBound 限制；
- 程序化 `moveCamera()` 和 `moveCameraToContain()` 不经过 CameraBound 夹取，因此
  `scalePptToFit()` 的正常 contain target 也不受 CameraBound 限制；
- CameraBound 不是高于所有 camera API 的全局约束层。共享 camera 意图由 camera API 决定，CameraBound
  只负责当前终端的本地约束和显示结果。

White SDK 对多次 `setCameraBound()` 使用有效值增量语义：

- 省略 `damping/centerX/centerY/width/height` 时保留现有几何边界；
- 省略 `maxContentMode/minContentMode` 时清除对应 scale 限制；
- WindowManager 需要保存合并后的 effective CameraBound，才能在 rebind 后恢复与旧 View 相同的本地边界。

业务主动调用 `manager.setCameraBound()` 或被接管的 `room.setCameraBound()` 时，通过 room logger 上报
边界几何字段、是否配置 min/max ContentMode、originSize 和当前本地 mainView size。resize、rebind
产生的内部重放不重复上报。

## 6. 生命周期行为

| 场景 | origin 模式要求 |
| --- | --- |
| attributes 为空 | 可写 Broadcaster 且传入 `originSize` 时原子初始化四字段；只读端和未传入时保持 legacy |
| legacy active pair + writable mount | 在创建 MainView 前按 mount `originSize` 原子初始化 origin pair、active pair |
| legacy active pair + readonly mount | 不写 attributes，继续 legacy |
| 已有 origin attributes 且 mount 值一致 | 读取 active pair 并转换到本地，不重置当前视角 |
| 已有 origin attributes 且 writable mount 值不同 | 在创建 MainView 前原子重建 origin pair、active pair |
| 已有 origin attributes 且 readonly mount 值不同 | 忽略本地 mount 值，继续消费房间 attributes |
| 获得可写权限 | attributes 已存在时不得用本地 View 覆盖 active pair |
| 切换 Broadcaster | 不调用 active-pair snapshot，只开始同步当前 attributes |
| scenePath 切换 | active pair 不变，切换后重放 |
| resize / 横竖屏 | 增加 layout revision，稳定后按 active pair 重算，不写 attributes |
| `setContainerSizeRatio()` | 只改变本地布局和 baseScale，不写 attributes |
| reconnect / rebind / refresh | 保留四字段，按新 View size 重放 active pair |
| 设备手势 | 若允许操作，使用当前 `mainViewSize` 将 local camera 归一化，只更新 `mainViewCamera` |
| mount contract 校验失败 | 回滚本次本地初始化和静态挂载状态；保留 SDK 管理的 InvisiblePlugin，修正配置后可重试 mount |
| layout 队列单项失败 | 该项按 no-op 处理，继承前一成功项的逻辑 camera/reference，后续项继续执行 |

origin contract 校验必须在创建 AppManager、CursorManager、DOM 容器和 room API 代理之前完成。同一进程的
mount 必须串行，已有成功实例或正在 mount 时，后续调用应在创建/取得其他 Room 的 InvisiblePlugin 之前
失败。contract 校验或提交 mount 前的初始化抛错时，WindowManager 只销毁本次 mount 创建的本地 logger、
observer 和 manager 子组件并恢复静态状态；不能调用 InvisiblePlugin 的公开 `destroy()`，因为该 API 会把
房间内所有端的同类插件一起销毁。

writable mount 重建发生在 MainView 构造前。`safeSetAttributes()` 的原子写入既同步给远端，也让随后创建的
MainView 直接读取新的 `mainViewSize/mainViewCamera`；本地 View camera scale 按新 reference size 换算。

resize/ratio 期间积压的 camera operation 按顺序重放。任一 operation 抛错时，它不应把逻辑状态回退到
整批操作开始前的 base camera，而应继承前一个成功 operation 的 camera 和 reference size。这样后续
partial `moveCamera()` 仍以最近成功结果为基准；失败项本身不产生额外 attributes 写入。

业务仍建议设置：

```ts
manager.mainView.disableCameraTransform = true
```

从而只允许公开 API 产生共享 camera 意图。

## 7. 内部方法拆分

现有 `setCameraAndSize()` 同时被初始化、Broadcaster、move API 和 `scalePptToFit()` 复用，无法表达不同
业务语义。origin 模式应拆分为：

```text
initializeOriginPair()          初始化固定 pair 和 active pair
publishMainViewCamera()         只更新 active camera
replaceMainViewCameraAndSize()  原子替换 active pair
restoreOriginPair()             将 active pair 恢复为 origin pair
```

legacy 模式继续保留现有 `setCameraAndSize()` 行为，避免影响未配置 originSize 的房间。

## 8. 兼容与模式判定

系统保留 originSize 和 legacy 两种模式，模式只由 `attributes.originSize` 是否存在决定：

- 存在 `attributes.originSize`：使用 origin pair 和 active pair 的换算规则；
- 不存在 `attributes.originSize`：完整保留旧的 `mainViewSize/mainViewCamera` 行为。

`mount({ originSize })` 只在初始化阶段作为 candidate：

- 可写端可以在 attributes 没有 originSize 时初始化四字段；
- 可写端可以在已有 originSize 且数值不同的时候原子重建 origin pair 和 active pair；
- 只读端不能写入，attributes 没有 originSize 时继续 legacy，已有 originSize 时忽略本地不一致 candidate；
- candidate 与 attributes.originSize 数值一致时不重置 active pair；
- mount 完成后不再保存或校验 candidate，后续只消费 attributes。

`_mainViewCameraCoordinateVersion` 不属于当前契约，删除其字段、常量、读写和迁移逻辑。`originCamera` 仍
保持固定 `{ centerX: 0, centerY: 0, scale: 1 }`，用于 `fitOriginSizeAndCamera()` 恢复 active pair。

## 9. 测试要求

### 9.1 数据与换算

- 初始化原子写入四字段，字段 `id` 使用当前 `room.uid`；
- writable legacy mount 将 active pair 重置为 mount `originSize` 和默认 origin camera；
- legacy mount 的初始化在 MainView 创建前完成，本地 camera 直接按新 origin 基准初始化；
- readonly legacy mount 不写 attributes，保持 legacy；
- writable mount 的 originSize 与已有 attributes 不一致时原子重置四个字段；
- 重置后的 MainView 以逻辑 scale `1` 和新 reference size 计算本地 View scale；
- readonly mount 的 originSize 与 attributes 不一致时忽略 candidate，继续消费房间状态；
- active `mainViewSize` 与 originSize 不同时，换算使用 active size；
- active/local 正反换算在同一 revision 内可逆；
- 零尺寸、NaN、Infinity 和浮点边界；
- partial attributes 被识别为配置错误。

### 9.2 API

- `moveCamera()` 只更新 mainViewCamera；
- `moveCameraToContain()` 基于 active mainViewSize 计算；
- `scalePptToFit()` 等待最终 camera 稳定并原子替换 active pair；
- 非 PPT scene 调用 `scalePptToFit()` 时不写 attributes；
- resize 期间调用 `scalePptToFit()` 时保留 contain，布局稳定后再执行和提交；
- contain operation 提前清理后，partial camera API、resize 与 rebind 仍使用待提交 camera；
- active-pair capture 期间的后续 camera API 不产生延迟的 camera-only 覆盖；
- 连续多次 `scalePptToFit()` 只有最后一次提交；
- PPT fit 延迟提交期间调用 `setCameraBound()` 不改变待提交的 active pair；
- `fitOriginSizeAndCamera()` 原子恢复 active pair；
- `setCameraBound()` 不写任何 attributes；
- CameraBound 连续 partial update 与 rebind 保持 White SDK 的 effective bound 语义；
- resize 与 `setContainerSizeRatio()` 不写任何 attributes；
- originSize 模式的 camera reaction 只比较 `mainViewCamera/mainViewSize` 标量快照；更新任意 App storage 不触发 MainView camera 响应或 `mainViewState` 日志，真实 camera 或 size 变化仍正常触发；
- layout operation 中间失败时，前序成功 camera 不回退，后续 partial operation 继续基于它计算；
- layout base camera 重放异常时仍继续处理队列并建立提交 timer；
- origin contract 校验失败时不残留本地挂载资源、`isCreated` 或静态 mount 参数，且不广播销毁 InvisiblePlugin；
- 重复或并发 mount 在取得其他 Room 的 InvisiblePlugin 前失败，不污染已挂载实例的静态状态。

### 9.3 多端与兼容

- 只读端先加入、老师后加入；
- 多端 originSize 相同、本地 View 尺寸与宽高比不同；
- writable mount 重置后远端收到完整的新 origin/active contract；
- Slide、Presentation 的 `addApp` originSize 和 View camera 不受 mainView mount 重置影响；
- scalePptToFit 后各端消费相同 active pair；
- fitOrigin 后恢复相同 origin 视口；
- 横竖屏快速切换期间 API 排队，不发布混合 revision；
- scenePath 切换、重连与 rebind 后 active pair 不漂移；
- 未配置 originSize 的完整 legacy 回归。

## 10. 已确认结论

| 决策 | 结论 |
| --- | --- |
| originSize 配置入口 | 只能通过 `WindowManager.mount()` |
| originSize 多端约束 | 正常运行时四端必须完全一致；受控升级由最后一次 writable mount 原子重建 |
| originCamera | 固定 `{ centerX: 0, centerY: 0, scale: 1 }` |
| origin pair 是否可变 | manager 生命周期内不可变；新的 writable mount 可连同 active pair 一次性重建 |
| active pair | `mainViewSize/mainViewCamera`，用于实际同步和本地换算 |
| 旧房间首次启用 originSize | writable mount 原子初始化四字段并重置 active pair；readonly mount 保持 legacy |
| 已有 originSize 房间重置 | writable mount 原子重置四字段；readonly mismatch 忽略本地 candidate |
| `scalePptToFit()` | 优先于 origin，原子替换 active pair |
| `fitOriginSizeAndCamera()` | 客户显式调用时才将 active pair 恢复为 origin pair |
| resize / ratio | 只影响本地换算，不写 attributes |
| CameraBound | 仅影响当前本地 View；PPT 延迟提交也不得采集其修改后的本地 camera |
| 未配置 originSize | 保持完整 legacy 行为 |
| Slide / Presentation | 继续由 `addApp` attributes 配置，不跟随 mainView mount 重置 |
