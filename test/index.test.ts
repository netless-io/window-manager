import { Displayer, WindowManager } from "../src";

describe("WindowManager", () => {
    const displayer = {} as Displayer;

    test("constructor", () => {
        const invisiblePluginContext = { kind: "WindowManager", displayer };
        (WindowManager as any).__proto__ = jest.fn().mockImplementation(() => {
            return class {
                constructor(args: any) {
                    expect(args).toEqual(invisiblePluginContext);
                }
            }
        }) as any;

        const wm = new WindowManager(invisiblePluginContext);
        expect(wm).toBeDefined();
    })
});
