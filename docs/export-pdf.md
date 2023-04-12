# Export PDF

This feature requires additional installation of the `jspdf` dependency to use

```
npm install jspdf@2.5.1
```

### Supported apps and versions

1. @netless/app-slide `0.2.23` and above support saving dynamic ppt board writing

2. @netless/app-docs-viewer `0.2.10` and above support saving pdf board writing, **Note** app-docs-viewer can show static ppt, pdf, dynamic ppt. Only pdf files support saving board writing

   Only pdf files can be saved in the app-docs-viewer, which is compatible with @netless/window-manager `0.4.50` and above.

3. white-web-sdk `2.16.37` and above

### Initiate a save board writing task

Launch the save board writing task with a `window.postMessage` event, and be careful not to repeat the event before the task is completed.

```js
window.postMessage({
    type: "@netless/_request_save_pdf_",
    appId: /* windowManager.addApp return value, specify which window to save the board writing, */
})
```

### Get task progress

Task progress is also passed through the message event, you need to listen to the task progress event before launching the task, the example code is shown below.
The data.result will only have a value if the task succeeds, and will be null if the task fails or is in progress.
**If the download task fails, then progress is 100 but result is null.**

```js
window.addEventListener("message", evt => {
    if (evt.data.type === "@netless/_result_save_pdf_") {
        console.log(evt.data);
        // data contains the following properties
        // data.type: fixed value "@netless/_result_save_pdf_"
        // data.appId: specifies which download task, same as the appId value passed when the board writing was saved
        // data.progress: progress of the download, 0 ~ 100
        // data.result: { pdf: ArrayBuffer {}, title: "a.pptx" } or null, the contents of the pdf file for the board writing.
        // value only when the download progresses to 100. After getting the ArrayBuffer you need to complete the logic of downloading to local.
    }
});
```
