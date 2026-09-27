# API

## Table of contents
   - [Static methods](#static-methods)
     - [`mount`](#mount)
     - [`register`](#register)
     - [`registered`](#registered)
     - [`setContainer`](#set-container)
     - [`setCollectorContainer`](#set-collector-container)
   - [instance methods](#instance-methods)
     - [`addApp`](#addApp)
     - [`closeApp`](#closeApp)
     - [`focusApp`](#focusApp)
     - [`setMainViewSceneIndex`](#setMainViewSceneIndex)
     - [`setBoxState`](#setBoxState)
     - [`cleanCurrentScene`](#cleanCurrentScene)
     - [`redo`](#redo)
     - [`undo`](#undo)
     - [`copy`](#copy)
     - [`paste`](#paste)
     - [`delete`](#delete)
     - [`duplicate`](#duplicate)
     - [`insertText`](#insertText)
     - [`insertImage`](#insertImage)
     - [`completeImageUpload`](#completeImageUpload)
     - [`lockImage`](#lockImage)
     - [`lockImages`](#lockImages)
     - [`nextPage`](#nextPage)
     - [`prevPage`](#prevPage)
     - [`dispatchDocsEvent`](#dispatchDocsEvent)
     - [`getPageState`](#getPageState)
     - [`addPage`](#addPage)
     - [`removePage`](#removePage)
     - [`refresh`](#refresh)
     - [`setContainerSizeRatio`](#setContainerSizeRatio)
     - [`fitOriginSizeAndCamera`](#fitOriginSizeAndCamera)
   - [instance properties](#prototypes)
   - [event callback](#events)

<br>

<h2 id="static-methods">Static methods</h2>

<h3 id="mount">WindowManager.mount</h3>

> mount WindowManager

```typescript
const manager = await WindowManager. mount(
     room: room,
     container: document. getElementById("container")
     // full configuration see below
);
```

parameter


| name                   | type                                    | default | desc                         |
| ---------------------- | --------------------------------------- | ------- | ---------------------------- |
| room                   | [require] Room                          |         | room instance                         |
| container              | [require] HTMLElement                   |         | room mount container                       |
| originSize             | [optional] Size                         |         | Fixed mainView origin size; it must match on every client in the room |
| pageScaleRange         | [optional] { minScale?: number; maxScale?: number } | | Optional relative scale range for `dispatchDocsEvent("scalePage")`; omitted bounds impose no business limit |
| containerSizeRatio     | [optional] number                       | 9 / 16  | The aspect ratio of the multi-window area, the default is 9 : 16        |
| chessboard             | [optional] boolean                      | true    | The space outside the multi-window area displays PS checkerboard background, default true |
| collectorContainer     | [optional] HTMLElement                  |         | dom for multi-window minimize icon mount            |
| collectorStyles        | [optional] Partial{CSSStyleDeclaration} |         | Configure collector style             |
| overwriteStyles        | [optional] string                       |         | The style to use for the overlay window                    |
| cursor                 | [optional] boolean                      | false   | Turn on cursor sync                       |
| disableCameraTransform | [optional] boolean                      |         | Disable camera movement for the main whiteboard                   |
| prefersColorScheme     | [optional] string                       | light   | auto, light, dark            |
| debug                  | [optional] boolean                      | false   | print log information   |

> When a legacy room only has a complete `mainViewSize/mainViewCamera` pair, the first writable
> mount with `originSize` atomically initializes the origin pair, active pair, and coordinate
> version. The legacy active pair is reset to the configured origin pair. A readonly mount is
> rejected until a writable client has established the complete version 2 contract. A matching
> existing version 2 contract keeps its current active pair; a different writable `originSize`
> resets both pairs. Slide and Presentation continue to use their independent addApp attributes.
| applianceIcons         | [optional] {ApplianceNames, string}     |         | Configure the teaching aid picture used by the cursor           |
| useBoxesStatus         | [optional] boolean                      | false   | Manage each window independently; while enabled, `forceMaximized` is ignored and App `forceTop`/`forceNormal` flags are effective |
| lazySetupInMaximizedMode | [optional] boolean                    | false   | Set up Apps on demand in a force-maximized room; effective lazy mode treats `useBoxesStatus` as false |
| maxCachedAppsInMaximizedMode | [optional] number                  | 4       | Lazy LRU target size, not a total runtime/memory limit. Initialized Slide runtimes survive eviction (freeze/unfreeze); Apps without `teardown()` remain alive and tracked and can exceed this soft limit. In-flight or yielded setups are not ready cache entries. |
| forceMaximized         | [optional] boolean                      | false   | Establish the room-wide force-maximized policy when writable; ignored and not written with `useBoxesStatus=true` |


<h3 id="register">WindowManager. register</h3>

> Register `APP` to `WindowManager`

```typescript
WindowManager. register({
    kind: "hello World",
    src: NetlessApp,
    appOptions: () => "appOptions",
    addHooks: (emitter) => {
        emitter.on("created", result => {
            console.log("HelloWordResult", result);
        });
        emitter.on("focus", result => {
            console.log("HelloWorld focus", result);
        })
        emitter.on("destroy", result => {
            console.log("HelloWorld destroy", result);
        })
    }
})
```

<br>

<h3 id="registered">WindowManager.registered</h3>

> Get the registered `App`

```ts
WindowManager.registered
```

<br>

<h3 id="set-container">setContainer</h3>

> Set whiteboard mount container

```typescript
WindowManager.setContainer(document.getElementById("container"));
```

<h3 id="set-container">setCollectorContainer</h3>

> Set container mounted by `Collector`

```typescript
WindowManager.setCollectorContainer(document.getElementById("collector-container"));
```

<br>

<h2 id="instance-methods">Instance methods</h2>

<h3 id="addApp">addApp</h3>

> add `app` to whiteboard

```typescript
const appId = await manager.addApp({
     kind: "hello World"
     options: { // optional configuration
         scenePath: "/hello-world"
     }
})
```
For specific parameters, please refer to the requirements of `APP` itself

`forceTop` and `forceNormal` are effective only when this WindowManager uses `useBoxesStatus=true`. Global-window and lazy modes preserve synchronized fields but do not apply them locally.

`addApp()` returns `Promise<string | undefined>`. It writes the App attributes and creates its Box first. If it remains the latest focus target, it waits for setup to settle and for room focus, Box focus, and zIndex to commit before returning the appId. Setup errors and timeouts are logged but do not change a successful return. A superseded request or an App added while minimized returns its created appId without waiting for setup. Creation or required focus commit failure returns `undefined`.

<h3 id="appContextCreateLogger">AppContext.createLogger</h3>

> Create an App-scoped Room/SLS logger. It is disposed with the App; error logs are
> immediate while high-frequency info logs can be debounced independently by event.
> The debounce delay defaults to 300ms and values below 300ms are clamped to 300ms.

```typescript
setup(context) {
    const logger = context.createLogger("camera", {
        debounceTime: 300,
        maxWaitTime: 2000,
    })

    logger.info("initialize", { camera: context.getView()?.camera })
    logger.debouncedInfo("moveCamera", { camera: context.getView()?.camera })

    try {
        // App operation
    } catch (error) {
        logger.error("operation.failed", error)
        throw error
    }
}
```

WindowManager internal logs and App logs use the same safe serialization, sensitive field
and URL query redaction, and message length limit. `error()` is never debounced. App
debounced info logs keep the 300ms default/minimum delay, while the WindowManager
`attributes` synchronization log uses a 500ms trailing debounce delay. Successful
`unifiedPageStateChange` diagnostics use a 300ms trailing debounce independently per target;
the event callback itself remains immediate.

<h3 id="closeApp">closeApp</h3>

> Close any open `APP`

```typescript
await manager.closeApp(appId)
```

When closing the focused App, the Promise waits for focus handoff to the remaining App with the highest zIndex. Closing a non-focused or pending App leaves the current focus unchanged. Closing the last App clears focus.

<h3 id="focusApp">focusApp</h3>

> Switch the `app` of the current `focus`, and set this `app` to the front

```typescript
const committed = await manager.focusApp(appId); // required string; Promise<boolean>
if (committed) await manager.dispatchDocsEvent("nextPage");
```

In lazy mode, `true` requires completed setup and focus resource transitions while visible and not minimized. A replaced request, failed setup/notification, suspended activation or the 10-second API deadline returns `false`; do not run dependent pagination after it. The deadline starts at the API call and does not cancel the pending target, which may still display later. Non-lazy focus keeps its synchronous behavior and immediately resolves `true` for an existing App.

Synchronized focus, API calls and TeleBox switches share one latest pending target. Hidden/minimized clients keep receiving targets but only process them after both gates reopen. An unfinished setup waits until completion or, with a different pending target, its original 10-second threshold; yielding cannot forcibly stop third-party work. Only an eligible user-origin TeleBox handoff can fallback; API/synchronized focus never chooses a replacement App.

Native completion wrappers must propagate `false` as failure (or throw) before pagination; no pagination appId is required. Two awaited calls do not form a transaction: another caller can change focus between them.

<h3 id="setMainViewSceneIndex">setMainViewSceneIndex</h3>

> Set the `SceneIndex` of the main whiteboard

```ts
manager.setMainViewSceneIndex(1)
```

<h3 id="setBoxState">setBoxState</h3>

> Set the current `boxState`

```ts
manager.setBoxState("normal") // boxState: normal | maximized | minimized
```

<h3 id="cleanCurrentScene">cleanCurrentScene</h3>

> Clear the handwriting of the currently focused view

```ts
manager.cleanCurrentScene()
```

<h3 id="redo">redo</h3>

> Redo the last operation on the currently focused view

```ts
manager.redo()
```

<h3 id="undo">undo</h3>

> Undo the last action on the currently focused view

```ts
manager.undo()
```

<h3 id="nextPage">nextPage</h3>

> Switch main whiteboard to next page

```ts
const success = await manager.nextPage()
if (!success) {
     // reached the last page
}
```

<h3 id="prevPage">prevPage</h3>

> Switch main whiteboard to previous page

```ts
const success = await manager.prevPage()
if (!success) {
     // have reached the first page
}
```

<h3 id="dispatchDocsEvent">dispatchDocsEvent</h3>

> Dispatch a unified page or scale command to mainView, DocsViewer, Slide, or Presentation.

```ts
const result = await manager.dispatchDocsEvent("nextPage", { target: appId })
await manager.dispatchDocsEvent("jumpToPage", { target: appId, page: 3 })
await manager.dispatchDocsEvent("scalePage", { target: "mainView", scale: 1.5 })
```

`target` can be `"mainView"` or a concrete appId. When omitted, WindowManager uses the focused
App and falls back to mainView. `page` is 1-based. `scale` is relative to fitted size, where `1`
means fitted size; mainView scaling is applied through `manager.moveCamera`. There is no default
business scale range. Configure `mount.pageScaleRange.minScale/maxScale` only when bounds are
required; out-of-range commands return `{ accepted: false, reason: "outOfRange", message }`
and are not clamped. DocsViewer does not support `scalePage` and returns
`{ accepted: false, reason: "eventNotSupported", message: "DocsViewer does not support scalePage" }`.

The returned `Promise<DispatchDocsEventResult>` reports whether the command was accepted and
includes a stable reason and readable message when rejected. Observe `unifiedPageStateChange`
for the actual page or relative scale after an accepted command.

<h3 id="getPageState">getPageState</h3>

> Read the current unified page state for mainView, DocsViewer, Slide, or Presentation.

```ts
const state = await manager.getPageState({ target: appId })
// { target, appId?, page, pageCount, scale? }
```

`page` is 1-based and `pageCount` is the actual number of pages. `scale` is present for
mainView, Slide, and Presentation and is relative to fitted size.

<h3 id="addPage">addPage</h3>

> Add a page to the main whiteboard

```ts
manager.addPage() // add a page at the end by default
manager.addPage({ after: true }) // add a page after the current page
manager.addPage({ scene: { name: "page2" } }) // pass in page information
```

<h3 id="removePage">removePage</h3>

> remove a page
> When there is only one page left, the last page is not allowed to be deleted

```ts
const success = await manager.removePage() // delete the current page by default
const success = await manager.removePage(1) // can delete the specified index
```

<h3 id="refresh">refresh</h3>

> Refreshes `manager` internal state for `copy` `attributes` from other rooms

```ts
manager.refresh()
```

<h3 id="setContainerSizeRatio">setContainerSizeRatio</h3>

> Set the aspect ratio of the whiteboard synchronization area

```ts
manager.setContainerSizeRatio(10 / 16)
```

<h3 id="fitOriginSizeAndCamera">fitOriginSizeAndCamera</h3>

> Restore the current synchronized mainView size and camera to the fixed baseline established by
> `mount({ originSize })`. This method has no effect when `originSize` is not configured.

```ts
manager.fitOriginSizeAndCamera()
```

<br>

<h2 id="prototypes">Instance attributes</h2>

| name               | type    | default | desc                   |
| ------------------ | ------- | ------- | -----------------      |
| mainView           | View    |         | main whiteboard                  |
| mainViewSceneIndex | number  |         | The SceneIndex of the current main whiteboard  |
| mainViewScenesLength | number |        | mainView's scenes length |
| boxState           | string  |         | current window status             |
| darkMode           | boolean |         | dark mode                 |
| prefersColorScheme | string  |         | color theme                 |
| focused            | string |          | focus app            |
| canRedoSteps       | number  |         | The number of steps that the currently focused view can redo |
| canRedoSteps       | number  |         | The number of steps that the currently focused view can undo |
| sceneState         | SceneState |      | Compatible with the sceneState property of the original SDK, only valid for mainView |
| pageState          | PageState |       | Combine the index and scenes modification of mainView |

<br>

<h2 id="events">event callback</h2>

```typescript
manager.emitter.on(events, listener)
```

| name                     | type           | default | desc                       |
| ------------------------ | -------------- | ------- | -------------------------- |
| mainViewModeChange       | ViewVisionMode |         |                            |
| mainViewSceneIndexChange | index: number  |         |                            |
| boxStateChange           | string         |         | normal,minimized,maximized |
| darkModeChange           | boolean        |         |                            |
| prefersColorSchemeChange | string         |         | auto,light,dark            |
| cameraStateChange        | CameraState    |         |                            |
| focusedChange            | string, undefined |     | The appId of the current focus, undefined for the main whiteboard  |
| mainViewScenesLengthChange | number      |         | fires when mainView scenes are added or removed |
| canRedoStepsChange       | number         |         | The view of the current focus can redo the number of steps to change |
| canUndoStepsChange       | number         |         | The current focus view can undo the step change |
| loadApp                  | LoadAppEvent   |         | Load remote APP event                |
| ready                    | undefined      |         | Triggered when all apps are created   |  
| sceneStateChange         | SceneState     |         | Fired when sceneState is modified     |
| pageStateChange          | PageState      |         |                            |
| unifiedPageStateChange   | UnifiedPageStateChange |   | Actual unified page or relative scale state for mainView, DocsViewer, Slide, or Presentation |
| fullscreenChange         | boolean        |         | Triggered when the full-screen status changes          ｜
| onAppSetup             | string      |         | Triggered when the app window is opened     |
| onBoxesStatusChange          | Map<string, TeleBoxState>|         | Triggered when window state changes, only fires when useBoxesStatus is configured     |

```ts
type LoadAppEvent = {
     kind: string;
     status: "start" | "success" | "failed";
     reason?: string;
}
```

```ts
type PageState = {
     index: number;
     length: number;
}
```

```ts
type UnifiedPageStateChange = {
    target: "mainView" | "DocsViewer" | "Slide" | "Presentation";
    appId?: string;
    page: number;
    pageCount: number;
    scale?: number;
    status: "pending" | "success" | "failure";
    changeType?: "page" | "scale";
    mainView?: number;
    presentation?: number;
    view?: number;
    slide?: number;
    event?: DocsEvent;
    reason?: "commandFailed";
    message?: string;
}
```

```ts
type TeleBoxState = `${TELE_BOX_STATE}`;
declare enum TELE_BOX_STATE {
    Normal = "normal",
    Minimized = "minimized",
    Maximized = "maximized"
}
```
