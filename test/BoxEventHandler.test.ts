import { BoxEventHandler, BoxEventHandlerContext } from "../src/BoxEventHandler";

describe("BoxEventHandler", () => {
    let callbacks: any[] = [];
    const emitter = {
        onAny: jest.fn().mockImplementation((cb) => {
            callbacks.push(cb);
        }),
        offAny: jest.fn(),
    }

    const context = {
        emitter,
        updateAppState: jest.fn(),
        dispatchMagixEvent: jest.fn(),
        safeSetAttributes: jest.fn(),
        closeApp: jest.fn(),
    } as unknown as BoxEventHandlerContext;

    beforeEach(() => {
        jest.clearAllMocks();
        callbacks = [];
    });

    it("should be defined", () => {
        const handler = new BoxEventHandler(context);
        
        expect(handler).toBeDefined();
        expect(emitter.onAny).toHaveBeenCalledTimes(1);
    });

    it("should destroy", () => {
        const handler = new BoxEventHandler(context);

        expect(handler).toBeDefined();
        expect(emitter.onAny).toHaveBeenCalledTimes(1);
        handler.destroy();
        expect(emitter.offAny).toHaveBeenCalledTimes(1);
    });

    it("should move app", () => {
        new BoxEventHandler(context);

        callbacks.forEach((cb) => {
            cb("move", { appId: "appId", position: { x: 0, y: 0 } });
        });

        expect(context.dispatchMagixEvent).toHaveBeenCalledTimes(1);
        expect(context.updateAppState).toHaveBeenCalledTimes(1);
    })
});
