import {
    AppEmitterEvent,
    emitter,
    PublicEvent,
    Room,
    View,
    WindowManager
    } from './index';
import { nanoid } from 'nanoid';
import { Displayer, ViewVisionMode } from 'white-web-sdk';
import { debounce } from "lodash-es";
import Emittery from 'emittery';

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

export const notifyMainViewModeChange = debounce((callbacks: Emittery<PublicEvent>, mode: ViewVisionMode) => {
    callbacks.emit("mainViewModeChange", mode);
}, 200);

export const makeValidScenePath = (displayer: Displayer, scenePath: string) => {
    const scenes = displayer.entireScenes()[scenePath];
    const firstSceneName = scenes[0].name;
    if (scenePath === "/") {
        return `/${firstSceneName}`;
    } else {
        return `${scenePath}/${firstSceneName}`;
    }
}
