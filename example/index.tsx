import React from "react";
import ReactDom from "react-dom";
import { PlayerPhase, WhiteWebSdk } from "white-web-sdk";
import { BuiltinApps, WindowManager } from "../dist/index.es";
import type { WindowManager as WindowManagerType } from "../dist";
import { createDocs1, createDocs2, createHelloWorld, createVideo, createSlide } from "./apps";
import "../dist/style.css";
import "./register";

const sdk = new WhiteWebSdk({
    appIdentifier: import.meta.env.VITE_APPID,
    useMobXState: true,
});

const anyWindow = window as any;

(window as any).WindowManager = WindowManager;

let firstPlay = false;

const search = window.location.search;
const url = new URLSearchParams(search);
const isWritable = url.get("isWritable");

const mountManager = async (room, root) => {
    const manager = (await WindowManager.mount({
        room,
        // collectorStyles: { bottom: "100px", left: "30px" },
        containerSizeRatio: 9 / 16,
        chessboard: true,
        debug: true,
        cursor: true,
    })) as WindowManagerType;

    manager.emitter.on("ready", () => {
        console.log("manager ready", manager.queryAll());
    });

    manager.bindContainer(root);
    console.log("manager apps", manager.queryAll());
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
    manager.emitter.on("mainViewScenesLengthChange", length => {
        console.log("mainViewScenesLengthChange", length);
    });
    manager.emitter.on("canRedoStepsChange", steps => {
        console.log("canRedoStepsChange", steps);
    });
    manager.emitter.on("canUndoStepsChange", steps => {
        console.log("canUndoStepsChange", steps);
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    manager.emitter.on("cameraStateChange", state => {
        // console.log("cameraStateChange", state);
    });

    manager.emitter.on("sceneStateChange", state => {
        console.log("sceneStateChange", state);
    });

    manager.emitter.on("loadApp", payload => {
        console.log("loadApp", payload);
    });
};

const replay = () => {
    sdk.replayRoom({
        room: import.meta.env.VITE_ROOM_UUID,
        roomToken: import.meta.env.VITE_ROOM_TOKEN,
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
        uuid: import.meta.env.VITE_ROOM_UUID,
        roomToken: import.meta.env.VITE_ROOM_TOKEN,
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
        floatBar: true,
    }).then(async room => {
        if (room.isWritable) {
            // room.setMemberState({ strokeColor: [0, 0, 1] });
        }
        (window as any).room = room;
        await mountManager(room, ref);
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
