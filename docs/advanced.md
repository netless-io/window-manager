## Advanced usage

- Table of contents
   - [Undo Redo](#redo-undo)
   - [clean screen](#clean-current-scene)
   - [Judging whether to open a certain APP](#has-kind)
   - [page controller](#page-control)
   - [viewpoint](#view-mode)
   - [Insert image to current app](#insert-image-to-app)


<h3 id="redo-undo">Undo redo</h3>

> The following events and properties will automatically switch application objects according to the `focus` window

#### Get the number of steps that can be undone/redoed

```ts
manager.canUndoSteps
manager.canRedoSteps
```

#### Monitor changes in the number of steps that can be undone/redoed

`canRedoStepsChange` and `canUndoStepsChange` will retrigger when switching windows

```ts
manager.emitter.on("canUndoStepsChange", (steps: number) => {
     // undoable steps update
})
manager.emitter.on("canRedoStepsChange", (steps: number) => {
     // Update the number of steps that can be redone
})
```

#### Undo/Redo

```ts
manager.undo() // undo
manager.redo() // redo
```

<br>

<h3 id="clean-current-scene">Clear screen</h3>

Because there are multiple whiteboards in multi-window mode, if you want to clear the current `focus` whiteboard, you only need to call

```ts
manager.cleanCurrentScene()
```

If you only want to clean up the handwriting on the main whiteboard, you need

```ts
manager.mainView.cleanCurrentScene()
```


<br>

<h3 id="has-kind">Determine whether to open a certain APP</h3>

```ts
manager.emitter.on("ready", () => { // ready event is triggered after all app creation is complete
     const apps = manager.queryAll(); // Get all opened apps
     const hasSlide = apps.some(app => app.kind === "Slide"); // Determine whether there is Slide in the opened APP
});
```

<br>

<h3 id="page-control">page controller</h3>

`manager` provides a `pageState` to get the current index and the total number of pages

```ts
manager.pageState.index // current index
manager.pageState.length // total number of pages

manager.emitter.on("pageStateChange", state => {
     // This event will be triggered when the current index changes and the total number of pages changes
});
```

Previous/Next/Add a page

```ts
manager.nextPage()
manager.prevPage()
manager.addPage()
```

<br>

<h3 id="view-mode">View follow</h3>

`ViewMode` in multi-window has `broadcaster` `freedom` two modes

- `freedom`

     Free mode, users can freely zoom and move the viewing angle

     Even if there is an anchor in the room, the anchor cannot affect the user's perspective

- `broadcaster`

     Host mode, other people's perspectives will follow me during operation

     At the same time, other people in `broadcaster` mode will also affect my perspective

     When `isWritable` is `false`, it will only follow other `broadcaster` perspectives

<br>

<h3 id="insert-image-to-app">Insert an image into the current app</h3>

```ts
// Determine whether the current is maximized
if (manager.boxState === "maximized") {
     // The value of `focused` will vary depending on the currently focused app
     const app = manager.queryOne(manager. focused)
     // Only apps with a view can insert pictures, apps like video and audio do not have a view
     if (app.view) {
         var imageInformation = {
             uuid: uuid,
             centerX: centerX,
             centerY: centerY,
             width: width,
             height: height,
             locked: false,
         };
         app.view.insertImage(imageInformation);
         app.view.completeImageUpload(uuid, src);
     }
}
```
