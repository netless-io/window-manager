import { getVersionNumber, wait } from "./Utils/Common";
import { log } from "./Utils/log";
import { REQUIRE_VERSION } from "./constants";
import type { Room, RoomMember } from "white-web-sdk";
import { WhiteVersion } from "white-web-sdk";
import { WhiteWebSDKInvalidError } from "./Utils/error";
import { WindowManager } from "./index";

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

export const checkVersion = () => {
    const version = getVersionNumber(WhiteVersion);
    if (version < getVersionNumber(REQUIRE_VERSION)) {
        throw new WhiteWebSDKInvalidError(REQUIRE_VERSION);
    }
};

export const findMemberByUid = (room: Room | undefined, uid: string) => {
    const roomMembers = room?.state.roomMembers || [];
    let maxMemberId = -1; // 第一个进入房间的用户 memberId 是 0
    let result: RoomMember | undefined = undefined;
    for (const member of roomMembers) {
        if (member.payload?.uid === uid && maxMemberId < member.memberId) {
            maxMemberId = member.memberId;
            result = member;
        }
    }
    return result;
}

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
