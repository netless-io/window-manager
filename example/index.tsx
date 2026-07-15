import React, { useEffect, useState, useRef } from "react";
import ReactDom from "react-dom";
import { LoggerReportMode, PlayerPhase, WhiteWebSdk } from "white-web-sdk";
import { BuiltinApps, WindowManager } from "../dist";
import {
    createStatic,
    createDynamic,
    createHelloWorld,
    createVideo,
    createSlide,
    createCounter,
    createBoard,
    createIframe,
    createPlyr,
    createPresentation,
} from "./apps";
import "../dist/style.css";
import "@netless/appliance-plugin/dist/style.css";
import "./register";
import "./index.css";
import { DefaultHotKeys } from "white-web-sdk";
import {
    customAppContext,
    customAppManager,
    customAppProxy,
    customAttributesDelegate,
    customBoxManager,
    customCursorManager,
    CustomTeleBoxCollector,
    CustomTeleBoxManager,
} from "./extendClass";
import { TeleBoxState } from "@netless/telebox-insider";
import type { AppResult as PlyrAppResult } from "@netless/app-plyr";
import fullWorkerString from "@netless/appliance-plugin/dist/fullWorker.js?raw";
import subWorkerString from "@netless/appliance-plugin/dist/subWorker.js?raw";
import { ApplianceMultiPlugin, AppliancePluginOptions } from "@netless/appliance-plugin";
import foundationWorkerString from "./src/generated/foundation-worker.js?raw";

const apiHosts = import.meta.env.VITE_API_HOSTS?.split(",")
    .map(host => host.trim())
    .filter(Boolean);
const region = import.meta.env.VITE_REGION || "cn-hz";

let foundationWorkerBlobUrl: string | undefined;

function createFoundationLogWorker(): Worker {
    const workerUrl = new URL("/worker/foundation-worker.js", window.location.href).toString();

    try {
        return new Worker(workerUrl);
    } catch (error) {
        console.warn("[local-log] fallback to Blob foundation worker", error);

        if (!foundationWorkerBlobUrl) {
            foundationWorkerBlobUrl = URL.createObjectURL(
                new Blob([foundationWorkerString], { type: "text/javascript" })
            );
        }

        return new Worker(foundationWorkerBlobUrl);
    }
}

const sdk = new WhiteWebSdk({
    appIdentifier: import.meta.env.VITE_APPID,
    region,
    apiHosts,
    useMobXState: true,
    loggerOptions: {
        reportDebugLogMode: LoggerReportMode.AlwaysReport,
        localLog: {
            enabled: true,
            enabledUpload: true,
            createWorker: createFoundationLogWorker,
        },
    },
});

const anyWindow = window as any;

(window as any).WindowManager = WindowManager;
(window as any).whiteWebSdk = sdk;
sdk.onLocalLogStateChange(state => {
    console.log("[local-log] state changed", JSON.stringify(state));
});

let firstPlay = false;

const search = window.location.search;
const url = new URLSearchParams(search);
const isWritable = url.get("isWritable");
const isReplay = url.get("isReplay");
const cursor = url.get("cursor") === "false" ? false : true;

let manager: WindowManager;

const plyrBoxStatusChangeHandler = (playload: { appId: string; status: TeleBoxState }) => {
    console.log("plyrBoxStatusChangeHandler", playload.appId, playload.status);
    const app = manager.queryOne(playload.appId);
    if (app && app.appResult) {
        if (playload.status === "minimized") {
            (app.appResult as PlyrAppResult)?.controller?.pause();
        } else {
            (app.appResult as PlyrAppResult)?.controller?.play();
        }
    }
};

const mountManager = async (room, root) => {
    manager = (await WindowManager.mount(
        {
            room,
            // collectorStyles: { bottom: "100px", left: "30px" },
            containerSizeRatio: 9 / 16,
            chessboard: true,
            // fullscreen: true,
            debug: true,
            cursor,
            useBoxesStatus: true,
            supportAppliancePlugin: true,
            // cursorOptions: { style: "custom" },
            // overwriteStyles: ".netless-window-manager-chess-sizer:before, .netless-window-manager-chess-sizer:after { background-image: none }",
            overwriteStyles: ".cursor-box .cursor-name { display: none !important; }",
        },
        {
            AppContext: customAppContext,
            AppManager: customAppManager,
            AppProxy: customAppProxy,
            BoxManager: customBoxManager,
            AttributesDelegate: customAttributesDelegate,
            CursorManager: customCursorManager,
            TeleBoxManager: CustomTeleBoxManager,
            TeleBoxCollector: CustomTeleBoxCollector,
        }
    )) as WindowManager;
    const fullWorkerBlob = new Blob([fullWorkerString], {
        type: "text/javascript",
      });
      const fullWorkerUrl = URL.createObjectURL(fullWorkerBlob);
      const subWorkerBlob = new Blob([subWorkerString], {
        type: "text/javascript",
      });
      const subWorkerUrl = URL.createObjectURL(subWorkerBlob);
  
      const pluginOptions: AppliancePluginOptions = {
        cdn: {
          fullWorkerUrl,
          subWorkerUrl,
        },
        extras: {
          useSimple: true,
          // canvasOpt: {
          //   contextType: "2d",
          // },
          cursor: {
            enable: true,
            expirationTime: 10000,
            moveDelayTime: 20,
          },
          syncOpt: {
            interval: 100,
            smoothSync: false,
          },
          bezier: {
            enable: false,
            maxDrawCount: 180,
          },
          textEditor: {
            showFloatBar: false,
            canSelectorSwitch: false,
            rightBoundBreak: true,
            // extendFontFaces: [{fontFamily: "Pacifico", src: "https://fonts.gstatic.com/s/pacifico/v17/FwZY7-Qmy14u9lezJ-6H6MmBp0u-.woff2"}]
            extendFontFaces: [
              {
                fontFamily: "Noto Sans SC",
                src: "https://fonts.gstatic.com/s/opensans/v44/memvYaGs126MiZpBA-UvWbX2vVnXBbObj2OVTS-mu0SC55I.woff2",
              },
            ],
            loadFontFacesTimeout: 20000,
          },
          longDottedStroke: {
            lineCap: "square",
            segment: 4,
            gap: 2,
          },
        },
      };
      const plugin = await ApplianceMultiPlugin.getInstance(manager as any, {
        options: pluginOptions,
      });

    manager.emitter.on("onAppSetup", appId => {
        console.log("onAppSetup", appId);
        const app = manager.queryOne(appId);
        if (app.kind === "Plyr") {
            app.appContext.emitter.on("boxStatusChange", plyrBoxStatusChangeHandler);
            app.appContext.emitter.on("destroy", () => {
                console.log("destroy", appId);
                app.appContext.emitter.off("boxStatusChange", plyrBoxStatusChangeHandler);
            });
        }
    });

    manager.emitter.on("ready", async () => {
        if (isWritable === "false") {
            manager.setViewMode("freedom" as any);
        }
    });

    manager.bindContainer(root);

    console.log("manager apps", manager.queryAll());
    console.log("manager mounted boxState:", manager.boxState);
    (window as any).manager = manager;
    (window as any).appliancePlugin = plugin;
    manager.onAppDestroy(BuiltinApps.DocsViewer, error => {
        console.log("onAppDestroy", error);
    });

    manager.onAppEvent(BuiltinApps.DocsViewer, event => {
        console.log("onAppEvent", event);
    });

    manager.onAppEvent("Board", event => {
        console.log("onAppEvent", event);
    });

    manager.emitter.on("mainViewModeChange", mode => {
        console.log("mode", mode);
    });

    manager.emitter.on("boxStateChange", state => {
        console.log("boxStateChange:", state);
    });

    manager.emitter.on("fullscreenChange", state => {
        console.log("fullscreenChange:", state);
    });

    manager.emitter.on("appsChange", apps => {
        console.log("appsChange:", apps);
    });

    manager.emitter.on("mainViewScenePathChange", path => {
        console.log("mainViewScenePathChange", path);
    });
    manager.emitter.on("mainViewSceneIndexChange", index => {
        console.log("mainViewSceneIndexChange", index);
    });
    manager.emitter.on("focusedChange", focus => {
        console.log("focusedChange", focus);
    });
    manager.emitter.on("mainViewScenesLengthChange", length => {
        console.log("mainViewScenesLengthChange", length);
    });
    manager.emitter.on("canRedoStepsChange", steps => {
        console.log("canRedoStepsChange", steps);
    });
    manager.emitter.on("canUndoStepsChange", steps => {
        console.log("canUndoStepsChange", steps);
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    manager.emitter.on("cameraStateChange", state => {
        console.log("cameraStateChange", state);
    });

    manager.emitter.on("sceneStateChange", state => {
        console.log("sceneStateChange", state);
    });

    manager.emitter.on("loadApp", payload => {
        console.log("loadApp", payload);
    });

    manager.emitter.on("pageStateChange", state => {
        console.log("pageStateChange", state);
    });
    manager.mainView.callbacks.on("onCameraUpdated", ()=>{
        console.log("onCameraUpdated====>", manager.mainView.camera);
    });
    manager.mainView.callbacks.on("onSizeUpdated", ()=>{
        console.log("onSizeUpdated====>", manager.mainView.size);
    });
};

const replay = () => {
    sdk.replayRoom({
        room: import.meta.env.VITE_ROOM_UUID,
        roomToken: import.meta.env.VITE_ROOM_TOKEN,
        region,
        invisiblePlugins: [WindowManager as any, ApplianceMultiPlugin],
        useMultiViews: true,
    }).then(async player => {
        await manager?.destroy();
        anyWindow.room?.disconnect();
        setTimeout(async () => {
            anyWindow.player = player;
            // player.bindHtmlElement(document.getElementById("container") as any)
            player.play();
        }, 500);
        player.callbacks.on("onPhaseChanged", phase => {
            if (phase === PlayerPhase.Playing) {
                if (firstPlay) return;
                setTimeout(() => {
                    mountManager(player, document.getElementById("container"));
                }, 1000);
                firstPlay = true;
            }
        });
    });
};

const joinRoom = ref => {
    const uid = Math.random().toString().substr(3, 8);
    if (isReplay) {
        replay();
    } else {
        return sdk
            .joinRoom({
                uuid: import.meta.env.VITE_ROOM_UUID,
                roomToken: import.meta.env.VITE_ROOM_TOKEN,
                region,
                invisiblePlugins: [WindowManager, ApplianceMultiPlugin],
                useMultiViews: true,
                userPayload: {
                    userId: "111",
                    cursorName: uid,
                    avatar: "https://avatars.githubusercontent.com/u/8299540?s=60&v=4",
                },
                isWritable: !(isWritable === "false"),
                // cursorAdapter: undefined,
                uid: uid,
                disableMagixEventDispatchLimit: true,
                disableNewPencil: false,
                floatBar: true,
                hotKeys: {
                    ...DefaultHotKeys,
                    changeToClick: "c",
                    changeToSelector: "s",
                    changeToPencil: "p",
                    changeToEraser: "e",
                },
            })
            .then(async room => {
                (window as any).room = room;
                console.log("[local-log] initial state", JSON.stringify(sdk.getLocalLogState()));
                room.syncMode=true;
                return await mountManager(room, ref);
            });
    }
};

const destroy = () => {
    manager.destroy();
    manager = undefined;
};

anyWindow.mountManager = mountManager;
anyWindow.destroy = destroy;

const prevPage = (manager: WindowManager) => {
    manager.prevPage();
};

const nextPage = (manager: WindowManager) => {
    manager.nextPage();
};

const addPage = (manager: WindowManager) => manager.addPage();

const cleanCurrentScene = (manager: WindowManager) => {
    manager.cleanCurrentScene();
};

const serializeError = (error: unknown) => {
    if (error instanceof Error) {
        return {
            name: error.name,
            message: error.message,
            stack: error.stack,
        };
    }
    return {
        message: String(error),
    };
};

const serializeLocalLogResult = result => {
    if (result?.status !== "failure") {
        return result;
    }
    return {
        ...result,
        error: serializeError(result.error),
    };
};

const describeLocalLogResult = result => {
    if (result.status === "success") {
        return `上传成功，文件 ${result.fileSize} bytes`;
    }
    if (result.status === "skipped") {
        return `未上传：${result.reason}${result.fileSize === undefined ? "" : `，文件 ${result.fileSize} bytes`}`;
    }
    return `上传失败：${result.stage}，${result.error?.message || "unknown error"}`;
};

const collectLocalLogs = async () => {
    const result = await sdk.collectLocalLogs();
    const summary = {
        labels: result.labels,
        fileName: result.file.name,
        fileSize: result.file.size,
        byteLength: result.byteLength,
    };
    console.log("[local-log] collect result", JSON.stringify(summary));
    return summary;
};

const uploadLocalLogs = async (onStatus?: (status: string) => void) => {
    onStatus?.("正在上传...");
    const room = anyWindow.room;
    try {
        const result = room && typeof room.uploadLocalLogs === "function" ?
            await room.uploadLocalLogs() :
            await sdk.uploadLocalLogs({
                roomUuid: import.meta.env.VITE_ROOM_UUID,
                userUuid: "window-manager-example",
                trigger: "manual",
            });
        const serializable = serializeLocalLogResult(result);

        console.log("[local-log] upload result", JSON.stringify(serializable));
        onStatus?.(describeLocalLogResult(result));
        return result;
    } catch (error) {
        const serializable = serializeError(error);

        console.error("[local-log] upload thrown", serializable);
        onStatus?.(`上传异常：${serializable.message}`);
        throw error;
    }
};

anyWindow.collectWhiteboardLocalLogs = collectLocalLogs;
anyWindow.getWhiteboardLocalLogState = () => sdk.getLocalLogState();
anyWindow.flushWhiteboardLocalLogs = () => sdk.flushLocalLogs();
anyWindow.uploadWhiteboardLocalLogs = () => uploadLocalLogs();

const App = () => {
    const [pageState, setPageState] = useState({});
    const [localLogStatus, setLocalLogStatus] = useState("日志待上传");
    const ref = useRef();

    useEffect(() => {
        joinRoom(ref.current).then(() => {
            if (manager) {
                setPageState(manager.pageState);
                // createIframe(manager);
                return manager.emitter.on("pageStateChange", state => {
                    setPageState(state);
                });
            }
        });
    }, [ref]);

    return (
        <div className="app">
            <div
                ref={ref}
                id="container"
                style={{
                    flex: 1,
                    height: "calc(100vh - 32px)",
                    border: "1px solid",
                    resize: "auto",
                    overflow: "scroll",
                }}
            ></div>
            <div className="side">
                <button className="side-button" onClick={() => createPlyr(manager)}>
                    Plyr
                </button>
                <button className="side-button" onClick={() => createPresentation(manager)}>
                    Presentation
                </button>
                <button className="side-button" onClick={() => createHelloWorld(manager)}>
                    Hello World
                </button>
                <button className="side-button" onClick={() => createCounter(manager)}>
                    Counter
                </button>
                <button className="side-button" onClick={() => createBoard(manager)}>
                    Board
                </button>
                <button className="side-button" onClick={() => createStatic(manager)}>
                    课件 static
                </button>
                <button className="side-button" onClick={() => createDynamic(manager)}>
                    课件 dynamic
                </button>
                <button className="side-button" onClick={() => createSlide(manager)}>
                    Slide
                </button>
                <button className="side-button" onClick={() => createVideo(manager)}>
                    视频
                </button>
                <button className="side-button" onClick={() => createIframe(manager)}>
                    Iframe Bridge
                </button>
                <button className="side-button" onClick={replay}>
                    回放
                </button>
                <button className="side-button" onClick={() => prevPage(manager)}>
                    上一页
                </button>
                <button className="side-button" onClick={() => nextPage(manager)}>
                    下一页
                </button>
                <button className="side-button" onClick={() => addPage(manager)}>
                    加一页
                </button>
                <button className="side-button" onClick={() => cleanCurrentScene(manager)}>
                    清屏
                </button>
                <button className="side-button" onClick={() => uploadLocalLogs(setLocalLogStatus)}>
                    上传日志
                </button>
                <div className="local-log-status">{localLogStatus}</div>
                <span>
                    {pageState.index}/{pageState.length}
                </span>
            </div>
        </div>
    );
};

ReactDom.render(<App />, document.getElementById("root"));
