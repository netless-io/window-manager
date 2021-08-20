import { nanoid } from "nanoid";
import { Room, View, WindowManager } from "./index";

export const genAppId = (kind: string, scenePath?: string) => {
    const impl = WindowManager.appClasses.get(kind);
    if (impl && impl.config?.singleton) {
        return kind;
    }
    if (scenePath) {
        return `${kind}-${scenePath}`;
    } else {
        return `${kind}-${nanoid(8)}`;
    }
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
