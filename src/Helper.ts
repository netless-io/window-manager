import { getVersionNumber } from "./Utils/Common";
import { REQUIRE_VERSION } from "./constants";
import { WhiteVersion } from "white-web-sdk";
import { WhiteWebSDKInvalidError } from "./Utils/error";
import { WindowManager } from "./index";
import type { Room } from "white-web-sdk";

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
    const roomMembers = room?.state.roomMembers;
    return roomMembers?.find(member => member.payload?.uid === uid);
};
