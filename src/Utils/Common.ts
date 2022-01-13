import { appRegister } from "../Register";
import { debounce } from "lodash";
import { emitter } from "../index";
import { ScenePathType } from "white-web-sdk";
import { v4 } from "uuid";
import type { PublicEvent } from "../index";
import type { Displayer, ViewVisionMode, Room, View } from "white-web-sdk";
import type Emittery from "emittery";

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
        return view;
    }
};

export const setViewSceneIndex = (view: View, index: number) => {
    if (view.focusSceneIndex !== index) {
        view.focusSceneIndex = index;
        return view;
    }
};

export const setScenePath = (room: Room | undefined, scenePath: string) => {
    if (room && room.isWritable) {
        if (room.state.sceneState.scenePath !== scenePath) {
            room.setScenePath(scenePath);
        }
    }
};

export const getScenePath = (
    room: Room | undefined,
    dir: string | undefined,
    index: number
): string | undefined => {
    if (room && dir) {
        const scenes = entireScenes(room);
        const scene = scenes[dir]?.[index];
        if (scene) {
            return `${dir}/${scene.name}`;
        }
    }
};

export const removeScenes = (room: Room | undefined, scenePath: string) => {
    if (room) {
        const type = room.scenePathType(scenePath);
        if (type !== ScenePathType.None) {
            room.removeScenes(scenePath);
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

export const notifyMainViewModeChange = debounce(
    (callbacks: Emittery<PublicEvent>, mode: ViewVisionMode) => {
        callbacks.emit("mainViewModeChange", mode);
    },
    200
);

export const makeValidScenePath = (displayer: Displayer, scenePath: string, index = 0) => {
    const scenes = entireScenes(displayer)[scenePath];
    if (!scenes) return;
    const scene = scenes[index];
    if (!scene) return;
    const firstSceneName = scene.name;
    if (scenePath === "/") {
        return `/${firstSceneName}`;
    } else {
        return `${scenePath}/${firstSceneName}`;
    }
};

export const entireScenes = (displayer: Displayer) => {
    return displayer.entireScenes();
};

export const isValidScenePath = (scenePath: string) => {
    return scenePath.startsWith("/");
};

export const parseSceneDir = (scenePath: string) => {
    const sceneList = scenePath.split("/");
    sceneList.pop();
    let sceneDir = sceneList.join("/");
    // "/page1" 的 dir 为 "/"
    if (sceneDir === "") {
        sceneDir = "/";
    }
    return sceneDir;
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

export const wait = (time: number) => new Promise(resolve => setTimeout(resolve, time));
