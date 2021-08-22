import { nanoid } from "nanoid";
import { ViewVisionMode } from "white-web-sdk";
import { emitter, Room, View, WindowManager } from "./index";

export const genAppId = (kind: string) => {
    const impl = WindowManager.appClasses.get(kind);
    if (impl && impl.config?.singleton) {
        return kind;
    }
    return `${kind}-${nanoid(8)}`;
}

export const setViewFocusScenePath = (view: View, focusScenePath: string) => {
    if (view.focusScenePath !== focusScenePath) {
        view.focusScenePath = focusScenePath;
    }
}

export const setScenePath = (room: Room | undefined, scenePath: string) => {
    if (room) {
        if (room.state.sceneState.scenePath !== scenePath) {
            room.setScenePath(scenePath);
        }
    }
}

export const setViewMode = (view: View, mode: ViewVisionMode) => {
    if (view.mode !== mode) {
        view.mode = mode;
    }
}

export const emittError = (error: Error) => {
    if (emitter.listenerCount("error") > 0) {
        emitter.emit("error", error);
    } else {
        console.log("[WindowManager]:", error);
    }
}
