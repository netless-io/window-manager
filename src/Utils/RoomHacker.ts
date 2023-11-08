import { internalEmitter } from "../InternalEmitter";
import { isPlayer } from "white-web-sdk";
import type { WindowManager } from "../index";
import type { Camera, Room, Player, PlayerSeekingResult } from "white-web-sdk";
import { ROOT_DIR } from "../constants";

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
                return manager.canUndoSteps;
            },
        });

        Object.defineProperty(room, "canRedoSteps", {
            get() {
                return manager.canRedoSteps;
            },
        });

        room.moveCamera = (camera: Camera) => manager.moveCamera(camera);
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
        room.delete = () => manager.delete();
        room.copy = () => manager.copy();
        room.paste = () => manager.paste();
        room.duplicate = () => manager.duplicate();
        room.insertImage = (...args) => manager.insertImage(...args);
        room.completeImageUpload = (...args) => manager.completeImageUpload(...args);
        room.insertText = (...args) => manager.insertText(...args);
        room.lockImage = (...args) => manager.lockImage(...args);
        room.lockImages = (...args) => manager.lockImages(...args);

        delegateRemoveScenes(room, manager);
    }
};

const delegateRemoveScenes = (room: Room, manager: WindowManager) => {
    const originRemoveScenes = room.removeScenes;
    room.removeScenes = (scenePath: string, index?: number) => {
        if (scenePath === ROOT_DIR) {
            manager.appManager?.updateRootDirRemoving(true);
        }
        const result = originRemoveScenes.call(room, scenePath);
        internalEmitter.emit("removeScenes", { scenePath, index });
        return result;
    };
};

const delegateSeekToProgressTime = (player: Player) => {
    const originSeek = player.seekToProgressTime;
    // eslint-disable-next-line no-inner-declarations
    async function newSeek(time: number): Promise<PlayerSeekingResult> {
        // seek 时需要先关闭所有的 app 防止内部使用的 mobx 出现错误
        await internalEmitter.emit("seekStart");
        const seekResult = await originSeek.call(player, time);
        internalEmitter.emit("seek", time); 
        return seekResult;
    }
    player.seekToProgressTime = newSeek;
};
