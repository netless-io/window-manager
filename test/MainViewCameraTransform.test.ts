import { describe, expect, it } from "vitest";
import {
    getEffectiveOriginSize,
    getMainViewBaseScale,
    isLegacyMainViewCameraContract,
    localCameraToMainView,
    mainViewCameraToContain,
    mainViewCameraToLocal,
    normalizeOriginSize,
} from "../src/View/MainViewCameraTransform";

describe("MainViewCameraTransform", () => {
    it.each([undefined, 1])("recognizes coordinate version %s as a legacy pair", version => {
        expect(
            isLegacyMainViewCameraContract(
                undefined,
                undefined,
                { centerX: 10, centerY: 20, scale: 1.5 },
                { width: 1280, height: 720 },
                version
            )
        ).toBe(true);
    });

    it("normalizes and freezes originSize", () => {
        expect(normalizeOriginSize(undefined)).toBeUndefined();
        const size = normalizeOriginSize({ width: 1920, height: 1080 });
        expect(size).toEqual({ width: 1920, height: 1080 });
        expect(Object.isFrozen(size)).toBe(true);
    });

    it.each([
        { width: 0, height: 1080 },
        { width: -1, height: 1080 },
        { width: Number.NaN, height: 1080 },
        { width: 1920, height: Number.POSITIVE_INFINITY },
    ])("rejects invalid originSize $width x $height", size => {
        expect(() => normalizeOriginSize(size)).toThrow(/finite positive numbers/);
    });

    it("converts origin and local camera scales without changing world center", () => {
        const originSize = { width: 1920, height: 1080 };
        const localSize = { width: 1280, height: 720 };
        const originCamera = { centerX: 120, centerY: -35, scale: 2 };

        expect(getMainViewBaseScale(originSize, localSize)).toBeCloseTo(2 / 3);
        const localCamera = mainViewCameraToLocal(originCamera, originSize, localSize);
        expect(localCamera).toEqual({
            centerX: 120,
            centerY: -35,
            scale: 4 / 3,
        });
        expect(localCameraToMainView(localCamera!, originSize, localSize)).toEqual(originCamera);
    });

    it("uses actual local size for a portrait layout", () => {
        const originSize = { width: 1920, height: 1080 };
        const localSize = { width: 720, height: 1280 };
        const localCamera = mainViewCameraToLocal(
            { centerX: 0, centerY: 0, scale: 2 },
            originSize,
            localSize
        );

        expect(getMainViewBaseScale(originSize, localSize)).toBe(0.375);
        expect(localCamera?.scale).toBe(0.75);
        expect(localCameraToMainView(localCamera!, originSize, localSize)?.scale).toBe(2);
    });

    it("calculates the origin camera target for moveCameraToContain", () => {
        expect(
            mainViewCameraToContain(
                { originX: 100, originY: 200, width: 400, height: 200 },
                { width: 1920, height: 1080 }
            )
        ).toEqual({ centerX: 300, centerY: 300, scale: 4.8 });
    });

    it("calculates effectiveOriginSize as the minimum enclosing rectangle", () => {
        const originSize = { width: 1920, height: 1080 };

        expect(getEffectiveOriginSize(originSize, 9 / 16)).toEqual(originSize);
        expect(getEffectiveOriginSize(originSize, 16 / 9)).toEqual({
            width: 1920,
            height: 1920 * (16 / 9),
        });
    });

    it("does not convert zero-sized local views", () => {
        const originSize = { width: 1920, height: 1080 };
        const zeroSize = { width: 0, height: 0 };
        const camera = { centerX: 0, centerY: 0, scale: 1 };

        expect(getMainViewBaseScale(originSize, zeroSize)).toBeUndefined();
        expect(mainViewCameraToLocal(camera, originSize, zeroSize)).toBeUndefined();
        expect(localCameraToMainView(camera, originSize, zeroSize)).toBeUndefined();
    });

    it("rejects camera conversions whose finite inputs overflow", () => {
        expect(
            mainViewCameraToLocal(
                { centerX: 0, centerY: 0, scale: Number.MAX_VALUE },
                { width: 1, height: 1 },
                { width: 960, height: 540 }
            )
        ).toBeUndefined();
        expect(
            localCameraToMainView(
                { centerX: 0, centerY: 0, scale: Number.MAX_VALUE },
                { width: Number.MAX_VALUE, height: Number.MAX_VALUE },
                { width: 1, height: 1 }
            )
        ).toBeUndefined();
    });

    it("rejects an effectiveOriginSize that overflows", () => {
        expect(() =>
            getEffectiveOriginSize(
                { width: Number.MAX_VALUE, height: Number.MAX_VALUE },
                Number.MAX_VALUE
            )
        ).toThrow(/finite size range/);
    });
});
