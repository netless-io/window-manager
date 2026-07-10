import type { WindowManager } from "../dist";
import { BuiltinApps } from "../dist";
import * as docs from "./docs.json";

export const createHelloWorld = (manager: WindowManager) => {
    manager.addApp({
        kind: "HelloWorld",
        options: {
            scenePath: "/helloworld1",
        },
        forceTop: true,
        forceNormal: true,
        isDragContent: true,
    });
};

export const createPresentation = (manager: WindowManager) => {
    manager.addApp({
        kind: "Presentation",
        options: {
            scenePath: "/Presentation",
            title: "Static PDF",
            scenes: [
                {
                    name: "1",
                    ppt: {
                        height: 1010,
                        src: "https://convertcdn.netless.link/staticConvert/18140800fe8a11eb8cb787b1c376634e/1.png",
                        width: 714,
                    },
                },
                {
                    name: "2",
                    ppt: {
                        height: 1010,
                        src: "https://convertcdn.netless.link/staticConvert/18140800fe8a11eb8cb787b1c376634e/2.png",
                        width: 714,
                    },
                },
                {
                    name: "3",
                    ppt: {
                        height: 1010,
                        src: "https://convertcdn.netless.link/staticConvert/00a244504ae311ee8180f740d6754c0e/28.png",
                        width: 714,
                    },
                },
                {
                    name: "4",
                    ppt: {
                        height: 1010,
                        src: "https://convertcdn.netless.link/staticConvert/00a244504ae311ee8180f740d6754c0e/32.png",
                        width: 714,
                    },
                },
                {
                    name: "5",
                    ppt: {
                        height: 1010,
                        src: "https://convertcdn.netless.link/staticConvert/00a244504ae311ee8180f740d6754c0e/33.png",
                        width: 714,
                    },
                },
                {
                    name: "6",
                    ppt: {
                        height: 1010,
                        src: "https://convertcdn.netless.link/staticConvert/00a244504ae311ee8180f740d6754c0e/24.png",
                        width: 714,
                    },
                },
            ],
        },
    });
};

export const createPlyr = (manager: WindowManager) => {
    manager.addApp({
        kind: "Plyr",
        options: {
            title: "test.mp4",
        },
        attributes: {
            useNewPlayer: true,
            src: "https://flat-storage.oss-accelerate.aliyuncs.com/cloud-storage/2022-03/28/e35a6676-aa5d-4a61-8f17-87e626b7d1b7/e35a6676-aa5d-4a61-8f17-87e626b7d1b7.mp4",
            paused: false,
        },
    });
};

export const createCounter = async (manager: WindowManager) => {
    manager.addApp({
        kind: "Counter",
    });
};

export const createStatic = (manager: WindowManager) => {
    return manager.addApp({
        kind: BuiltinApps.DocsViewer,
        options: {
            scenePath: "/test5",
            title: "ppt1",
            scenes: docs.staticDocs,
        },
    });
};
export const createDynamic = (manager: WindowManager) => {
    return manager.addApp({
        kind: BuiltinApps.DocsViewer,
        options: {
            scenePath: "/ppt3",
            title: "ppt3",
            scenes: docs.dynamicDocs,
        },
    });
};
export const createVideo = (manager: WindowManager) => {
    manager.addApp({
        kind: BuiltinApps.MediaPlayer,
        attributes: {
            src: "https://developer-assets.netless.link/Zelda.mp4",
        },
    });
};

export const createSlide = (manager: WindowManager) => {
    manager.addApp({
        kind: "Slide",
        options: {
            scenePath: `/ppt/9340e8e067bc11ec8f582b1b98453394`, // [1]
            title: "a.pptx",
        },
        attributes: {
            taskId: "9340e8e067bc11ec8f582b1b98453394", // [2]
            url: "https://convertcdn.netless.link/dynamicConvert", // [3]
        },
    });
};

export const createBoard = (manager: WindowManager) => {
    return manager.addApp({
        kind: "Board",
        options: {
            scenePath: "/board1",
        },
    });
};

export const createIframe = (manager: WindowManager) => {
    return manager.getIframeBridge().insert({
        width: 400,
        height: 300,
        url: "/h5.html",
        displaySceneDir: "/",
    });
};
