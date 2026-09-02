import { describe, expect, it, vi } from "vitest";
vi.mock("white-web-sdk");
import {
    AttributesDelegate,
    Fields,
} from "../src/AttributesDelegate";
import { MAIN_VIEW_CAMERA_COORDINATE_VERSION } from "../src/View/MainViewCameraTransform";

describe("AttributesDelegate mainView camera", () => {
    it("writes the immutable origin pair and active pair atomically", () => {
        const safeSetAttributes = vi.fn();
        const store = new AttributesDelegate({
            getAttributes: () => ({}),
            safeSetAttributes,
            safeUpdateAttributes: vi.fn(),
        });

        store.initializeOriginMainViewAttributes(
            { centerX: 0, centerY: 0, scale: 1, id: "teacher" },
            { width: 1920, height: 1080, id: "teacher" },
            { centerX: 1, centerY: 2, scale: 3, id: "teacher" },
            { width: 1280, height: 720, id: "teacher" }
        );

        expect(safeSetAttributes).toHaveBeenCalledTimes(1);
        expect(safeSetAttributes).toHaveBeenCalledWith({
            [Fields.OriginCamera]: {
                centerX: 0,
                centerY: 0,
                scale: 1,
                id: "teacher",
            },
            [Fields.OriginSize]: { width: 1920, height: 1080, id: "teacher" },
            [Fields.MainViewCamera]: {
                centerX: 1,
                centerY: 2,
                scale: 3,
                id: "teacher",
            },
            [Fields.MainViewSize]: { width: 1280, height: 720, id: "teacher" },
            [Fields.MainViewCameraCoordinateVersion]: MAIN_VIEW_CAMERA_COORDINATE_VERSION,
        });
    });

    it("keeps the legacy camera and size write unchanged", () => {
        const safeSetAttributes = vi.fn();
        const store = new AttributesDelegate({
            getAttributes: () => ({}),
            safeSetAttributes,
            safeUpdateAttributes: vi.fn(),
        });

        store.setMainViewCameraAndSize(
            { centerX: 0, centerY: 0, scale: 1, id: "legacy" },
            { width: 1085, height: 610.3125, id: "legacy" }
        );

        expect(safeSetAttributes).toHaveBeenCalledWith({
            [Fields.MainViewCamera]: { centerX: 0, centerY: 0, scale: 1, id: "legacy" },
            [Fields.MainViewSize]: { width: 1085, height: 610.3125, id: "legacy" },
        });
    });
});
