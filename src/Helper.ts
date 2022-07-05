import { getVersionNumber, wait } from "./Utils/Common";
import { log } from "./Utils/log";
import { REQUIRE_VERSION } from "./constants";
import { toJS, WhiteVersion } from "white-web-sdk";
import { WhiteWebSDKInvalidError } from "./Utils/error";
import { WindowManager } from "./index";
import type { Room, RoomMember } from "white-web-sdk";

export const setupWrapper = (
    root: HTMLElement,
    target: HTMLElement
): {
    playground: HTMLDivElement;
    mainViewElement: HTMLDivElement;
} => {
    const playground = document.createElement("div");
    playground.className = "netless-window-manager-playground";

    const mainViewElement = document.createElement("div");
    mainViewElement.className = "netless-window-manager-main-view";
    target.appendChild(mainViewElement);
    root.appendChild(playground);

    return { playground, mainViewElement };
};

export const checkVersion = () => {
    const version = getVersionNumber(WhiteVersion);
    if (version < getVersionNumber(REQUIRE_VERSION)) {
        throw new WhiteWebSDKInvalidError(REQUIRE_VERSION);
    }
};

export const findMemberByUid = (room: Room | undefined, uid: string) => {
    const roomMembers = room?.state.roomMembers;
    return roomMembers?.find(member => member.payload?.uid === uid);
};

export type Member = RoomMember & { uid: string };

export const serializeRoomMembers = (members: readonly RoomMember[]) => {
    return members.map(member => ({
        uid: member.payload?.uid || "",
        ...toJS(member),
    }));
};

export const createInvisiblePlugin = async (room: Room) => {
    try {
        const manager = (await room.createInvisiblePlugin(WindowManager, {})) as WindowManager;
        return manager;
    } catch (error) {
        // 如果有两个用户同时调用 WindowManager.mount 有概率出现这个错误
        if (error.message === `invisible plugin "WindowManager" exits`) {
            await wait(200);
            return room.getInvisiblePlugin(WindowManager.kind) as WindowManager;
        } else {
            log("createInvisiblePlugin failed", error);
        }
    }
};
