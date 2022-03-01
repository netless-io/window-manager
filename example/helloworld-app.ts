import type { AppContext } from "../dist";
import { WindowManager } from "../dist/index.es";

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

export const HelloWorldApp = async () => {
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
            context.dispatchMagixEvent("event1", { count: 1 });
            context.mountView(context.getBox().$content);
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