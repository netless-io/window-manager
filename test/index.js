import { WhiteWebSdk, createPlugins } from "white-web-sdk";
import { WindowManager, BuildinApps } from "../dist/index.es";
import "normalize.css"
import "../dist/style.css";
import { scenes } from "./test";


const continaer = document.createElement("div");
continaer.id = "root"
continaer.style.width = "80vw";
continaer.style.height = "45vw";
continaer.style.marginTop = "2vh";
continaer.style.marginLeft = "10vw";
continaer.style.border = "1px solid";
const collector = document.createElement("div");
collector.style.position = "static";
collector.style.marginTop = "50px";
document.body.insertBefore(collector, document.body.firstChild)

const rightBar = document.createElement("div");
rightBar.style.width = "10vw";
rightBar.style.height = "80vh";

const button1 = document.createElement("button")
button1.textContent = "课件1"
const button2 = document.createElement("button")
button2.textContent = "课件2"
const button4 = document.createElement("button");
button4.textContent = "插入视频"

rightBar.style.position = "fixed";
rightBar.style.right = 0;
rightBar.style.top = "70px";
rightBar.style.textAlign = "center";

const button3 = document.createElement("button")
button3.textContent = "课件3"

rightBar.appendChild(button2);
rightBar.appendChild(document.createElement("br"))
rightBar.appendChild(document.createElement("br"))
rightBar.appendChild(button3);
rightBar.appendChild(document.createElement("br"))
rightBar.appendChild(document.createElement("br"))
rightBar.appendChild(button4);

document.body.appendChild(continaer);
document.body.appendChild(rightBar);

const sdk = new WhiteWebSdk({
    appIdentifier: process.env.APPID,
});

window.WindowManager = WindowManager;

sdk.joinRoom({
    uuid: process.env.ROOM_UUID,
    roomToken: process.env.ROOM_TOKEN,
    invisiblePlugins: [WindowManager],
    useMultiViews: true,
}).then(async room => {
    window.room = room;
    await mountManager(room);
})


const mountManager = async (room) => {
    const manager = await WindowManager.mount(
        room,
        continaer,
        undefined,
        { collectorStyles: { bottom: "100px", right: "30px" }, debug: true });

    window.manager = manager;
    window.manager.onAppDestroy(BuildinApps.DocsViewer, (error) => {
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
        kind: BuildinApps.DocsViewer,
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
        kind: BuildinApps.DocsViewer,
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
        kind: BuildinApps.MediaPlayer,
        attributes: {
            src: "https://flat-storage.oss-cn-hangzhou.aliyuncs.com/cloud-storage/5c26682a-c950-43b2-b7a5-74def6c43dfb.mp4"
        }
    })

})

const destroy = () => {
    window.manager.destroy();
    window.manager = undefined;
}

window.mountManager = mountManager;
window.destroy = destroy;