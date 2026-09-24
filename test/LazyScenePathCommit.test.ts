import { describe, expect, it, vi } from "vitest";

vi.mock("white-web-sdk");

import { AppContext } from "../src/App/AppContext";
import { AppProxy } from "../src/App/AppProxy";
import { AppManager } from "../src/AppManager";
import { callbacks } from "../src/callback";

const createContext = (lazy: boolean, focused: boolean, committed: boolean) => {
    const room = { setScenePath: vi.fn() };
    const proxy = { box: {}, isFocused: focused, setFullPath: vi.fn() };
    const manager = {
        isReplay: false,
        lazySetupEnabled: lazy,
        room,
        displayer: { removeMagixEventListener: vi.fn() },
        store: {},
        isCommittedLazyFocus: vi.fn(() => committed),
    };
    const context = new AppContext(manager as any, {} as any, "Slide-B", proxy as any);
    return { context, room, proxy };
};

describe("AppContext scene path publication", () => {
    it("records a pending Slide page without changing the room scene", async () => {
        const { context, room, proxy } = createContext(true, true, false);
        await context.setScenePath("/slide333/1");
        expect(proxy.setFullPath).toHaveBeenCalledWith("/slide333/1");
        expect(room.setScenePath).not.toHaveBeenCalled();
    });

    it("publishes page changes of the committed lazy focus", async () => {
        const { context, room } = createContext(true, true, true);
        await context.setScenePath("/slide333/2");
        expect(room.setScenePath).toHaveBeenCalledWith("/slide333/2");
    });

    it("preserves eager scene path behavior", async () => {
        const { context, room } = createContext(false, false, false);
        await context.setScenePath("/slide333/1");
        expect(room.setScenePath).toHaveBeenCalledWith("/slide333/1");
    });

    it("considers an App committed only while its focus is active and visible", () => {
        const manager = Object.create(AppManager.prototype) as any;
        const attributes = { minimized: false };
        Object.assign(manager, {
            windowManger: { lazySetupInMaximizedMode: true, attributes },
            store: { focus: "Slide-B" },
            boxManager: { minimized: false },
            activeLazyAppId: "Slide-B",
        });
        expect(manager.isCommittedLazyFocus("Slide-B")).toBe(true);
        attributes.minimized = true;
        expect(manager.isCommittedLazyFocus("Slide-B")).toBe(false);
        attributes.minimized = false;
        manager.store.focus = "Slide-C";
        expect(manager.isCommittedLazyFocus("Slide-B")).toBe(false);
    });
});

describe("AppProxy scene path notification", () => {
    it("emits the page change even when lazy focus already updated the View path", () => {
        vi.useFakeTimers();
        const emit = vi.spyOn(callbacks, "emit").mockResolvedValue(undefined);
        try {
            const view = { focusScenePath: "/slide333/2" };
            const manager = {
                lazySetupEnabled: true,
                boxManager: {},
                appProxies: new Map(),
                viewManager: { getView: () => view },
                store: {},
                displayer: {},
            };
            const proxy = new AppProxy({ kind: "Slide" } as any, manager as any, "Slide-B", false);
            (proxy as any).setFocusScenePathHandler("/slide333/2");
            vi.advanceTimersByTime(50);
            expect(emit).toHaveBeenCalledWith("onAppScenePathChange", {
                appId: "Slide-B",
                view,
            });
            (proxy as any).setFocusScenePathHandler("/slide333/2");
            vi.advanceTimersByTime(50);
            expect(emit).toHaveBeenCalledTimes(1);
        } finally {
            emit.mockRestore();
            vi.useRealTimers();
        }
    });

    it("keeps eager mode's View-path comparison and event behavior", () => {
        vi.useFakeTimers();
        const emit = vi.spyOn(callbacks, "emit").mockResolvedValue(undefined);
        try {
            const view = { focusScenePath: "/slide333/1" };
            const manager = {
                lazySetupEnabled: false,
                boxManager: {},
                appProxies: new Map(),
                viewManager: { getView: () => view },
                store: {},
                displayer: {},
            };
            const proxy = new AppProxy({ kind: "Slide" } as any, manager as any, "Slide-C", false);
            (proxy as any).setFocusScenePathHandler("/slide333/1");
            vi.advanceTimersByTime(50);
            expect(emit).not.toHaveBeenCalled();

            (proxy as any).setFocusScenePathHandler("/slide333/2");
            vi.advanceTimersByTime(50);
            expect(view.focusScenePath).toBe("/slide333/2");
            expect(emit).toHaveBeenCalledOnce();
            expect(emit).toHaveBeenCalledWith("onAppScenePathChange", {
                appId: "Slide-C",
                view,
            });
        } finally {
            emit.mockRestore();
            vi.useRealTimers();
        }
    });
});
