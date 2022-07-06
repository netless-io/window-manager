import type { WindowManager } from "../dist";
import { BuiltinApps } from "../dist/index.es";
import * as docs from "./docs.json";

export const createCounter = (manager: WindowManager) => {
    manager.addApp({
        kind: "Counter"
    })
};

export const createStatic = (manager: WindowManager) => {
    return manager
        .addApp({
            kind: BuiltinApps.DocsViewer,
            options: {
                scenePath: "/test5",
                title: "ppt1",
                scenes: docs.staticDocs,
            },
        })
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
        // options: {
        //     scenePath: "/ppt3",
        //     title: "ppt3",
        //     scenes: docs.dynamicDocs,
        // },
    });
}
