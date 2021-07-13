import { WhiteWebSdk, InvisiblePlugin } from "white-web-sdk";
import * as Manager from "../dist/index";
import "normalize.css"

const root = document.createElement("div");
root.textContent = "whiteboard";
root.style.width = "100vw";
root.style.height = "100vh";
document.body.appendChild(root);

const APPID = process.env.APPID;

const sdk = new WhiteWebSdk({
    appIdentifier: APPID
});

sdk.joinRoom({
    uuid: process.env.ROOM_UUID,
    roomToken: process.env.ROOM_TOKEN,
    wrappedComponents: [Manager.WindowManagerWrapper],
    invisiblePlugins: [Manager.WindowManager]
}).then(room => {
    room.bindHtmlElement(root);
    window.room = room;
    const manager = room.getInvisiblePlugin(Manager.WindowManager.kind);
    window.InvisiblePlugin = InvisiblePlugin;
    Manager.WindowManager.use(room)
})

