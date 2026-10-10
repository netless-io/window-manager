# Room 动态配置

从 `@netless/window-manager@1.0.24` 起，实时房间挂载时会读取 `white-web-sdk@2.16.59` 提供的 `room.dynamicConfig.windowManager`。

```ts
const sdk = new WhiteWebSdk({
    appIdentifier,
    useMobXState: true,
    dynamicConfig: {
        "cn-hz": "https://your-config-host/web/latest.json",
        sg: "https://your-config-host-sg/web/latest.json",
    },
});
const room = await sdk.joinRoom({
    uuid,
    roomToken,
    region: "cn-hz",
    invisiblePlugins: [WindowManager],
    useMultiViews: true,
});
const manager = await WindowManager.mount({ room, container });
```

SDK 按本次入房的 region 选取地址、下载和求值。客户应提供当前平台的配置地址；未配置的 region、平台不匹配或下载失败时不启用动态配置。配置缺失和回放保持原 mount 参数流程。WindowManager 本身不访问 OSS。

本地显式 mount 参数优先于动态配置；Bridge/Fastboard 提供参数来源标记时，其内置默认值低于动态配置。普通嵌套对象按子字段合并，数组与运行时实例整体替换，`undefined` 表示继承。`room`、`container` 和 `collectorContainer` 始终由本地调用者提供。

例如远端 `pageScaleRange.maxScale=4`，本地显式传入 `pageScaleRange.maxScale=2` 时采用 2；本地省略该字段时采用 4。只希望由后台管理的字段，应在本地 mount 参数中省略。

Room 上的动态配置是本次入房的只读快照，下次重新入房才读取最新配置。合并后仍执行原 API 参数校验。`originSize`、`forceMaximized` 等配置可能影响房间共享状态，发布回退不会自动撤销已写入的共享状态。

`[dynamicConfig]` 日志的 `consumer: "windowManager"` / `localOverrides` 表示哪些远端字段被本地显式参数覆盖，不输出配置值或 OSS 凭证。
