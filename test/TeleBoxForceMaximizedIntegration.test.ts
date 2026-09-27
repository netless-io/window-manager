import { expect, it, vi } from "vitest";
import { TELE_BOX_STATE, TeleBoxManager } from "@netless/telebox-insider";

it("enforces forceMaximized through the installed TeleBox package", () => {
    const matchMedia = window.matchMedia;
    window.matchMedia = vi.fn(() => ({
        matches: false,
        addListener: vi.fn(),
        removeListener: vi.fn(),
    })) as any;
    let manager: TeleBoxManager | undefined;

    try {
        manager = new TeleBoxManager({
            root: document.createElement("div"),
            forceMaximized: true,
        });
        manager.setMaximized(false);
        expect(manager.state).toBe(TELE_BOX_STATE.Maximized);

        manager.setForceMaximized(false);
        manager.setMaximized(false);
        expect(manager.state).toBe(TELE_BOX_STATE.Normal);

        manager.setForceMaximized(true);
        expect(manager.state).toBe(TELE_BOX_STATE.Maximized);
    } finally {
        manager?.destroy();
        window.matchMedia = matchMedia;
    }
});

it("masks per-box status while the room force policy overrides box mode", () => {
    const matchMedia = window.matchMedia;
    window.matchMedia = vi.fn(() => ({
        matches: false,
        addListener: vi.fn(),
        removeListener: vi.fn(),
    })) as any;
    let manager: TeleBoxManager | undefined;

    try {
        manager = new TeleBoxManager({
            root: document.createElement("div"),
            useBoxesStatus: true,
        });
        const box = manager.create({ id: "slide", boxStatus: TELE_BOX_STATE.Minimized }, false);
        expect(box.boxStatus).toBe(TELE_BOX_STATE.Minimized);

        manager.setUseBoxesStatus(false);
        manager.setForceMaximized(true);
        expect(box.boxStatus).toBeUndefined();
        expect(box.state).toBe(TELE_BOX_STATE.Maximized);
        const added = manager.create({ id: "added", boxStatus: TELE_BOX_STATE.Minimized }, false);
        expect(added.boxStatus).toBeUndefined();

        manager.setForceMaximized(false);
        manager.setMaximized(false);
        manager.setBoxesStatus(
            new Map([
                ["slide", TELE_BOX_STATE.Minimized],
                ["added", TELE_BOX_STATE.Minimized],
            ]),
            true
        );
        manager.setUseBoxesStatus(true);
        expect(box.boxStatus).toBe(TELE_BOX_STATE.Minimized);
        expect(box.state).toBe(TELE_BOX_STATE.Minimized);
        expect(added.boxStatus).toBe(TELE_BOX_STATE.Minimized);
    } finally {
        manager?.destroy();
        window.matchMedia = matchMedia;
    }
});
