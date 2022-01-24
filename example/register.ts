import type { AppContext, WindowManager as WindowManagerType } from "../dist";
import { WindowManager } from "../dist/index.es";

WindowManager.register({
    kind: "Slide",
    appOptions: {
        // turn on to show debug controller
        debug: false,
    },
    src: (async () => {
        const app = await import("@netless/app-slide");
        return app.default ?? app;
    }) as any,
});

interface HelloWorldAttributes {
    a?: number;
    b?: { c: number };
}
interface HelloWorldMagixEventPayloads {
    event1: {
        count: number;
    };
    event2: {
        disabled: boolean;
    };
}

const HelloWorldApp = async () => {
    console.log("start loading HelloWorld...");
    // await new Promise(resolve => setTimeout(resolve, 2000))
    console.log("HelloWorld Loaded");
    return {
        setup: (context: AppContext<HelloWorldAttributes, HelloWorldMagixEventPayloads, any>) => {
            // const state = context.createStorage<>("HelloWorldApp", { a: 1 });
            context.storage.onStateChanged.addListener(diff => {
                if (diff.a) {
                    console.log("diff", diff.a.newValue, diff.a.oldValue);
                }
                console.log("diff all", diff);
            });
            const c = { c: 3 };
            if (context.getIsWritable()) {
                context.storage.setState({ a: 2, b: c });
                context.storage.setState({ a: 2, b: c });
            }

            console.log("helloworld options", context.getAppOptions());

            context.addMagixEventListener("event1", message => {
                console.log("MagixEvent", message);
            });
            // context.dispatchMagixEvent("event1", { count: 1 });
            context.mountView(context.getBox().$content as any);
            context.emitter.on("destroy", () => console.log("[HelloWorld]: destroy"));
            setTimeout(() => {
                console.log(context.getAttributes());
            }, 1000);
            return "Hello World Result";
        },
    };
};

WindowManager.register({
    kind: "HelloWorld",
    src: HelloWorldApp as any,
    appOptions: () => "AppOptions",
    addHooks: emitter => {
        emitter.on("created", result => {
            console.log("HelloWordResult", result);
        });
        emitter.on("focus", result => {
            console.log("HelloWorld focus", result);
        });
    },
});
