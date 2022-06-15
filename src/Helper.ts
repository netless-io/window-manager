import { getVersionNumber } from "./Utils/Common";
import { REQUIRE_VERSION } from "./constants";
import { WhiteVersion } from "white-web-sdk";
import { WhiteWebSDKInvalidError } from "./Utils/error";
import type { Room , RoomMember} from "white-web-sdk";

export const setupWrapper = (
    root: HTMLElement
): {
    playground: HTMLDivElement;
    mainViewElement: HTMLDivElement;
} => {
    const playground = document.createElement("div");
    playground.className = "netless-window-manager-playground";

    const mainViewElement = document.createElement("div");
    mainViewElement.className = "netless-window-manager-main-view";
    playground.appendChild(mainViewElement);
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
        ...member,
    }));
}
