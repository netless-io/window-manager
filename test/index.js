/* eslint-disable no-undef */
import { WhiteWebSdk } from "white-web-sdk";
import { WindowManager, BuiltinApps } from "../dist/index.es";
import "normalize.css"
import "../dist/style.css";
import "video.js/dist/video-js.css";

document.body.style.margin = '0';
document.body.style.padding = '0';

const container = document.createElement('div');
container.style.display = 'flex';
container.style.width = '100vw';
container.style.height = '100vh';
container.style.padding = '16px 16px';
container.style.overflow = 'hidden';
container.style.boxSizing = 'border-box';

const whiteboardRoot = document.createElement("div");
whiteboardRoot.id = "root"
whiteboardRoot.style.flex = "1";
whiteboardRoot.style.height = "calc(100vh - 32px)";
whiteboardRoot.style.border = "1px solid";

const rightBar = document.createElement("div");
rightBar.style.flexShrink = "0";
rightBar.style.padding = "16px";
rightBar.style.marginRight = "16px";
rightBar.style.textAlign = "center";
rightBar.style.userSelect = "none";

const button1 = document.createElement("button")
button1.textContent = "课件1"
const button2 = document.createElement("button")
button2.textContent = "课件2"
const button3 = document.createElement("button")
button3.textContent = "课件3"
const button4 = document.createElement("button");
button4.textContent = "插入视频"

rightBar.appendChild(button2);
rightBar.appendChild(document.createElement("br"))
rightBar.appendChild(document.createElement("br"))
rightBar.appendChild(button3);
rightBar.appendChild(document.createElement("br"))
rightBar.appendChild(document.createElement("br"))
rightBar.appendChild(button4);

container.appendChild(whiteboardRoot);
container.appendChild(rightBar);

document.body.append(container)

WindowManager.register({ kind: "HelloWorld", src: "https://netless-h5-demo.oss-cn-hangzhou.aliyuncs.com/tmp/main.iife.js" })

const sdk = new WhiteWebSdk({
    appIdentifier: process.env.APPID,
    useMobXState: true
});

window.WindowManager = WindowManager;

sdk.joinRoom({
    uuid: process.env.ROOM_UUID,
    roomToken: process.env.ROOM_TOKEN,
    invisiblePlugins: [WindowManager],
    useMultiViews: true,
    userPayload: {
        userId: "111",
        cursorName: "su",
        // avatar: "https://avatars.githubusercontent.com/u/8299540?s=60&v=4",
    }
}).then(async room => {
    window.room = room;
    await mountManager(room);
})


const mountManager = async (room) => {
    const manager = await WindowManager.mount({
        room,
        container: whiteboardRoot,
        // collectorStyles: { bottom: "100px", right: "30px" },
        containerSizeRatio: 9 / 16,
        chessboard: true,
        debug: true,
        cursor: true,
        overwriteStyles: `.telebox-title {
            color: #e9e9e9;
          }
          .telebox-titlebar {
            color: #e9e9e9;
            background: #43434d;
            border-bottom: none;
          }
          .telebox-box-main {
            background: #212126;
            border-color: #43434d;
          }
          .netless-app-docs-viewer-page-number-input {
            color: #a6a6a8;
          }
          .netless-app-docs-viewer-page-number-input:active,
          .netless-app-docs-viewer-page-number-input:focus,
          .netless-app-docs-viewer-page-number-input:hover {
            color: #222;
          }
          .netless-app-docs-viewer-footer {
            color: #a6a6a8;
            background: #2d2d33;
            border-top: none;
          }
          .netless-app-docs-viewer-footer-btn:hover {
            background: #212126;
          }
          .netless-app-docs-viewer-preview {
            background: rgba(50, 50, 50, 0.9);
          }`
    });

    window.manager = manager;
    window.manager.onAppDestroy(BuiltinApps.DocsViewer, (error) => {
        console.log("onAppDestroy", error)
    });

    window.manager.emitter.on("mainViewModeChange", mode => {
        console.log("mode", mode);
    })

    manager.emitter.on("boxStateChange", state => {
        console.log("boxState", state);
    })
}

button2.addEventListener("click", () => {
    window.manager.addApp({
        kind: BuiltinApps.DocsViewer,
        options: {
            scenePath: "/test4",
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
});
button3.addEventListener("click", () => {
    window.manager.addApp({
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
});

button4.addEventListener("click", () => {
    window.manager.addApp({
        kind: BuiltinApps.MediaPlayer,
        attributes: {
            src: "https://developer-assets.netless.link/Zelda.mp4"
        }
    })
})

const destroy = () => {
    window.manager.destroy();
    window.manager = undefined;
}

window.mountManager = mountManager;
window.destroy = destroy;