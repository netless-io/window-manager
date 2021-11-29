import { WindowManager } from "../src";
import { AppManager } from "../src/AppManager";

describe("AppManager", () => {
    const windowManager = {
        displayer: {
            addMagixEventListener: jest.fn(),
        },
        attributes: {},
        canOperate: true,
        setAttributes: jest.fn().mockImplementation((attributes) => {
            Object.assign(windowManager.attributes, attributes);
        }),
        safeSetAttributes: jest.fn().mockImplementation((attributes) => {
            windowManager.setAttributes(attributes);
        }),
    } as unknown as WindowManager;

    WindowManager.wrapper = document.body;

    it("constructor", () => {
        const manager = new AppManager(windowManager, {});
        expect(manager).toBeDefined();
        expect(manager.displayer.addMagixEventListener).toBeCalled();
    });

    it("safeSetAttributes", () => {
        const manager = new AppManager(windowManager, {});
        const state = { a: 1 };
        manager.safeSetAttributes({ state });

        expect(windowManager.setAttributes).toBeCalledWith({ state });
        expect(windowManager.attributes.state).toEqual(state);
    });
});
