# `boxSizeChange` 接入指南

本文面向 Netless App（特别是 `@netless/app-slide`）维护者，说明如何使用
WindowManager 提供的 `boxSizeChange` 事件同步 App 内部渲染器尺寸。

## 适用场景

部分旧 Android WebView 虽然提供 `ResizeObserver` API，但在 CSS transition 或连续布局变化时，
回调可能只包含中间尺寸。此时 Box DOM 已经达到最终尺寸，App 内部渲染器仍可能保留错误的宽高。

WindowManager 会在 Box 布局稳定后读取 App 内容 DOM 的实际尺寸，并通过
`context.emitter` 发送 `boxSizeChange`。App 应使用该事件更新自己的 viewer、canvas 或 viewport，
不再以 App 内部的 `ResizeObserver` 作为最终尺寸的唯一来源。

## API

```ts
type BoxSizeChangePayload = {
    appId: string;
    width: number;
    height: number;
};

context.emitter.on(
    "boxSizeChange",
    (payload: BoxSizeChangePayload) => void | Promise<void>
): () => void;
```

字段说明：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `appId` | `string` | 当前 App 实例 ID，与 `context.appId` 相同 |
| `width` | `number` | App 实际内容 DOM 的宽度，单位为 CSS pixel |
| `height` | `number` | App 实际内容 DOM 的高度，单位为 CSS pixel |

`width` 和 `height` 均为大于 0 的有限数值。它们不是 TeleBox 的相对模型尺寸，
也不是包含标题栏和边框的整个窗口尺寸。

## 触发时机

以下变化完成后可能触发事件：

- App setup 或 View mount；
- Box resize 或最小尺寸约束改变；
- 最大化、最小化、恢复和 Box 状态切换；
- WindowManager 容器尺寸变化；
- TeleBox 的实际视觉尺寸变化。

事件采用 trailing debounce，不是逐帧 resize 事件。当前实现会在最后一次触发后等待 650ms，
再通过两次间隔 100ms 的 DOM 采样确认尺寸。相同尺寸在 0.5px 容差内不会重复通知。

因此，App 不应依赖该事件实现拖拽过程中的逐帧动画，只应把它作为最终布局尺寸的同步信号。

## app-slide 接入示例

建议在 `setup(context)` 开始阶段立即注册监听。Slide viewer 可能异步创建，事件到达时如果 viewer
尚未就绪，应缓存最后一次尺寸，并在 viewer 创建完成后应用。

```ts
type BoxSize = { width: number; height: number };

export async function setup(context: AppContext): Promise<void> {
    let viewer: SlideViewer | undefined;
    let latestBoxSize: BoxSize | undefined;

    const applyBoxSize = (size: BoxSize): void => {
        latestBoxSize = size;
        if (!viewer) return;

        // 替换为 app-slide 当前 viewer 的实际尺寸更新 API。
        viewer.resize(size.width, size.height);
    };

    const offBoxSizeChange = context.emitter.on(
        "boxSizeChange",
        ({ appId, width, height }) => {
            if (appId !== context.appId) return;
            applyBoxSize({ width, height });
        }
    );

    const offDestroy = context.emitter.on("destroy", () => {
        offBoxSizeChange();
        offDestroy();
    });

    viewer = await createSlideViewer(context);

    if (latestBoxSize) {
        applyBoxSize(latestBoxSize);
    }
}
```

如果 viewer 的尺寸 API 接收容器而不是数值，应在事件回调中调用对应的 layout/resize 方法，
但尺寸来源仍应以事件的 `width`、`height` 为准。

## 与 white-web-sdk View 的关系

WindowManager 在发送事件前会同步 App 对应的 white-web-sdk `View.size`：

```text
App 内容 DOM 最终尺寸
        |
        +--> white-web-sdk View.refreshSize(width, height)
        |
        +--> context.emitter: boxSizeChange
                    |
                    +--> app-slide viewer.resize(width, height)
```

App 不需要调用 white-web-sdk 的 `View.refreshSize()`。该步骤由 WindowManager 负责；App 只需要
更新自身的 Slide viewer。两者解决的是不同层级的内部尺寸状态。

## 接入注意事项

1. 不要使用 `intrinsicWidth`、`intrinsicHeight` 替代事件尺寸。它们是相对 BoxManager 容器的模型值。
2. 不要在事件回调中再次修改 Box 宽高，否则可能形成“通知 -> 改 Box -> 再通知”的循环。
3. viewer 初始化期间只保留最新尺寸，不需要排队执行所有历史尺寸。
4. resize 操作应保持幂等；同一尺寸重复应用不应改变页面状态或课件同步状态。
5. 不要把本地像素尺寸写入协作 attributes。不同客户端的容器尺寸可能不同，该尺寸仅用于本地布局。
6. 监听器如果执行异步操作，应自行捕获业务异常。WindowManager 会记录监听器 rejection，
   但无法替 App 恢复失败的 viewer 状态。

## 验收建议

至少覆盖以下场景：

- App 首次打开后，viewer 尺寸与内容 DOM 一致；
- 普通 Box resize 后，viewer 最终使用事件中的尺寸；
- 最大化、恢复、最小化后恢复均能得到正确尺寸；
- WindowManager 容器横竖屏切换或宿主尺寸变化后能重新同步；
- viewer 晚于首次事件创建时，缓存的最后尺寸会被应用；
- 连续收到相同尺寸时不会重复重建 viewer 或重置课件状态；
- Android 8.1 / WebView 71 中 PPT 最终铺满 App 内容区域；
- Room 与 Player、可写与只读模式下均不会因尺寸事件产生协作状态写入。

## 版本要求

接入方需要使用包含 `boxSizeChange` 的 WindowManager 版本或构建产物。仅升级 app-slide 而仍使用
旧 WindowManager 时不会收到该事件。white-web-sdk 的强制 View 尺寸同步由 WindowManager 兼容层处理，
不影响 app-slide 的事件监听代码。
