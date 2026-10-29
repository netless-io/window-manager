import { describe, it, expect, vi } from "vitest";
import { appRegister, preloadBuiltinApps } from "./index";

describe("room-independent App JavaScript", () => {
    it("shares class loading and never calls setup", async () => {
        const setup = vi.fn(); const load = vi.fn(async () => ({ setup }));
        await appRegister.register({ kind: "Slide", src: load });
        await Promise.all([preloadBuiltinApps(["Slide"]), preloadBuiltinApps(["Slide"])]);
        expect(load).toHaveBeenCalledTimes(1); expect(setup).not.toHaveBeenCalled();
    });
    it("retries failed chunks and protects a replacement registration", async () => {
        let rejectOld: (error: Error) => void = () => {};
        await appRegister.register({kind:"Slide",src: () => new Promise((_resolve, reject) => {rejectOld=reject;})});
        const old = preloadBuiltinApps(["Slide"]).catch(error => error);
        await Promise.resolve();
        const replacement = vi.fn(async () => ({setup() {}}));
        await appRegister.register({kind:"Slide",src:replacement});
        await preloadBuiltinApps(["Slide"]);
        rejectOld(Error("old chunk")); await old;
        await preloadBuiltinApps(["Slide"]); expect(replacement).toHaveBeenCalledTimes(1);
        let attempts=0;
        await appRegister.register({kind:"Slide",src:async () => {if (++attempts===1) throw Error("network"); return {setup(){}};}});
        await expect(preloadBuiltinApps(["Slide"])).rejects.toThrow("network");
        await preloadBuiltinApps(["Slide"]); expect(attempts).toBe(2);
    });
    it("rejects custom Apps before loading them", () => {
        expect(() => preloadBuiltinApps(["custom"])).toThrow("Unsupported");
    });
});
