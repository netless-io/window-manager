# 开发自定义 APP

- [AppContext](./app-context.md)

## official apps https://github.com/netless-io/netless-app

## app-with-whiteboard

如果需要 app 中挂载白板请参考 [board.tsx](https://github.com/netless-io/window-manager/blob/master/example/app/board.tsx)

<br>

```ts
import type { NetlessApp, AppContext } from "@netless/window-manager";

const HelloWorld: NetlessApp = {
    kind: "HelloWorld",
    setup: (context: AppContext) => {
        context.mountView(context.getBox().$content); // 可选: 挂载 View 到 box 上
    },
};

WindowManager.register({
    kind: HelloWorld.kind,
    src: HelloWorld,
});

manager.addApp({
    kind: "HelloWorld",
    options: {
        scenePath: "/hello-world", // 如果需要在 App 中使用白板则必须声明 scenePath
    },
});
```

## Counter

```ts
const Counter: NetlessApp<{ count: number }> = {
    kind: "Counter",
    setup: (context) => {
        const storage = context.storage;
        storage.ensureState({ count: 0 });

        const box = context.getBox(); // box 为这个应用打开的窗口
        const $content = box.$content // 获取窗口的 content

        const countDom = document.createElement("div");
        countDom.innerText = storage.state.count.toString();
        $content.appendChild(countDom);

        // 监听 state 变化回调
        storage.addStateChangedListener(diff => {
            if (diff.count) {
                // diff 会给出 newValue 和 oldValue
                console.log(diff.count.newValue);
                console.log(diff.count.oldValue);
                countDom.innerText = diff.count.newValue.toString();
            }
        });

        const incButton = document.createElement("button");
        incButton.innerText = "Inc";
        const incButtonOnClick = () => {
            storage.setState({ count: storage.state.count + 1 });
        }
        incButton.addEventListener("click", incButtonOnClick);
        $content.appendChild(incButton);

        const decButton = document.createElement("button");
        decButton.innerText = "Dec";
        const decButtonOnClick = () => {
            storage.setState({ count: storage.state.count - 1 });
        }
        decButton.addEventListener("click", decButtonOnClick);
        $content.appendChild(decButton);

            // 监听事件
        const event1Disposer = context.addMagixEventListener("event1", msg => {
            console.log("event1", msg);
        });

        // 向打开 app 的其他人发送消息
        context.dispatchMagixEvent("event1", { count: 10 });

        // 应用销毁时, 注意清理掉监听器
        context.emitter.on("destroy", () => {
            incButton.removeEventListener("click", incButtonOnClick);
            decButton.removeEventListener("click", decButtonOnClick);
            event1Disposer();
        });
    }
}
```