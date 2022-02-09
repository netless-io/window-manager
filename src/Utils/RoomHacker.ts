import { emitter } from "../index";
import { isPlayer } from "white-web-sdk";
import type { WindowManager } from "../index";
import type { Camera, Room, Player, PlayerSeekingResult } from "white-web-sdk";

// 修改多窗口状态下一些失效的方法实现到 manager 的 mainview 上, 降低迁移成本
export const replaceRoomFunction = (room: Room | Player, manager: WindowManager) => {
    if (isPlayer(room)) {
        const player = room as unknown as Player;
        delegateSeekToProgressTime(player);
    } else {
        room = room as unknown as Room;
        const descriptor = Object.getOwnPropertyDescriptor(room, "disableCameraTransform");
        if (descriptor) return;
        Object.defineProperty(room, "disableCameraTransform", {
            get() {
                return manager.mainView.disableCameraTransform;
            },
            set(disable: boolean) {
                manager.mainView.disableCameraTransform = disable;
            },
        });

        Object.defineProperty(room, "canUndoSteps", {
            get() {
                return manager.mainView.canUndoSteps;
            },
        });

        Object.defineProperty(room, "canRedoSteps", {
            get() {
                return manager.mainView.canRedoSteps;
            },
        });

        room.moveCamera = (camera: Camera) => manager.mainView.moveCamera(camera);
        room.moveCameraToContain = (...args) => manager.moveCameraToContain(...args);
        room.convertToPointInWorld = (...args) => manager.mainView.convertToPointInWorld(...args);
        room.setCameraBound = (...args) => manager.mainView.setCameraBound(...args);
        room.scenePreview = (...args) => manager.mainView.scenePreview(...args);
        room.fillSceneSnapshot = (...args) => manager.mainView.fillSceneSnapshot(...args);
        room.generateScreenshot = (...args) => manager.mainView.generateScreenshot(...args);
        room.setMemberState = (...args) => manager.mainView.setMemberState(...args);
        room.redo = () => manager.redo();
        room.undo = () => manager.undo();
        room.cleanCurrentScene = () => manager.cleanCurrentScene();
        delegateRemoveScenes(room);
    }
};

const delegateRemoveScenes = (room: Room) => {
    const originRemoveScenes = room.removeScenes;
    room.removeScenes = (scenePath: string) => {
        const result = originRemoveScenes.call(room, scenePath);
        emitter.emit("removeScenes", scenePath);
        return result;
    };
};

const delegateSeekToProgressTime = (player: Player) => {
    const originSeek = player.seekToProgressTime;
    // eslint-disable-next-line no-inner-declarations
    async function newSeek(time: number): Promise<PlayerSeekingResult> {
        const seekResult = await originSeek.call(player, time);
        if (seekResult === "success") {
            emitter.emit("seek", time);
        }
        return seekResult;
    }
    player.seekToProgressTime = newSeek;
};
