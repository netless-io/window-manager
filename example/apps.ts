import type { WindowManager } from "../dist";
import { BuiltinApps } from "../dist/index.es"

export const createHelloWorld = (manager: WindowManager) => {
    manager.addApp({
        kind: "HelloWorld1",
        options: {
            scenePath: "/helloworld1",
        },
        attributes: {
            a: 1,
        },
    });
};

export const createDocs1 = (manager: WindowManager) => {
    manager
        .addApp({
            kind: BuiltinApps.DocsViewer,
            options: {
                scenePath: "/test5",
                title: "ppt1",
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
                ],
            },
        })
        .then(appId => console.log("appID", appId));
};
export const createDocs2 = (manager: WindowManager) => {
    manager.addApp({
        kind: BuiltinApps.DocsViewer,
        options: {
            scenePath: "/ppt3",
            title: "ppt3",
            scenes: [
                {
                    name: "1",
                    ppt: {
                        height: 720,
                        previewURL:
                            "https://convertcdn.netless.link/dynamicConvert/6a212c90fa5311ea8b9c074232aaccd4/preview/1.png",
                        src: "pptx://cover.herewhite.com/dynamicConvert/6a212c90fa5311ea8b9c074232aaccd4/1.slide",
                        width: 1280,
                    },
                },
                {
                    name: "2",
                    ppt: {
                        height: 720,
                        previewURL:
                            "https://convertcdn.netless.link/dynamicConvert/6a212c90fa5311ea8b9c074232aaccd4/preview/2.png",
                        src: "pptx://cover.herewhite.com/dynamicConvert/6a212c90fa5311ea8b9c074232aaccd4/2.slide",
                        width: 1280,
                    },
                },
                {
                    name: "3",
                    ppt: {
                        height: 720,
                        previewURL:
                            "https://convertcdn.netless.link/dynamicConvert/6a212c90fa5311ea8b9c074232aaccd4/preview/3.png",
                        src: "pptx://cover.herewhite.com/dynamicConvert/6a212c90fa5311ea8b9c074232aaccd4/3.slide",
                        width: 1280,
                    },
                },
                {
                    name: "4",
                    ppt: {
                        height: 720,
                        previewURL:
                            "https://convertcdn.netless.link/dynamicConvert/6a212c90fa5311ea8b9c074232aaccd4/preview/4.png",
                        src: "pptx://cover.herewhite.com/dynamicConvert/6a212c90fa5311ea8b9c074232aaccd4/4.slide",
                        width: 1280,
                    },
                },
                {
                    name: "5",
                    ppt: {
                        height: 720,
                        previewURL:
                            "https://convertcdn.netless.link/dynamicConvert/6a212c90fa5311ea8b9c074232aaccd4/preview/5.png",
                        src: "pptx://cover.herewhite.com/dynamicConvert/6a212c90fa5311ea8b9c074232aaccd4/5.slide",
                        width: 1280,
                    },
                },
                {
                    name: "6",
                    ppt: {
                        height: 720,
                        previewURL:
                            "https://convertcdn.netless.link/dynamicConvert/6a212c90fa5311ea8b9c074232aaccd4/preview/6.png",
                        src: "pptx://cover.herewhite.com/dynamicConvert/6a212c90fa5311ea8b9c074232aaccd4/6.slide",
                        width: 1280,
                    },
                },
                {
                    name: "7",
                    ppt: {
                        height: 720,
                        previewURL:
                            "https://convertcdn.netless.link/dynamicConvert/6a212c90fa5311ea8b9c074232aaccd4/preview/7.png",
                        src: "pptx://cover.herewhite.com/dynamicConvert/6a212c90fa5311ea8b9c074232aaccd4/7.slide",
                        width: 1280,
                    },
                },
                {
                    name: "8",
                    ppt: {
                        height: 720,
                        previewURL:
                            "https://convertcdn.netless.link/dynamicConvert/6a212c90fa5311ea8b9c074232aaccd4/preview/8.png",
                        src: "pptx://cover.herewhite.com/dynamicConvert/6a212c90fa5311ea8b9c074232aaccd4/8.slide",
                        width: 1280,
                    },
                },
                {
                    name: "9",
                    ppt: {
                        height: 720,
                        previewURL:
                            "https://convertcdn.netless.link/dynamicConvert/6a212c90fa5311ea8b9c074232aaccd4/preview/9.png",
                        src: "pptx://cover.herewhite.com/dynamicConvert/6a212c90fa5311ea8b9c074232aaccd4/9.slide",
                        width: 1280,
                    },
                },
                {
                    name: "10",
                    ppt: {
                        height: 720,
                        previewURL:
                            "https://convertcdn.netless.link/dynamicConvert/6a212c90fa5311ea8b9c074232aaccd4/preview/10.png",
                        src: "pptx://cover.herewhite.com/dynamicConvert/6a212c90fa5311ea8b9c074232aaccd4/10.slide",
                        width: 1280,
                    },
                },
                {
                    name: "11",
                    ppt: {
                        height: 720,
                        previewURL:
                            "https://convertcdn.netless.link/dynamicConvert/6a212c90fa5311ea8b9c074232aaccd4/preview/11.png",
                        src: "pptx://cover.herewhite.com/dynamicConvert/6a212c90fa5311ea8b9c074232aaccd4/11.slide",
                        width: 1280,
                    },
                },
                {
                    name: "12",
                    ppt: {
                        height: 720,
                        previewURL:
                            "https://convertcdn.netless.link/dynamicConvert/6a212c90fa5311ea8b9c074232aaccd4/preview/12.png",
                        src: "pptx://cover.herewhite.com/dynamicConvert/6a212c90fa5311ea8b9c074232aaccd4/12.slide",
                        width: 1280,
                    },
                },
                {
                    name: "13",
                    ppt: {
                        height: 720,
                        previewURL:
                            "https://convertcdn.netless.link/dynamicConvert/6a212c90fa5311ea8b9c074232aaccd4/preview/13.png",
                        src: "pptx://cover.herewhite.com/dynamicConvert/6a212c90fa5311ea8b9c074232aaccd4/13.slide",
                        width: 1280,
                    },
                },
                {
                    name: "14",
                    ppt: {
                        height: 720,
                        previewURL:
                            "https://convertcdn.netless.link/dynamicConvert/6a212c90fa5311ea8b9c074232aaccd4/preview/14.png",
                        src: "pptx://cover.herewhite.com/dynamicConvert/6a212c90fa5311ea8b9c074232aaccd4/14.slide",
                        width: 1280,
                    },
                },
                {
                    name: "15",
                    ppt: {
                        height: 720,
                        previewURL:
                            "https://convertcdn.netless.link/dynamicConvert/6a212c90fa5311ea8b9c074232aaccd4/preview/15.png",
                        src: "pptx://cover.herewhite.com/dynamicConvert/6a212c90fa5311ea8b9c074232aaccd4/15.slide",
                        width: 1280,
                    },
                },
                {
                    name: "16",
                    ppt: {
                        height: 720,
                        previewURL:
                            "https://convertcdn.netless.link/dynamicConvert/6a212c90fa5311ea8b9c074232aaccd4/preview/16.png",
                        src: "pptx://cover.herewhite.com/dynamicConvert/6a212c90fa5311ea8b9c074232aaccd4/16.slide",
                        width: 1280,
                    },
                },
            ],
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
    })
}