import React from "react";
import ReactDom from "react-dom";
import { PlayerPhase, WhiteWebSdk } from "white-web-sdk";
import type { AppContext } from "../dist";
import { BuiltinApps, WindowManager } from "../dist/index.es";
import type { WindowManager as WindowManagerType } from "../dist";
import { createDocs1, createDocs2, createHelloWorld, createVideo, createSlide } from "./apps";
import "../dist/style.css";
import "video.js/dist/video-js.css";

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

const anyWindow = window as any;

let firstPlay = false;

const replay = () => {
    sdk.replayRoom({
        room: process.env.ROOM_UUID,
        roomToken: process.env.ROOM_TOKEN,
        invisiblePlugins: [WindowManager as any],
        useMultiViews: true,
    }).then(async player => {
        await anyWindow.manager.destroy();
        anyWindow.room.disconnect();
        setTimeout(async () => {
            anyWindow.player = player;
            // player.bindHtmlElement(document.getElementById("container") as any)
            player.play();
        }, 500);
        player.callbacks.on("onPhaseChanged", phase => {
            if (phase === PlayerPhase.Playing) {
                if (firstPlay) return;
                setTimeout(() => {
                    mountManager(player, document.getElementById("container"));
                }, 1000);
                firstPlay = true;
            }
        });
    });
};

const onRef = ref => {
    const uid = Math.random().toString().substr(3, 8);
    sdk.joinRoom({
        uuid: process.env.ROOM_UUID,
        roomToken: process.env.ROOM_TOKEN,
        invisiblePlugins: [WindowManager as any],
        useMultiViews: true,
        userPayload: {
            userId: "111",
            cursorName: uid,
            avatar: "https://avatars.githubusercontent.com/u/8299540?s=60&v=4",
        },
        isWritable: !(isWritable === "false"),
        cursorAdapter: undefined,
        uid: uid,
        disableMagixEventDispatchLimit: true,
        disableNewPencil: false,
    }).then(async room => {
        if (room.isWritable) {
            // room.setMemberState({ strokeColor: [0, 0, 1] });
        }

        (window as any).room = room;
        await mountManager(room, ref);
    });
};

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

const sdk = new WhiteWebSdk({
    appIdentifier: process.env.APPID,
    useMobXState: true,
});

(window as any).WindowManager = WindowManager;
const search = window.location.search;
const url = new URLSearchParams(search);
const isWritable = url.get("isWritable");

const mountManager = async (room, root) => {
    const manager = (await WindowManager.mount({
        room,
        container: root,
        // collectorStyles: { bottom: "100px", left: "30px" },
        containerSizeRatio: 9 / 16,
        chessboard: true,
        debug: true,
        cursor: true,
    })) as WindowManagerType;

    console.log("manager mounted boxState:", manager.boxState);

    (window as any).manager = manager;
    (window as any).manager.onAppDestroy(BuiltinApps.DocsViewer, error => {
        console.log("onAppDestroy", error);
    });

    (window as any).manager.emitter.on("mainViewModeChange", mode => {
        console.log("mode", mode);
    });

    manager.emitter.on("boxStateChange", state => {
        console.log("boxStateChange:", state);
    });

    manager.emitter.on("mainViewSceneIndexChange", index => {
        console.log("mainViewSceneIndexChange", index);
    });
    manager.emitter.on("focusedChange", focus => {
        console.log("focusedChange", focus);
    });
};
const destroy = () => {
    anyWindow.manager.destroy();
    anyWindow.manager = undefined;
};

anyWindow.mountManager = mountManager;
anyWindow.destroy = destroy;

const prevPage = (manager: WindowManager) => {
    manager.setMainViewSceneIndex(manager.mainViewSceneIndex - 1).catch(console.log);
};

const nextPage = (manager: WindowManager) => {
    manager.setMainViewSceneIndex(manager.mainViewSceneIndex + 1).catch(console.log);
};

const App = () => {
    return (
        <div
            style={{
                display: "flex",
                width: "100vw",
                height: "100vh",
                padding: "16px 16px",
                overflow: "hidden",
                boxSizing: "border-box",
            }}
        >
            <div
                ref={onRef}
                id="container"
                style={{
                    flex: 1,
                    height: "calc(100vh - 32px)",
                    border: "1px solid",
                }}
            ></div>
            <div
                style={{
                    flexShrink: 0,
                    padding: "16px",
                    marginRight: "16px",
                    textAlign: "center",
                    userSelect: "none",
                }}
            >
                <button
                    style={{ display: "block", margin: "1em 0" }}
                    onClick={() => createHelloWorld(anyWindow.manager)}
                >
                    Hello World
                </button>
                <button
                    style={{ display: "block", margin: "1em 0" }}
                    onClick={() => createDocs1(anyWindow.manager)}
                >
                    课件1
                </button>
                <button
                    style={{ display: "block", margin: "1em 0" }}
                    onClick={() => createDocs2(anyWindow.manager)}
                >
                    课件2
                </button>
                <button
                    style={{ display: "block", margin: "1em 0" }}
                    onClick={() => createSlide(anyWindow.manager)}
                >
                    Slide
                </button>
                <button
                    style={{ display: "block", margin: "1em 0" }}
                    onClick={() => createVideo(anyWindow.manager)}
                >
                    视频
                </button>
                <button style={{ display: "block", margin: "1em 0" }} onClick={replay}>
                    回放
                </button>
                <button
                    style={{ display: "block", margin: "1em 0" }}
                    onClick={() => prevPage(anyWindow.manager)}
                >
                    上一页
                </button>
                <button
                    style={{ display: "block", margin: "1em 0" }}
                    onClick={() => nextPage(anyWindow.manager)}
                >
                    下一页
                </button>
            </div>
        </div>
    );
};

ReactDom.render(<App />, document.getElementById("root"));
