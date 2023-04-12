## AppContext

`AppContext` is the context passed in when the plugin runs.
You can operate the ui of the APP through this object, get the status of the current room, and subscribe to the status change.

- [API](#api)
     - [View](#view)
     - [Page](#page)
     - [Storage](#storage)
- [UI (box)](#box)
- [Events](#events)
- [Advanced](#Advanced)

<h2 id="api">API</h2>

- **context.appId**

     Unique ID generated when inserting `app`

     ```ts
     const appId = context.appId;
     ```

- **context.isReplay**
    
     Type: `boolean`
    
     Whether the current playback mode

- **context.getDisplayer()**

     By default `Displayer` is the `room` instance of the whiteboard

     A `Player` instance during playback

     ```ts
     const displayer = context.getDisplayer();

     assert(displayer, room); // interactive room
     assert(displayer, player); // playback room
     ```


- **context.getIsWritable()**

     Get whether the current state is writable\
     You can get the change of writable state by listening to `writableChange` event

     ```ts
     const isWritable = context.getIsWritable();
     ```

- **context.getBox()**

     Get the box of the current app

     ```ts
     const box = context.getBox();

     box.$content; // main element of the box
     box.$footer;
     ```

<h3 id="view">Mount whiteboard</h3>

When the application wants a whiteboard that can be drawn on, the following interface can be used

- **context.mountView()**

     Mount the whiteboard to the specified dom

     ```ts
     context.mountView(element);
     ```

**Note** When calling `addApp` of `manager`, you must fill in `scenePath` to use `view`
```ts
manager.addApp({
     kind: "xxx",
     options: { // optional configuration
         scenePath: "/example-path"
     }
})
```

<h3 id="page">Page</h3>

The whiteboard has the concept of multiple pages, which can be added, switched, and deleted through the following interfaces

- **context.addPage()**

     Add a page to `view`

     ```ts
     context.addPage() // add a page at the end by default
     context.addPage({ after: true }) // add a page after the current page
     context.addPage({ scene: { name: "page2" } }) // pass in page information
     ```

- **context.nextPage()**

     previous page

     ```ts
     context.nextPage();
     ```

- **context.prevPage()**

     next page

     ```ts
     context.prevPage();
     ```
- **context.removePage()**

     delete a page

     ```ts
     context.removePage() // delete the current page by default
     context.removePage(1) // You can also specify index to delete
     ```

- **context.pageState**

     Get the current `index` and how many pages there are\
     When you want to monitor the change of `pageState`, you can listen to the `pageStateChange` event to get the latest `pageState`

     ```ts
     context.pageState;
     // {
     //    index: number,
     //    length: number,
     // }
     ```

<h3 id="storage">storage</h3>

Store and synchronize state, and send a collection of events

- **context.storage**

     Storage instance created by default

     ```ts
     context.storage
     ```

- **context.createStorage(namespace)**

     At the same time you can also create multiple `storage` instances
    
     Returns: `Storage<State>`

     ```ts
     type State = { count: number };
     const defaultState = { count: 0 };
     const storage = context.createStorage<State>("store1", defaultState);
     ```

- **storage.state**

   Type: `State`\
   Default: `defaultState`

   State synchronized between all clients, call `storage.setState()` to change it.

- **storage.ensureState(partialState)**

   Make sure `storage.state` contains some initial values, something like doing:

   ```js
   // This code cannot be run directly because app.state is read-only
   storage.state = { ...partialState, ...storage.state };
   ```

   **partialState**

   Type: `Partial<State>`

   ```js
   storage.state; // { a: 1 }
   storage.ensureState({ a: 0, b: 0 });
   storage.state; // { a: 1, b: 0 }
   ```

- **storage.setState(partialState)**

   Similar to React's `setState`, update `storage.state` and sync to all clients.

   When setting a field to `undefined`, it will be removed from `storage.state`.

   > The time required for state synchronization and the network state are related to the data size. It is recommended to only store necessary data in the state.

   **partialState**

   Type: `Partial<State>`

   ```js
   storage.state; //=> { count: 0, a: 1 }
   storage.setState({ count: storage.state.count + 1, b: 2 });
   storage.state; //=> { count: 1, a: 1, b: 2 }
   ```

- **storage.addStateChangedListener(listener)**

   It fires after someone calls `storage.setState()` (including the current `storage`)

   return: `() => void`

   ```js
   const disposer = storage.addStateChangedListener(diff => {
     console.log("state changed", diff.oldValue, diff.newValue);
     disposer(); // remove listener by calling disposer
   });
   ```

- **context.dispatchMagixEvent(event, payload)**

   Broadcast event messages to other clients

   ```js
   context.dispatchMagixEvent("click", { data: "data" });
   ```

- **context.addMagixEventListener(event, listener)**

   It is triggered when receiving messages from other clients (when other clients call `context.dispatchMagixEvent()`)

   Returns: `() => void` a disposer function.

   ```js
   const disposer = context.addMagixEventListener("click", ({ payload }) => {
     console.log(payload.data);
     disposer();
   });

   context.dispatchMagixEvent("click", { data: "data" });
   ```

<h2>UI (box)</h2>

Box is the default UI created by whiteboard for all apps.
All operable UI parts of the application are within the bounds of the box.

- **context.getBox()**

     get box
     Return type: `ReadonlyTeleBox`

- **box.mountStyles()**

     Mount styles to `box`
     Parameters: `string | HTMLStyleElement`

     ```js
     const box = context. getBox();
     box. mountStyles(`
         .app-span {
             color: red;
         }
     `)
     ```

- **box.mountContent()**

     Mount element to `box`
     Parameters: `HTMLElement`

     ```js
     const box = context. getBox();
     const content = document. createElement("div");
     box. mountContent(context);
     ```

- **box.mountFooter()**

     Mount element to `footer` of `box`
     Parameters: `HTMLElement`

     ```js
     const box = context. getBox();
     const footer = document. createElement("div");
     box. mountFooter(context);
     ```

<h2 id="events">events</h2>

- **destroy**

     Sent when the app is closed

     ```ts
     context.emitter.on("destroy", () => {
         // release your listeners
     });
     ```

- **writableChange**

     Triggered when the whiteboard's writable state is switched

     ```ts
     context.emitter.on("writableChange", isWritable => {
         //
     });
     ```

- **focus**

     Triggered when the current app gains or loses focus

     ```ts
     context.emitter.on("focus", focus => {
         //
     });
     ```

- **pageStateChange**

     `PageState`

     ```ts
     type PateState {
         index: number;
         length: number;
     }
     ```

     Triggered when the current page number and the total page number change

     ```ts
     context.emitter.on("pageStateChange", pageState => {
         // { index: 0, length: 1 }
     });
     ```
- **roomStageChange**

     Triggered when the state of the room changes\
     For example, when teaching aids are switched

     ```js
     context.emitter.on("roomStageChange", stage => {
         if (state. memberState) {
             console.log("appliance change to", state.memberState.currentApplianceName);
         }
     });
     ```

     or when the number of people in the current room changes

     ```js
      context.emitter.on("roomStageChange", stage => {
         if (state. roomMembers) {
             console.log("current room members change", state.roomMembers);
         }
     });
     ```
     For detailed status introduction, please refer to https://developer.netless.link/javascript-zh/home/business-state-management

<h2 id="Advanced">Advanced</h2>

- **context.getView()**

     Get `view` instance

     ```ts
     const view = context.getView();
     ```
