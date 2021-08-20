import { WhiteWebSdk, createPlugins } from "white-web-sdk";
import * as Manager from "../dist/index.es";
import "normalize.css"
import "../dist/style.css";
import "video.js/dist/video-js.css";
import { videoJsPlugin } from "@netless/video-js-plugin";
import { scenes } from "./test";

const plugins = createPlugins({ "video.js": videoJsPlugin() });

plugins.setPluginContext("video.js", { enable: true, verbose: true });

const continaer = document.createElement("div");
continaer.id = "root"
continaer.style.width = "80vw";
continaer.style.height = "45vw";
continaer.style.marginTop = "2vh";
continaer.style.marginLeft = "10vw";
continaer.style.border = "1px solid";


const rightBar = document.createElement("div");
rightBar.style.width = "10vw";
rightBar.style.height = "80vh";

const button1 = document.createElement("button")
button1.textContent = "课件1"
const button2 = document.createElement("button")
button2.textContent = "课件2"
const button4= document.createElement("button");
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
    plugins
});

const { WindowManager } = Manager;
window.WindowManager = WindowManager;
// WindowManager.register(PPT);
window.Manager = Manager;
sdk.joinRoom({
    uuid: process.env.ROOM_UUID,
    roomToken: process.env.ROOM_TOKEN,
    invisiblePlugins: [WindowManager],
    useMultiViews: true
}).then(async room => {
    window.room = room;
    // room.setScenePath("/init")

    const manager = await WindowManager.mount(room, continaer, undefined, { debug: true });

    window.manager = manager;
    manager.onAppDestroy(Manager.BuildinApps.StaticDocsViewer, (error) => {
        console.log("onAppDestroy", error)
    })

    button2.addEventListener("click", () => {
        manager.addApp({
            kind: Manager.BuildinApps.DocsViewer,
            options: {
                scenePath: "/test4",
                title: "ppt1",
                scenes: [
                    {
                       name: "1",
                       ppt: { "height": 1010,
                       "src": "https://convertcdn.netless.link/staticConvert/18140800fe8a11eb8cb787b1c376634e/1.png",
                       "width": 714}
                    },
                    {
                        name: "2",
                        ppt: {"height": 1010,
                        "src": "https://convertcdn.netless.link/staticConvert/18140800fe8a11eb8cb787b1c376634e/2.png",
                        "width": 714}
                    },
                ]
            },
        });
    });
    button3.addEventListener("click", () => {
        // manager.addApp({
        //     kind: Manager.BuildinApps.DocsViewer,
        //     options: {
        //         scenePath: "/e1f274f0fe8911eb9841b3776c1e2c17/ebf25a59-f695-4c1d-835e-642f28fe7502",
        //         title: "ppt2"
        //     },
        //     attributes: {
        //         dynamic: true
        //     }
        // });

        manager.addApp({
            kind: Manager.BuildinApps.DocsViewer,
            options: {
                scenePath: "/6b19cb7000a111ecb299bb05d7b75708/a0455ff3-fa5b-46fc-bb65-493e14ae4666",
                title: "ppt3",
                scenes: [{ ppt: { src: "pptx://12312" } }]
            }
        })
    });

    button4.addEventListener("click", () => {
        // manager.addApp({
        //     kind: Manager.BuildinApps.MediaPlayer,
        //     attributes: {
        //         src: "https://flat-storage.oss-accelerate.aliyuncs.com/cloud-storage/b7333e1f-e945-4aec-8346-cfe33b82a7ce.mp4"
        //     }
        // })
        // room.insertPlugin("video.js", {
        //     originX: -300 / 2,
        //     originY: -200 / 2,
        //     width: 300,
        //     height: 200,
        //     attributes: {  },
        // });
        manager.addApp({
            kind: Manager.BuildinApps.MediaPlayer,
            attributes: {
                src: "https://flat-storage.oss-cn-hangzhou.aliyuncs.com/cloud-storage/5c26682a-c950-43b2-b7a5-74def6c43dfb.mp4"
            }
        })
        
    })
})


