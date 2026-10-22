import { WindowManager } from "@netless/window-manager";

WindowManager.register({
    kind: "LittleBoard",
    src: async () => (await import("@netless/app-little-white-board")).default,
    appOptions: {
        language: "zh-CN",
        disableCameraTransform: true,
        onMount: (appId: string, uid: string) => console.log("[LittleBoard] mounted", appId, uid),
        onPublishQuestion: (appId: string, uid: string) => console.log("[LittleBoard] published", appId, uid),
        onCommit: (appId: string, uid: string) => console.log("[LittleBoard] committed", appId, uid),
    },
});

export function createLittleBoard(manager: WindowManager) {
    const room = manager.room;
    if (!room?.isWritable) return;
    return manager.addApp({
        kind: "LittleBoard",
        options: { title: "小白板", scenePath: `/LittleBoard/${Date.now()}` },
        attributes: { uid: room.uid },
    });
}
