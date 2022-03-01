# 开发自定义 APP

## official apps https://github.com/netless-io/netless-app

<br>

```ts
import type { NetlessApp, AppContext } from "@netless/window-manager";

const HelloWorld: NetlessApp = {
    kind: "HelloWorld",
    setup: (context: AppContext) => {
        context.mountView(context.getBox().$content); // 可选: 挂载 View 到 box 上

        const storage = context.createStorage<{ a: number }>("HelloWorld", { a: 1 });
        console.log(storage.state === { a: 1 });

        storage.addStateChangedListener(diff => {
            if (diff.a) {
                console.log(diff.a.oldValue === 1);
                console.log(diff.a.newValue === 2);
            }
        });

        if (context.getIsWritable()) {
            // 只有在可写状态才可以调用 setState
            storage.setState({ a: 2 });
        }

        // magixEvent 事件是房间内范围的, 建议 app 内使用需要添加自己的 prefix
        context.addMagixEventListener(`${context.appId}_event1`, message => {
            console.log("MagixEvent", message);
        });

        context.dispatchMagixEvent(`${context.appId}_event1`, { count: 1 });
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
