import { describe, it, expect, vi, beforeEach } from "vitest";
import { appRegister, preloadBuiltinApps } from "./index";
import type { NetlessApp } from "../typings";

describe("room-independent App JavaScript", () => {
    beforeEach(() => {
        ["Slide", "Presentation", "MediaPlayer", "DocsViewer"].forEach(kind =>
            appRegister.unregister(kind)
        );
    });

    it("loads nothing unless the host explicitly selects Apps", async () => {
        const slide = vi.fn(async () => ({ kind: "Test", setup: vi.fn() }));
        const presentation = vi.fn(async () => ({ kind: "Test", setup: vi.fn() }));
        const media = vi.fn(async () => ({ kind: "Test", setup: vi.fn() }));
        await appRegister.register({ kind: "Slide", src: slide });
        await appRegister.register({ kind: "Presentation", src: presentation });
        await appRegister.register({ kind: "MediaPlayer", src: media });
        await preloadBuiltinApps([]);
        await preloadBuiltinApps();
        expect(slide).not.toHaveBeenCalled();
        expect(presentation).not.toHaveBeenCalled();
        expect(media).not.toHaveBeenCalled();
        await preloadBuiltinApps(["Slide", "Presentation"]);
        expect(slide).toHaveBeenCalledTimes(1);
        expect(presentation).toHaveBeenCalledTimes(1);
        expect(media).not.toHaveBeenCalled();
    });

    it("loads only selected registered Apps and follows a replaced loader", async () => {
        const original = vi.fn(async () => ({ kind: "Test", setup: vi.fn() }));
        const replacement = vi.fn(async () => ({ kind: "Test", setup: vi.fn() }));
        await appRegister.register({ kind: "DocsViewer", src: original });
        const held = appRegister.appClasses.get("DocsViewer")!;
        await appRegister.register({ kind: "DocsViewer", src: replacement });
        await Promise.all([held(), preloadBuiltinApps(["DocsViewer", "DocsViewer"])]);
        expect(original).not.toHaveBeenCalled();
        expect(replacement).toHaveBeenCalledTimes(1);
    });

    it("shares class loading and never calls setup", async () => {
        const setup = vi.fn();
        const load = vi.fn(async () => ({ kind: "Slide", setup }));
        await appRegister.register({ kind: "Slide", src: load });
        await Promise.all([preloadBuiltinApps(["Slide"]), preloadBuiltinApps(["Slide"])]);
        expect(load).toHaveBeenCalledTimes(1);
        expect(setup).not.toHaveBeenCalled();
    });
    it("retries failed chunks and protects a replacement registration", async () => {
        let rejectOld: (error: Error) => void = () => undefined;
        await appRegister.register({
            kind: "Slide",
            src: () =>
                new Promise<NetlessApp>((_resolve, reject) => {
                    rejectOld = reject;
                }),
        });
        const old = preloadBuiltinApps(["Slide"]).catch(error => error);
        await Promise.resolve();
        const replacement = vi.fn(async () => ({ kind: "Test", setup: vi.fn() }));
        await appRegister.register({ kind: "Slide", src: replacement });
        await preloadBuiltinApps(["Slide"]);
        rejectOld(Error("old chunk"));
        await old;
        await preloadBuiltinApps(["Slide"]);
        expect(replacement).toHaveBeenCalledTimes(1);
        let attempts = 0;
        await appRegister.register({
            kind: "Slide",
            src: async () => {
                if (++attempts === 1) throw Error("network");
                return { kind: "Slide", setup: vi.fn() };
            },
        });
        await expect(preloadBuiltinApps(["Slide"])).rejects.toThrow("network");
        await preloadBuiltinApps(["Slide"]);
        expect(attempts).toBe(2);
    });
    it("rejects invalid or missing Apps before loading any selection", async () => {
        const load = vi.fn(async () => ({ kind: "Test", setup: vi.fn() }));
        await appRegister.register({ kind: "Slide", src: load });
        await expect(preloadBuiltinApps(["Slide", "custom"])).rejects.toThrow("Unsupported");
        await expect(preloadBuiltinApps(["Slide", "Presentation"])).rejects.toThrow(
            "not registered"
        );
        expect(load).not.toHaveBeenCalled();
    });

    it("a failed optional warmup cannot poison the normal class loader", async () => {
        let attempts = 0;
        const app = { kind: "Presentation", setup: vi.fn() };
        await appRegister.register({
            kind: "Presentation",
            src: async () => {
                if (++attempts === 1) throw Error("CDN unavailable");
                return app;
            },
        });
        await expect(preloadBuiltinApps(["Presentation"])).rejects.toThrow("CDN unavailable");
        expect(await appRegister.appClasses.get("Presentation")!()).toBe(app);
        expect(attempts).toBe(2);
        expect(app.setup).not.toHaveBeenCalled();
    });
});
