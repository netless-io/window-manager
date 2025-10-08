import { WindowManager } from "../dist";
import "./app/helloworld-app";
import "./app/counter";
import { Board } from "./app/board";

WindowManager.register({
    kind: "Slide",
    appOptions: {
        // turn on to show debug controller
        debug: false,
    },
    src: (async () => {
        const app = await import("@netless/app-slide");
        return app.default ?? app;
    }) as any,
});

WindowManager.register({
    kind: "Monaco",
    src: "https://netless-app.oss-cn-hangzhou.aliyuncs.com/@netless/app-monaco/0.1.12/dist/main.iife.js",
});

WindowManager.register({
    kind: "GeoGebra",
    src: "https://netless-app.oss-cn-hangzhou.aliyuncs.com/@netless/app-geogebra/0.0.4/dist/main.iife.js",
    appOptions: {
        HTML5Codebase: "https://flat-storage-cn-hz.whiteboard.agora.io/GeoGebra/HTML5/5.0/web3d",
    },
});

WindowManager.register({
    kind: "Countdown",
    src: "https://netless-app.oss-cn-hangzhou.aliyuncs.com/@netless/app-countdown/0.0.2/dist/main.iife.js",
});

WindowManager.register({
    kind: "Board",
    src: Board,
});

WindowManager.register({
    kind: "Plyr",
    src: () => import("@netless/app-plyr")
});