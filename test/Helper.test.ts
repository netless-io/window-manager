import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("white-web-sdk", () => ({ WhiteVersion: "2.16.57" }));

vi.mock("../src/index", () => ({
    WindowManager: class WindowManager {
        public static wrapper?: HTMLElement;
    },
}));

import { setupWrapper } from "../src/Helper";

describe("setupWrapper", () => {
    let root: HTMLDivElement;

    beforeEach(() => {
        root = document.createElement("div");
    });

    it("marks the wrapper when independent box status is enabled", () => {
        const { wrapper } = setupWrapper(root, true);

        expect(wrapper.classList.contains("netless-window-manager-use-boxes-status")).toBe(true);
    });

    it("does not mark the wrapper when independent box status is disabled", () => {
        const { wrapper } = setupWrapper(root);

        expect(wrapper.classList.contains("netless-window-manager-use-boxes-status")).toBe(false);
    });
});
