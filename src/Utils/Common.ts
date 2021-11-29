import { appRegister } from "../Register";
import { emitter, WindowManager } from "../index";
import { v4 } from "uuid";
import type { Displayer, ViewVisionMode, View, Room, SceneDefinition } from "white-web-sdk";

export const genAppId = async (kind: string) => {
    const impl = await appRegister.appClasses.get(kind)?.();
    if (impl && impl.config?.singleton) {
        return kind;
    }
    return `${kind}-${v4().replace("-", "").slice(0, 8)}`;
};

export const setViewFocusScenePath = (view: View, focusScenePath: string) => {
    if (view.focusScenePath !== focusScenePath) {
        view.focusScenePath = focusScenePath;
    }
};

export const getScenePath = (
    room: Room | undefined,
    dir: string | undefined,
    index: number
): string | undefined => {
    if (room && dir) {
        const scenes = room.entireScenes();
        const scene = scenes[dir]?.[index];
        if (scene) {
            return `${dir}/${scene.name}`;
        }
    }
};

export const setViewMode = (view: View, mode: ViewVisionMode) => {
    if (!(view as any).didRelease && view.mode !== mode) {
        view.mode = mode;
    }
};

export const emitError = (error: Error) => {
    if (emitter.listenerCount("error") > 0) {
        emitter.emit("error", error);
    } else {
        console.log("[WindowManager]:", error);
    }
};

export const addEmitterOnceListener = (event: any, listener: any) => {
    emitter.once(event).then(listener);
};

export const makeValidScenePath = (displayer: Displayer, scenePath: string, index = 0) => {
    const scenes = displayer.entireScenes()[scenePath];
    if (!scenes) return;
    const firstSceneName = scenes[index].name;
    if (scenePath === "/") {
        return `/${firstSceneName}`;
    } else {
        return `${scenePath}/${firstSceneName}`;
    }
};

export const isValidScenePath = (scenePath: string) => {
    return scenePath.startsWith("/");
};

export const ensureValidScenePath = (scenePath: string) => {
    if (scenePath.endsWith("/")) {
        return scenePath.slice(0, -1);
    } else {
        return scenePath;
    }
};

export const getVersionNumber = (version: string) => {
    const versionString = version
        .split(".")
        .map(s => s.padStart(2, "0"))
        .join("");
    return parseInt(versionString);
};

export const checkIsDynamicPPT = (scenes: SceneDefinition[]) => {
    const sceneSrc = scenes[0]?.ppt?.src;
    return sceneSrc?.startsWith("pptx://");
};

export const wait = (time: number) => new Promise(resolve => setTimeout(resolve, time));

export const setupWrapper = (
    root: HTMLElement
): {
    playground: HTMLDivElement;
    wrapper: HTMLDivElement;
    sizer: HTMLDivElement;
    mainViewElement: HTMLDivElement;
} => {
    const playground = document.createElement("div");
    playground.className = "netless-window-manager-playground";

    const sizer = document.createElement("div");
    sizer.className = "netless-window-manager-sizer";

    const wrapper = document.createElement("div");
    wrapper.className = "netless-window-manager-wrapper";

    const mainViewElement = document.createElement("div");
    mainViewElement.className = "netless-window-manager-main-view";

    playground.appendChild(sizer);
    sizer.appendChild(wrapper);
    wrapper.appendChild(mainViewElement);
    root.appendChild(playground);
    WindowManager.wrapper = wrapper;

    return { playground, wrapper, sizer, mainViewElement };
};
