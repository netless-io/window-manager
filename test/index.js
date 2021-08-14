import { WhiteWebSdk, InvisiblePlugin, ViewVisionMode } from "white-web-sdk";
import * as Manager from "../dist/index.es";
import "normalize.css"
import "../dist/style.css";
import { scenes } from "./test";

const continaer = document.createElement("div");
continaer.id = "root"
continaer.style.width = "80vw";
continaer.style.height = "90vh";
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

document.body.appendChild(continaer);
document.body.appendChild(rightBar);

const sdk = new WhiteWebSdk({
    appIdentifier: process.env.APPID
});

const { WindowManager } = Manager;
window.WindowManager = WindowManager;
WindowManager.register(PPT);
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
    WindowManager.mount(room, continaer, undefined, { debug: true });
    window.manager = manager;

    // const mainView = manager.createMainView();
    // mainView.mode = ViewVisionMode.Writable;
    // mainView.divElement = root;
    // window.mainView = mainView;

    manager.onAppDestroy(PPT.kind, (error) => {
        console.log("onAppDestroy", error)
    })

    button2.addEventListener("click", () => {
        manager.addApp({
            kind: PPT.kind,
            options: {
                scenePath: "/2e57c840f98a11eb9b03a12989ba200c/80b1ae4e-f9f6-4cf3-82c8-9e6642c3902e",
                title: "ppt1",
            },
            attributes: {
                a: 1
            }
        });
    });
    button3.addEventListener("click", () => {
        manager.addApp({
            kind: PPT.kind,
            options: {
                scenePath: "/2e57c840f98a11eb9b03a12989ba200c/9260d43b-d48a-4936-b54c-06d0d4c1716d",
                title: "ppt2"
            },
            attributes: {
                a: 1
            }
        });
    });
})




