import { WhiteWebSdk, InvisiblePlugin, ViewVisionMode } from "white-web-sdk";
import * as Manager from "../dist/window-manager.es";
import "normalize.css"
import "../dist/style.css";
import { scenes } from "./test";

const continaer = document.createElement("div");
continaer.id = "root"
continaer.style.width = "80vw";
continaer.style.height = "90vh";
continaer.style.overflow = "hidden";
continaer.style.marginTop = "2vh";
continaer.style.marginLeft = "10vw";
continaer.style.position = "relative";
continaer.style.border = "1px solid";

const root = document.createElement("div");
root.textContent = "whiteboard";
root.style.width = "100%";
root.style.height = "100%";

// root.style.backgroundColor = "gray";

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

const button3 = document.createElement("button")
button3.textContent = "课件3"

rightBar.appendChild(button1);
rightBar.appendChild(document.createElement("br"))
rightBar.appendChild(document.createElement("br"))
rightBar.appendChild(button2);
rightBar.appendChild(document.createElement("br"))
rightBar.appendChild(document.createElement("br"))
rightBar.appendChild(button3);

document.body.appendChild(continaer);
document.body.appendChild(rightBar);

const sdk = new WhiteWebSdk({
    appIdentifier: process.env.APPID
});

const { WindowManager } = Manager;
window.WindowManager = WindowManager;

window.Manager = Manager;
sdk.joinRoom({
    uuid: process.env.ROOM_UUID,
    roomToken: process.env.ROOM_TOKEN,
    // wrappedComponents: [WindowManagerWrapper],
    invisiblePlugins: [WindowManager],
    useMultiViews: true
}).then(room => {

    window.room = room;

    room.setScenePath("/init")

    const manager = room.getInvisiblePlugin(WindowManager.kind);
    window.InvisiblePlugin = InvisiblePlugin;
    WindowManager.use(room, document.getElementById("root"));
    window.manager = manager;

    const mainView = manager.createMainView();
     mainView.mode = ViewVisionMode.Writable;
    mainView.divElement = root;
    window.mainView = mainView;

    manager.onPluginDestroy(PPT.kind, (error) => {
        console.log("onPlugindestroy", error)
    })

    button1.addEventListener("click", () => {
      manager.baseInsertPlugin(
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
          ppt: { scenePath: "/693d42e0f69311eb8177ab7800579660/f62a1dfb-3efb-4d6e-87e1-fc3c522b52aa" },
        },
        { options: { a: 1 }, plugin: PPT }
      );
    });
    button3.addEventListener("click", () => {
        manager.addPlugin(
          PPT.kind,
          undefined,
          {
            ppt: { scenePath: "/693d42e0f69311eb8177ab7800579660/86c7e7ae-fb8d-446e-98a5-74f326856101" },
          },
          { options: { a: 1 }, plugin: PPT }
        );
      });
})


