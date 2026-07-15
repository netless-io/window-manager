import { describe, expect, it } from "vitest";
import { resolveAppOptions } from "../src/Utils/resolveAppOptions";

describe("resolveAppOptions", () => {
    it("preserves the original object or getter without an override", () => {
        const registeredOptions = () => ({ useScrollbar: false });
        expect(resolveAppOptions(registeredOptions, undefined)).toBe(registeredOptions);
    });

    it("lazily merges mount options over registered options", () => {
        const registeredOptions = () => ({
            useScrollbar: false,
            debounceSync: false,
        });
        const resolved = resolveAppOptions(registeredOptions, {
            debounceSync: true,
        });

        expect(resolved()).toEqual({
            useScrollbar: false,
            debounceSync: true,
        });
    });
});
