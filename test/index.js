import { WhiteWebSdk, InvisiblePlugin } from "white-web-sdk";
import * as Manager from "../dist/index";
import "normalize.css"

const root = document.createElement("div");
root.textContent = "whiteboard";
root.style.width = "80vw";
root.style.height = "80vh";
root.style.marginLeft = "10vw";
root.style.marginTop = "10vh";
root.style.backgroundColor = "gray";
document.body.appendChild(root);

const sdk = new WhiteWebSdk({
    appIdentifier: process.env.APPID
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
    Manager.WindowManager.use(room);
})

