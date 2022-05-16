import { Displayer, WindowManager } from "../src";
import { describe, it, vi, expect, beforeAll } from "vitest";

describe("WindowManager", () => {
    beforeAll(() => {
        vi.mock("white-web-sdk");
    });

    const displayer = {} as Displayer;

    it("constructor", async () => {
        const invisiblePluginContext = { kind: "WindowManager", displayer };
        const wm = new WindowManager(invisiblePluginContext);
        expect(wm).toBeDefined();
        expect(wm.attributes).toBeDefined();
        expect(wm.setAttributes).toBeDefined();
    });
});
