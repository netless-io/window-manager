# Develop custom APP

-   [AppContext](./app-context.md)

## official apps https://github.com/netless-io/netless-app

## app-with-whiteboard

If you need to mount a whiteboard in the app, please refer to [board.tsx](https://github.com/netless-io/window-manager/blob/master/example/app/board.tsx)

<br>

```ts
import type { NetlessApp, AppContext } from "@netless/window-manager";

const HelloWorld: NetlessApp = {
    kind: "Hello World",
    setup: (context: AppContext) => {
        context.mountView(context.getBox().$content); // optional: mount the View to the box
    },
};

WindowManager.register({
    kind: HelloWorld.kind,
    src: HelloWorld,
});

manager.addApp({
    kind: "Hello World",
    options: {
        scenePath: "/hello-world", // If you need to use the whiteboard in the app, you must declare scenePath
    },
});
```

## Counter

```ts
const Counter: NetlessApp<{ count: number }> = {
    kind: "Counter",
    setup: context => {
        const storage = context.storage;
        storage.ensureState({ count: 0 });

        const box = context.getBox(); // box is the window opened for this application
        const $content = box.$content; // Get the content of the window

        const countDom = document.createElement("div");
        countDom.innerText = storage.state.count.toString();
        $content.appendChild(countDom);

        // Listen for state change callbacks
        storage.addStateChangedListener(diff => {
            if (diff.count) {
                // diff will give newValue and oldValue
                console.log(diff.count.newValue);
                console.log(diff.count.oldValue);
                countDom.innerText = diff.count.newValue.toString();
            }
        });

        const incButton = document.createElement("button");
        incButton.innerText = "Inc";
        const incButtonOnClick = () => {
            storage.setState({ count: storage.state.count + 1 });
        };
        incButton.addEventListener("click", incButtonOnClick);
        $content.appendChild(incButton);

        const decButton = document.createElement("button");
        decButton.innerText = "Dec";
        const decButtonOnClick = () => {
            storage.setState({ count: storage.state.count - 1 });
        };
        decButton.addEventListener("click", decButtonOnClick);
        $content.appendChild(decButton);

        // listen for events
        const event1Disposer = context.addMagixEventListener("event1", msg => {
            console.log("event1", msg);
        });

        // Send a message to other people who have the app open
        context.dispatchMagixEvent("event1", { count: 10 });

        // When the application is destroyed, pay attention to clean up the listener
        context.emitter.on("destroy", () => {
            incButton.removeEventListener("click", incButtonOnClick);
            decButton.removeEventListener("click", decButtonOnClick);
            event1Disposer();
        });
    },
};
```
