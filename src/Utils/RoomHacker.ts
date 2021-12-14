import { emitter } from '../index';
import { isPlayer } from 'white-web-sdk';
import type { Camera, Room , Player , PlayerSeekingResult } from "white-web-sdk";
import type { AppManager } from "../AppManager";

// 修改多窗口状态下一些失效的方法实现到 manager 的 mainview 上, 降低迁移成本
export const replaceRoomFunction = (room: Room, manager: AppManager) => {
    if (isPlayer(room)) {
        const player = room as unknown as Player;
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
    } else {
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

        room.moveCamera = (camera: Camera) => manager.mainView.moveCamera(camera);
        room.moveCameraToContain = (...args) => manager.mainView.moveCameraToContain(...args);
        room.convertToPointInWorld = (...args) => manager.mainView.convertToPointInWorld(...args);
        room.setCameraBound = (...args) => manager.mainView.setCameraBound(...args);
        room.scenePreview = (...args) => manager.mainView.scenePreview(...args);
        room.fillSceneSnapshot = (...args) => manager.mainView.fillSceneSnapshot(...args);
        room.generateScreenshot = (...args) => manager.mainView.generateScreenshot(...args);
    }

};