import { Room, RoomPhase } from "white-web-sdk";
import { ReconnectRefresher } from "../src/ReconnectRefresher";

describe("ReconnectRefresher", () => {
    const room = {
        phase: RoomPhase.Connected,
        callbacks: {
            on: jest.fn()
        }
    } as unknown as Room;
    const notify = jest.fn();

    afterEach(() => {
        jest.clearAllMocks();
    });

    it("constructor", () => {
        const refresher = new ReconnectRefresher(room, notify);
        expect(refresher).toBeTruthy();
        expect(room.callbacks.on).toBeCalledWith("onPhaseChanged", expect.any(Function));
    });

    it("should has refresher", () => {
        const refresher = new ReconnectRefresher(room, notify);
        const reactor = jest.fn();
        refresher.add("test", reactor);
        room.callbacks.on
    })
})
