# 导出 PDF

此功能需要额外安装 `jspdf` 依赖才能使用

```
npm install jspdf@2.5.1
```

### 支持的 app 及版本

1. @netless/app-slide  `0.2.23` 及以上版本支持保存动态 ppt 板书

2. @netless/app-docs-viewer  `0.2.10` 及以上版本支持保存 pdf 板书, **注意** app-docs-viewer 中可以展示静态 ppt, pdf, 动态 ppt. 其中只有 pdf 文件支持保存板书

   对应 @netless/window-manager `0.4.50` 及以上

3. white-web-sdk  `2.16.37` 及以上

### 发起保存板书任务

通过 `window.postMessage` 发事件来发起保存板书任务, 注意不要在任务尚未完成之前重复发送该事件.

```js
window.postMessage({
    type: "@netless/_request_save_pdf_",
    appId: /* windowManager.addApp 返回的值, 指定要保存哪个窗口的板书, */
})
```

### 获取任务进度

任务进度也通过 message 事件传递, 你需要在发起任务之前监听任务进度事件, 实例代码如下所示.
其中 data.result 只有在任务成功时候才有值, 任务失败或者任务进行中都为 null.
**如果下载任务失败, 则 progress 为 100 但是 result 为 null.**

```js
window.addEventListener("message", evt => {
    if (evt.data.type === "@netless/_result_save_pdf_") {
        console.log(evt.data);
        // data 包含如下属性
        // data.type: 固定值 "@netless/_result_save_pdf_"
        // data.appId: 指明是哪次下载任务, 与发起保存板书时候传递的 appId 值一致
        // data.progress: 下载进度,  0 ~ 100
        // data.result: { pdf: ArrayBuffer {}, title: "a.pptx" } 或者 null, 为板书的 pdf 文件内容,
        //              仅当下载进度 100 时才有值. 获取到 ArrayBuffer 后需要自行完成下载到本地的逻辑.
    }
});
```
