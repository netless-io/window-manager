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
     - [`addPage`](#addPage)
     - [`removePage`](#removePage)
     - [`refresh`](#refresh)
     - [`setContainerSizeRatio`](#setContainerSizeRatio)
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
| containerSizeRatio     | [optional] number                       | 9 / 16  | The aspect ratio of the multi-window area, the default is 9 : 16        |
| chessboard             | [optional] boolean                      | true    | The space outside the multi-window area displays PS checkerboard background, default true |
| collectorContainer     | [optional] HTMLElement                  |         | dom for multi-window minimize icon mount            |
| collectorStyles        | [optional] Partial{CSSStyleDeclaration} |         | Configure collector style             |
| overwriteStyles        | [optional] string                       |         | The style to use for the overlay window                    |
| cursor                 | [optional] boolean                      | false   | Turn on cursor sync                       |
| disableCameraTransform | [optional] boolean                      |         | Disable camera movement for the main whiteboard                   |
| prefersColorScheme     | [optional] string                       | light   | auto, light, dark            |
| debug                  | [optional] boolean                      | false   | print log information   |
| applianceIcons         | [optional] {ApplianceNames, string}     |         | Configure the teaching aid picture used by the cursor           |


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

<h3 id="closeApp">closeApp</h3>

> Close any open `APP`

```typescript
manager.closeApp(appId)
```

<h3 id="focusApp">focusApp</h3>

> Switch the `app` of the current `focus`, and set this `app` to the front

```typescript
manager.focusApp(appId)
```

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
