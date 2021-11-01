import { isPlayer } from 'white-web-sdk';
import type { Camera, Room , Player } from "white-web-sdk";
import type { AppManager } from "../AppManager";
import { emitter } from "../index";

// 修改多窗口状态下一些失效的方法实现到 manager 的 mainview 上, 降低迁移成本
export const replaceRoomFunction = (room: Room, manager: AppManager) => {
    if (isPlayer(room)) {
        const player = room as unknown as Player;
        const originSeek = player.seekToProgressTime;
        // eslint-disable-next-line no-inner-declarations
        function newSeek(time: number) {
            originSeek.call(player, time);
            emitter.emit("seek", time);
        }
        player.seekToProgressTime = newSeek as any;
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
    }

};