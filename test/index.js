import { WhiteWebSdk, InvisiblePlugin, ViewVisionMode } from "white-web-sdk";
import * as Manager from "../dist/index";
import "normalize.css"
import { scenes } from "./test";

const continaer = document.createElement("div");
continaer.style.width = "80vw";
continaer.style.height = "80vh";
continaer.style.overflowY = "scroll";
continaer.style.marginLeft = "10vw";
continaer.style.marginTop = "10vh";

const root = document.createElement("div");
root.textContent = "whiteboard";
root.style.width = "100%";
root.style.height = "1000px";

root.style.backgroundColor = "gray";

continaer.appendChild(root)


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

const timer = null

continaer.addEventListener("wheel", event => {
    root.style.pointerEvents = "none";
    if (timer) {
        clearTimeout(timer);
        timer = setTimeout(() => {
            root.style.pointerEvents = "auto";
        }, 5);
    }
});

continaer.addEventListener("click", () => {
    root.style.pointerEvents = "auto";
})

rightBar.appendChild(button1);
rightBar.appendChild(document.createElement("br"))
rightBar.appendChild(document.createElement("br"))
rightBar.appendChild(button2);

document.body.appendChild(continaer);
document.body.appendChild(rightBar);

const sdk = new WhiteWebSdk({
    appIdentifier: process.env.APPID
});

const { WindowManager, WindowManagerWrapper } = Manager;
window.WindowManager = WindowManager;
window.WindowManagerWrapper = WindowManagerWrapper;
window.Manager = Manager;
sdk.joinRoom({
    uuid: process.env.ROOM_UUID,
    roomToken: process.env.ROOM_TOKEN,
    wrappedComponents: [WindowManagerWrapper],
    invisiblePlugins: [WindowManager],
    useMultiViews: true
}).then(room => {

    window.room = room;

    room.setScenePath("/init")

    const manager = room.getInvisiblePlugin(WindowManager.kind);
    window.InvisiblePlugin = InvisiblePlugin;
    WindowManager.use(room);
    window.manager = manager;

    const mainView = manager.createMainView();
     mainView.mode = ViewVisionMode.Writable;
    mainView.divElement = root;
    window.mainView = mainView;

    manager.onPluginDestroy(PPT.kind, (error) => {
        console.log("onPlugindestroy", error)
    })

    button1.addEventListener("click", () => {
      manager.addPlugin(
        PPT.kind,
        undefined,
        {
          ppt: { scenePath: "/test" },
        },
        { options: { a: 1 }, plugin: PPT }
      );
    });

    button2.addEventListener("click", () => {
      manager.addPlugin(
        PPT.kind,
        undefined,
        {
          ppt: { scenePath: "/test3" },
        },
        { options: { a: 1 }, plugin: PPT }
      );
    });
})


