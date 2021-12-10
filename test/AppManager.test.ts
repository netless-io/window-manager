import { setWith } from "lodash";
import { WindowManager } from "../src";
import { AppManager } from "../src/AppManager";
import { AppProxy, Creator, initCreator } from "../src/App";

describe("AppManager", () => {
    let appRegister;

    beforeAll(async () => {
        const AppRegister = await import("../src/Register");
        appRegister = AppRegister.appRegister;
        const HelloWorldApp = async () => {
            return {
                kind: "test",
                setup: () => {
                    return "Hello World Result";
                }
            }
        };
        appRegister.register({ kind: "test", src: HelloWorldApp });
    })

    const windowManager = {
        displayer: {
            addMagixEventListener: jest.fn(),
            dispatchMagixEvent: jest.fn(),
        },
        attributes: {},
        canOperate: true,
        setAttributes: jest.fn().mockImplementation((attributes) => {
            Object.assign(windowManager.attributes, attributes);
        }),
        safeSetAttributes: jest.fn().mockImplementation((attributes) => {
            windowManager.setAttributes(attributes);
        }),
        updateAttributes: jest.fn().mockImplementation((keys, value) => {
            setWith(windowManager.attributes, keys, value);
        }),
        safeUpdateAttributes: jest.fn().mockImplementation((keys: string, value: any) => {
            windowManager.updateAttributes(keys, value);
        })
    } as unknown as WindowManager;

    WindowManager.wrapper = document.body;

    beforeEach(() => {
        jest.clearAllMocks();
        (windowManager as any).attributes = {};
        document.body.innerHTML = "";
    });

    test("constructor", () => {
        const manager = new AppManager(windowManager, {});
        expect(manager).toBeDefined();
        expect(manager.displayer.addMagixEventListener).toBeCalled();
    });

    test("safeSetAttributes", () => {
        const manager = new AppManager(windowManager, {});
        const state = { a: 1 };
        manager.safeSetAttributes({ state });

        expect(windowManager.setAttributes).toBeCalledWith({ state });
        expect(windowManager.attributes.state).toEqual(state);
    });

    test("create app", async () => {
        const manager = new AppManager(windowManager, {});
        const kind = "test";

        const app = await Creator.create({ kind, isAddApp: true, isDynamicPPT: false })
        expect(app).toBeDefined();
        expect(manager.appProxies.get(app!)).toBeInstanceOf(AppProxy);
        expect(manager.appProxies.size).toEqual(1);
        expect(document.querySelectorAll(".telebox-box").length).toEqual(1);
    });

    test("close app", async () => {
        const manager = new AppManager(windowManager, {});
        const kind = "test";
        initCreator(manager);
        const app = await Creator.create({ kind, isAddApp: true, isDynamicPPT: false });

        expect(app).toBeDefined();
        expect(manager.appProxies.get(app!)).toBeInstanceOf(AppProxy);
        expect(manager.appProxies.size).toEqual(1);
        expect(document.querySelectorAll(".telebox-box").length).toEqual(1);

        await manager.closeApp(app!);

        expect(manager.appProxies.size).toEqual(0);
        expect(document.querySelectorAll(".telebox-box").length).toEqual(0);
    });
});
