import React from "react";
import ReactDom from "react-dom";
import { PlayerPhase, WhiteWebSdk } from "white-web-sdk";
import type { AppContext} from "../dist";
import { BuiltinApps, WindowManager } from "../dist/index.es";
import "../dist/style.css";
import "video.js/dist/video-js.css";

const anyWindow = window as any;

const createHelloWorld = () => {
    anyWindow.manager.addApp({
        kind: "HelloWorld",
        options: {
            scenePath: "/helloworld1"
        }
    });
}

const createDocs1 = () => {
    anyWindow.manager.addApp({
        kind: BuiltinApps.DocsViewer,
        options: {
            scenePath: "/test5/",
            title: "ppt1",
            scenes: [
                {
                    name: "1",
                    ppt: {
                        "height": 1010,
                        "src": "https://convertcdn.netless.link/staticConvert/18140800fe8a11eb8cb787b1c376634e/1.png",
                        "width": 714
                    }
                },
                {
                    name: "2",
                    ppt: {
                        "height": 1010,
                        "src": "https://convertcdn.netless.link/staticConvert/18140800fe8a11eb8cb787b1c376634e/2.png",
                        "width": 714
                    }
                },
            ]
        },
    }).then(appId => console.log("appID", appId));
}
const createDocs2 = () => {
    anyWindow.manager.addApp({
        kind: BuiltinApps.DocsViewer,
        options: {
            scenePath: "/ppt3",
            title: "ppt3",
            scenes: [
                {
                    "name": "1",
                    "ppt": {
                        "height": 720,
                        "previewURL": "https://convertcdn.netless.link/dynamicConvert/6a212c90fa5311ea8b9c074232aaccd4/preview/1.png",
                        "src": "pptx://cover.herewhite.com/dynamicConvert/6a212c90fa5311ea8b9c074232aaccd4/1.slide",
                        "width": 1280
                    }
                },
                {
                    "name": "2",
                    "ppt": {
                        "height": 720,
                        "previewURL": "https://convertcdn.netless.link/dynamicConvert/6a212c90fa5311ea8b9c074232aaccd4/preview/2.png",
                        "src": "pptx://cover.herewhite.com/dynamicConvert/6a212c90fa5311ea8b9c074232aaccd4/2.slide",
                        "width": 1280
                    }
                },
                {
                    "name": "3",
                    "ppt": {
                        "height": 720,
                        "previewURL": "https://convertcdn.netless.link/dynamicConvert/6a212c90fa5311ea8b9c074232aaccd4/preview/3.png",
                        "src": "pptx://cover.herewhite.com/dynamicConvert/6a212c90fa5311ea8b9c074232aaccd4/3.slide",
                        "width": 1280
                    }
                },
                {
                    "name": "4",
                    "ppt": {
                        "height": 720,
                        "previewURL": "https://convertcdn.netless.link/dynamicConvert/6a212c90fa5311ea8b9c074232aaccd4/preview/4.png",
                        "src": "pptx://cover.herewhite.com/dynamicConvert/6a212c90fa5311ea8b9c074232aaccd4/4.slide",
                        "width": 1280
                    }
                },
                {
                    "name": "5",
                    "ppt": {
                        "height": 720,
                        "previewURL": "https://convertcdn.netless.link/dynamicConvert/6a212c90fa5311ea8b9c074232aaccd4/preview/5.png",
                        "src": "pptx://cover.herewhite.com/dynamicConvert/6a212c90fa5311ea8b9c074232aaccd4/5.slide",
                        "width": 1280
                    }
                },
                {
                    "name": "6",
                    "ppt": {
                        "height": 720,
                        "previewURL": "https://convertcdn.netless.link/dynamicConvert/6a212c90fa5311ea8b9c074232aaccd4/preview/6.png",
                        "src": "pptx://cover.herewhite.com/dynamicConvert/6a212c90fa5311ea8b9c074232aaccd4/6.slide",
                        "width": 1280
                    }
                },
                {
                    "name": "7",
                    "ppt": {
                        "height": 720,
                        "previewURL": "https://convertcdn.netless.link/dynamicConvert/6a212c90fa5311ea8b9c074232aaccd4/preview/7.png",
                        "src": "pptx://cover.herewhite.com/dynamicConvert/6a212c90fa5311ea8b9c074232aaccd4/7.slide",
                        "width": 1280
                    }
                },
                {
                    "name": "8",
                    "ppt": {
                        "height": 720,
                        "previewURL": "https://convertcdn.netless.link/dynamicConvert/6a212c90fa5311ea8b9c074232aaccd4/preview/8.png",
                        "src": "pptx://cover.herewhite.com/dynamicConvert/6a212c90fa5311ea8b9c074232aaccd4/8.slide",
                        "width": 1280
                    }
                },
                {
                    "name": "9",
                    "ppt": {
                        "height": 720,
                        "previewURL": "https://convertcdn.netless.link/dynamicConvert/6a212c90fa5311ea8b9c074232aaccd4/preview/9.png",
                        "src": "pptx://cover.herewhite.com/dynamicConvert/6a212c90fa5311ea8b9c074232aaccd4/9.slide",
                        "width": 1280
                    }
                },
                {
                    "name": "10",
                    "ppt": {
                        "height": 720,
                        "previewURL": "https://convertcdn.netless.link/dynamicConvert/6a212c90fa5311ea8b9c074232aaccd4/preview/10.png",
                        "src": "pptx://cover.herewhite.com/dynamicConvert/6a212c90fa5311ea8b9c074232aaccd4/10.slide",
                        "width": 1280
                    }
                },
                {
                    "name": "11",
                    "ppt": {
                        "height": 720,
                        "previewURL": "https://convertcdn.netless.link/dynamicConvert/6a212c90fa5311ea8b9c074232aaccd4/preview/11.png",
                        "src": "pptx://cover.herewhite.com/dynamicConvert/6a212c90fa5311ea8b9c074232aaccd4/11.slide",
                        "width": 1280
                    }
                },
                {
                    "name": "12",
                    "ppt": {
                        "height": 720,
                        "previewURL": "https://convertcdn.netless.link/dynamicConvert/6a212c90fa5311ea8b9c074232aaccd4/preview/12.png",
                        "src": "pptx://cover.herewhite.com/dynamicConvert/6a212c90fa5311ea8b9c074232aaccd4/12.slide",
                        "width": 1280
                    }
                },
                {
                    "name": "13",
                    "ppt": {
                        "height": 720,
                        "previewURL": "https://convertcdn.netless.link/dynamicConvert/6a212c90fa5311ea8b9c074232aaccd4/preview/13.png",
                        "src": "pptx://cover.herewhite.com/dynamicConvert/6a212c90fa5311ea8b9c074232aaccd4/13.slide",
                        "width": 1280
                    }
                },
                {
                    "name": "14",
                    "ppt": {
                        "height": 720,
                        "previewURL": "https://convertcdn.netless.link/dynamicConvert/6a212c90fa5311ea8b9c074232aaccd4/preview/14.png",
                        "src": "pptx://cover.herewhite.com/dynamicConvert/6a212c90fa5311ea8b9c074232aaccd4/14.slide",
                        "width": 1280
                    }
                },
                {
                    "name": "15",
                    "ppt": {
                        "height": 720,
                        "previewURL": "https://convertcdn.netless.link/dynamicConvert/6a212c90fa5311ea8b9c074232aaccd4/preview/15.png",
                        "src": "pptx://cover.herewhite.com/dynamicConvert/6a212c90fa5311ea8b9c074232aaccd4/15.slide",
                        "width": 1280
                    }
                },
                {
                    "name": "16",
                    "ppt": {
                        "height": 720,
                        "previewURL": "https://convertcdn.netless.link/dynamicConvert/6a212c90fa5311ea8b9c074232aaccd4/preview/16.png",
                        "src": "pptx://cover.herewhite.com/dynamicConvert/6a212c90fa5311ea8b9c074232aaccd4/16.slide",
                        "width": 1280
                    }
                }
            ]
        }
    })
}
const createVideo = () => {
    anyWindow.manager.addApp({
        kind: BuiltinApps.MediaPlayer,
        attributes: {
            src: "https://developer-assets.netless.link/Zelda.mp4"
        }
    })
}

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
            player.play()
        }, 500)
        player.callbacks.on("onPhaseChanged", phase => {
            if (phase === PlayerPhase.Playing) {
                if (firstPlay) return;
                setTimeout(() => {
                    mountManager(player, document.getElementById("container"))
                }, 1000)
                firstPlay = true
            }
        })
    })
}

const onRef = (ref) => {
    sdk.joinRoom({
        uuid: process.env.ROOM_UUID,
        roomToken: process.env.ROOM_TOKEN,
        invisiblePlugins: [WindowManager as any],
        useMultiViews: true,
        userPayload: {
            userId: "111",
            cursorName: "测试测试",
            avatar: "https://avatars.githubusercontent.com/u/8299540?s=60&v=4",
        },
        isWritable: !(isWritable === "false"),
        cursorAdapter: undefined,
        uid: Math.random().toString().substr(3, 8),
        disableMagixEventDispatchLimit: true,
    }).then(async room => {
        if (room.isWritable) {
            room.setMemberState({ strokeColor: [0, 0, 1] });
        }

        (window as any).room = room;
        await mountManager(room, ref);
    })
}

const HelloWorldApp = async () => {
    console.log('start loading HelloWorld...')
    // await new Promise(resolve => setTimeout(resolve, 2000))
    console.log('HelloWorld Loaded')
    return {
        kind: "HelloWorld",
        setup: (context: AppContext<any, any>) => {
            console.log('helloworld options', context.getAppOptions());
            context.mountView(context.getBox().$content as any);
            context.emitter.on("destroy",() => console.log("[HelloWorld]: destroy"))
            return "Hello World Result";
        }
    }
};

WindowManager.register({
    kind: "HelloWorld",
    src: HelloWorldApp,
    appOptions: () => 'AppOptions',
    addHooks: (emitter) => {
        emitter.on('created', result => {
            console.log('HelloWordResult', result);
        })
    }
});

const sdk = new WhiteWebSdk({
    appIdentifier: process.env.APPID,
    useMobXState: true
});

(window as any).WindowManager = WindowManager;
const search = window.location.search;
const url = new URLSearchParams(search);
const isWritable = url.get("isWritable");

const mountManager = async (room, root) => {
    const manager = await WindowManager.mount({
        room,
        container: root,
        // collectorStyles: { bottom: "100px", right: "30px" },
        containerSizeRatio: 9 / 16,
        chessboard: true,
        debug: true,
        cursor: true,
        // disableCameraTransform: true,
    });

    (window as any).manager = manager;
    (window as any).manager.onAppDestroy(BuiltinApps.DocsViewer, (error) => {
        console.log("onAppDestroy", error)
    });

    (window as any).manager.emitter.on("mainViewModeChange", mode => {
        console.log("mode", mode);
    })

    manager.emitter.on("boxStateChange", state => {
        console.log("boxState", state);
    });
    console.log("boxState", manager.boxState);
}
const destroy = () => {
    anyWindow.manager.destroy();
    anyWindow.manager = undefined;
}

anyWindow.mountManager = mountManager;
anyWindow.destroy = destroy;

const App = () => {
    return (
        <div style={{
            display: "flex",
            width: "100vw",
            height: "100vh",
            padding: "16px 16px",
            overflow: "hidden",
            boxSizing: "border-box"
        }}>
            <div ref={onRef} id="container" style={{
                flex: 1,
                height: "calc(100vh - 32px)",
                border: "1px solid"
            }}>
            </div>
            <div style={{
                flexShrink: 0,
                padding: "16px",
                marginRight: "16px",
                textAlign: "center",
                userSelect: "none"
            }}>
                <button style={{ display: "block", margin: "1em 0"  }} onClick={createHelloWorld}>Hello World</button>
                <button style={{ display: "block", margin: "1em 0"  }} onClick={createDocs1}>课件1</button>
                <button style={{ display: "block", margin: "1em 0"  }} onClick={createDocs2}>课件2</button>
                <button style={{ display: "block", margin: "1em 0"  }} onClick={createVideo}>视频</button>
                <button style={{ display: "block", margin: "1em 0"  }} onClick={replay}>回放</button>
            </div>
        </div>
    )
}

ReactDom.render(<App />, document.getElementById("root"))
