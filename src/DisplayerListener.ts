import { emitter } from "./index";
import { isPlayer, isRoom } from "white-web-sdk";
import { SideEffectManager } from "side-effect-manager";
import type { Displayer, DisplayerState, Player, Room } from "white-web-sdk";

export class DisplayerListener {
    private sideEffectManager = new SideEffectManager();

    constructor(private displayer: Displayer) {
        this.sideEffectManager.add(() => {
            if (isRoom(this.displayer)) {
                const room = this.displayer as Room;
                room.callbacks.on("onRoomStateChanged", this.stateListener);
                return () => {
                    room.callbacks.off("onRoomStateChanged", this.stateListener);
                };
            } else if (isPlayer(this.displayer)) {
                const player = this.displayer as Player;
                player.callbacks.on("onPlayerStateChanged", this.stateListener);
                return () => {
                    player.callbacks.off("onPlayerStateChanged", this.stateListener);
                };
            } else {
                // eslint-disable-next-line @typescript-eslint/no-empty-function
                return () => {}; // do nothing
            }
        });
    }

    private stateListener = (state: Partial<DisplayerState>) => {
        if (state.roomMembers) {
            emitter.emit("roomMembersChange", state.roomMembers);
        }
        emitter.emit("roomStateChange", state);
        emitter.emit("observerIdChange", this.displayer.observerId);
    };

    public destroy() {
        this.sideEffectManager.flushAll();
    }
}
