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

    it("waits for App setup and returns the created appId", async () => {
        const wm = new WindowManager({ kind: "WindowManager", displayer });
        const waitForSetup = vi.fn().mockResolvedValue({});
        const app = { waitForSetup };
        wm.appManager = { appProxies: new Map([["app-1", app]]) } as any;
        vi.spyOn(wm, "addApp").mockResolvedValue("app-1");

        await expect(wm.addAppAndWaitForSetup({ kind: "Presentation" })).resolves.toBe("app-1");
        expect(waitForSetup).toHaveBeenCalledOnce();
    });

    it("cleans a partial App and rethrows its original setup error", async () => {
        const wm = new WindowManager({ kind: "WindowManager", displayer });
        const error = new Error("presentation setup failed");
        const destroy = vi.fn().mockResolvedValue(undefined);
        const app = { waitForSetup: vi.fn().mockRejectedValue(error), destroy };
        wm.appManager = { appProxies: new Map([["app-1", app]]) } as any;
        vi.spyOn(wm, "addApp").mockResolvedValue("app-1");

        await expect(wm.addAppAndWaitForSetup({ kind: "Presentation" })).rejects.toBe(error);
        expect(destroy).toHaveBeenCalledWith(true, true, false, error);
    });
});
