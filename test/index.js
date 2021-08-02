import { WhiteWebSdk, InvisiblePlugin, ViewVisionMode } from "white-web-sdk";
import * as Manager from "../dist/index";
import "normalize.css"
import { scenes } from "./test";

const root = document.createElement("div");
root.textContent = "whiteboard";
root.style.width = "80vw";
root.style.height = "80vh";
root.style.marginLeft = "10vw";
root.style.marginTop = "10vh";
root.style.backgroundColor = "gray";

// const pptDom = document.createElement("div");
// pptDom.style.width = "80vw";
// pptDom.style.height = "80vh";
// pptDom.style.marginLeft = "10vw";
// pptDom.style.marginTop = "10vh";

const rightBar = document.createElement("div");
rightBar.style.width = "10vw";
rightBar.style.height = "80vh";

const button1 = document.createElement("button")
button1.textContent = "课件1"
const button2 = document.createElement("button")
button2.textContent = "课件2"

rightBar.style.position = "fixed";
rightBar.style.right = 0;
rightBar.style.top = "70px";
rightBar.style.textAlign = "center";

rightBar.appendChild(button1);
rightBar.appendChild(document.createElement("br"))
rightBar.appendChild(document.createElement("br"))
rightBar.appendChild(button2);

document.body.appendChild(root);
document.body.appendChild(rightBar);

const sdk = new WhiteWebSdk({
    appIdentifier: process.env.APPID
});

const { WindowManager, WindowManagerWrapper } = Manager;

sdk.joinRoom({
    uuid: process.env.ROOM_UUID,
    roomToken: process.env.ROOM_TOKEN,
    wrappedComponents: [WindowManagerWrapper],
    invisiblePlugins: [WindowManager],
    useMultiViews: true
}).then(room => {
    // room.bindHtmlElement(root);
    window.room = room;
    room.putScenes("/test", scenes);

    const mainView = room.views.createView();
    mainView.mode = ViewVisionMode.Writable;
    mainView.divElement = root;
    window.mainView = mainView;
    // pptView.focusScenePath = "/test/2d9a8a51-08c1-4949-94f9-7d186d04b3b0";

    const manager = room.getInvisiblePlugin(WindowManager.kind);
    window.InvisiblePlugin = InvisiblePlugin;
    // WindowManager.use(room);
    window.manager = manager;

    button1.addEventListener("click", () => {
        manager.addPlugin(PPT.kind, undefined, {
            plugin: PPT,
            ppt: { scenePath: "/test" },
            options: () => {
                return { a:1 };
            }
        })
    })

    button2.addEventListener("click", () => {
        manager.addPlugin(PPT.kind, undefined, { plugin: PPT, ppt: { scenePath: "/test3" } })
    })
})


