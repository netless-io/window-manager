import { Room, RoomPhase } from "white-web-sdk";
import { ReconnectRefresher } from "../src/ReconnectRefresher";

describe("ReconnectRefresher", () => {
    let listener: any = {};
    const on = jest.fn().mockImplementation((event: string, callback: Function) => {
        listener[event] = callback;
    });
    const room = {
        phase: RoomPhase.Connected,
        callbacks: {
            on: on,
            emit: jest.fn().mockImplementation((event, phase) => {
                if (event === "onPhaseChanged") {
                    listener[event](phase);
                }
            }),
            off: (eventName: string) => {
                delete listener[eventName];
            }
        }
    } as unknown as Room;
    const notify = jest.fn();

    afterEach(() => {
        jest.clearAllMocks();
        listener = {};
    });

    const setup = () => {
        const refresher = new ReconnectRefresher(room, notify);
        const disposer = jest.fn();
        const reactor = jest.fn().mockReturnValue(disposer);
        return { refresher, reactor, disposer };
    }

    test("constructor", () => {
        const refresher = new ReconnectRefresher(room, notify);
        expect(refresher).toBeTruthy();
        expect(room.callbacks.on).toBeCalledWith("onPhaseChanged", expect.any(Function));
    });

    it("should has refresher", () => {
        const { refresher, reactor, disposer } = setup();
        refresher.add("test", reactor);
        expect(reactor).toBeCalledTimes(1);
        (room.callbacks as any).emit("onPhaseChanged", RoomPhase.Reconnecting);
        (room.callbacks as any).emit("onPhaseChanged", RoomPhase.Connected);
        expect(reactor).toBeCalledTimes(2);
        expect(disposer).toBeCalledTimes(1);
    });

    it("should remove reactor", () => {
        const { refresher, reactor, disposer } = setup();
        refresher.add("test", reactor);
        expect(reactor).toBeCalledTimes(1);
        expect(disposer).toBeCalledTimes(0);

        (room.callbacks as any).emit("onPhaseChanged", RoomPhase.Reconnecting);
        (room.callbacks as any).emit("onPhaseChanged", RoomPhase.Connected);
        expect(reactor).toBeCalledTimes(2);
        expect(disposer).toBeCalledTimes(1);

        refresher.remove("test");
        (room.callbacks as any).emit("onPhaseChanged", RoomPhase.Reconnecting);
        (room.callbacks as any).emit("onPhaseChanged", RoomPhase.Connected);
        expect(reactor).toBeCalledTimes(2);
        expect(disposer).toBeCalledTimes(2);
    });

    it("should destroy", () => {
        const { refresher, reactor, disposer } = setup();
        refresher.add("test", reactor);

        expect(Object.keys(listener).length).toBe(1);
        expect(reactor).toBeCalledTimes(1);
        expect(disposer).toBeCalledTimes(0);

        refresher.destroy();
        expect(reactor).toBeCalledTimes(1);
        expect(disposer).toBeCalledTimes(1);
        expect(Object.keys(listener).length).toBe(0);
    });
})
