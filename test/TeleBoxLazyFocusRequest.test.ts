import { expect, it, vi } from "vitest";
import { TeleBoxManager } from "@netless/telebox-insider";

it("treats a lazy TeleBox focus as a request until WindowManager commits it", () => {
    const box = {
        id: "slide",
        focus: false,
        setFocus: vi.fn(function (this: { focus: boolean }, value: boolean) {
            this.focus = value;
        }),
    };
    const manager = Object.create(TeleBoxManager.prototype) as any;
    Object.defineProperty(manager, "boxes", { value: [box] });
    manager.getBox = vi.fn(() => box);
    manager.events = { emit: vi.fn() };
    manager.maxTitleBar = { focusBox: vi.fn() };
    manager.useBoxesStatus = false;
    const request = vi.fn(() => true);
    manager.setLazyFocusRequestHandler(request);

    manager.focusBox("slide");
    expect(request).toHaveBeenCalledWith("slide");
    expect(box.setFocus).not.toHaveBeenCalled();
    expect(manager.events.emit).not.toHaveBeenCalled();

    manager.focusBoxCommitted("slide");
    expect(box.setFocus).toHaveBeenCalledWith(true, false);
    expect(manager.events.emit).toHaveBeenCalledWith("focused", box);
    expect(request).toHaveBeenCalledTimes(1);

    box.focus = false;
    const inheritedFocus = manager.focusBox.bind(manager);
    manager.focusBox = vi.fn((...args: any[]) => inheritedFocus(...args));
    manager.focusBoxCommitted("slide");
    expect(manager.focusBox).toHaveBeenCalledWith("slide", false);
    expect(request).toHaveBeenCalledTimes(1);
});
