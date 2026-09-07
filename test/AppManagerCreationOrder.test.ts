import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("white-web-sdk");

import { AppManager } from "../src/AppManager";
import { WindowManager } from "../src";

const apps = {
    oldest: { kind: "Oldest", createdAt: 1 },
    focused: { kind: "Focused", createdAt: 2 },
    newest: { kind: "Newest", createdAt: 3 },
};

type ManagerOptions = {
    useBoxesStatus?: boolean;
    maximized?: boolean;
    focus?: string;
};

describe("AppManager app creation order", () => {
    let previousContainer: HTMLElement | undefined;

    beforeEach(() => {
        previousContainer = WindowManager.container;
        WindowManager.container = document.createElement("div");
    });

    afterEach(() => {
        WindowManager.container = previousContainer;
        vi.restoreAllMocks();
    });

    const restoreApps = async ({
        useBoxesStatus = false,
        maximized,
        focus,
    }: ManagerOptions) => {
        const tasks: Array<() => Promise<unknown>> = [];
        const notifyAppsChange = vi.fn();
        const baseInsertApp = vi.fn().mockResolvedValue(undefined);
        const manager = {
            appCreateQueue: {
                emitReady: vi.fn(),
                push: (task: () => Promise<unknown>) => tasks.push(task),
            },
            appProxies: new Map(),
            appStatus: new Map(),
            attributes: {
                apps,
                maximized,
                oldest: {},
                focused: {},
                newest: {},
            },
            store: { focus },
            useBoxesStatus,
            notifyAppsChange,
            baseInsertApp,
            focusByAttributes: vi.fn(),
        };

        await AppManager.prototype._attributesUpdateCallback.call(manager as any, apps);
        for (const task of tasks) {
            await task();
        }

        return {
            creationOrder: baseInsertApp.mock.calls.map(([, appId]) => appId),
            notifiedOrder: notifyAppsChange.mock.calls[0]?.[0],
        };
    };

    it("creates the focused app first for a globally maximized workspace", async () => {
        const result = await restoreApps({ maximized: true, focus: "focused" });

        expect(result.creationOrder).toEqual(["focused", "oldest", "newest"]);
        expect(result.notifiedOrder).toEqual(["oldest", "focused", "newest"]);
    });

    it.each([
        ["independent box status is enabled", { useBoxesStatus: true, maximized: true, focus: "focused" }],
        ["the workspace is not maximized", { maximized: false, focus: "focused" }],
        ["the focused app is missing", { maximized: true, focus: "missing" }],
        ["there is no focused app", { maximized: true }],
    ])("keeps chronological order when %s", async (_description, options) => {
        const result = await restoreApps(options);

        expect(result.creationOrder).toEqual(["oldest", "focused", "newest"]);
        expect(result.notifiedOrder).toEqual(["oldest", "focused", "newest"]);
    });
});
