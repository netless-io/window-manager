import { describe, expect, it } from "vitest";
import { applyDynamicMountParams } from "../src/Utils/dynamicConfig";
import type { MountParams } from "../src";

describe("Room dynamic configuration at mount", () => {
    it("inherits remote settings, retains local runtime objects and preserves explicit false/zero", () => {
        const callback = () => undefined;
        const snapshot = Object.freeze({ windowManager: { originSize: { width: 1280, height: 720 }, pageScaleRange: { minScale: 1, maxScale: 4 }, cursor: true, forceMaximized: true, builtinAppOptions: { Presentation: { useScrollbar: true } }, container: "invalid-remote-node", future: { a: 1, b: [1] } } });
        const room = { dynamicConfig: snapshot }, container = document.createElement("div");
        const local = { room, container, cursor: false, forceMaximized: undefined, pageScaleRange: { maxScale: 2 }, builtinAppOptions: { Presentation: { onReady: callback } }, future: { b: [], flag: false } } as unknown as MountParams;
        const overrides: string[] = [];
        const result = applyDynamicMountParams(local, true, path => overrides.push(path));
        expect(overrides.sort()).toEqual(["windowManager.cursor", "windowManager.pageScaleRange.maxScale", "windowManager.future.b"].sort());
        expect(result.originSize).toEqual({ width: 1280, height: 720 });
        expect(result.pageScaleRange).toEqual({ minScale: 1, maxScale: 2 });
        expect(result.cursor).toBe(false); expect(result.forceMaximized).toBe(true);
        expect(result.container).toBe(container); expect(result.room).toBe(room);
        expect((result.builtinAppOptions as any).Presentation.onReady).toBe(callback);
        expect((result as any).future).toEqual({ a: 1, b: [], flag: false });
        (result.originSize as { width: number }).width = 5;
        expect(snapshot.windowManager.originSize.width).toBe(1280);
        expect(local.pageScaleRange).toEqual({ maxScale: 2 });
    });
    it("keeps the original params for old SDKs and replay", () => {
        const overrides: string[] = [];
        const params = { room: {}, cursor: false } as MountParams;
        expect(applyDynamicMountParams(params, true, path => overrides.push(path))).toBe(params);
        const replay = { room: { dynamicConfig: { windowManager: { cursor: true } } }, cursor: false } as unknown as MountParams;
        expect(applyDynamicMountParams(replay, false, path => overrides.push(path))).toBe(replay);
        expect(overrides).toEqual([]);
    });
    it("reads the next Room snapshot without carrying settings between mounts", () => {
        const a = { room: { dynamicConfig: { windowManager: { cursor: true } } } } as unknown as MountParams;
        const b = { room: { dynamicConfig: { windowManager: { cursor: false } } } } as unknown as MountParams;
        expect(applyDynamicMountParams(a, true).cursor).toBe(true);
        expect(applyDynamicMountParams(b, true).cursor).toBe(false);
    });
});
