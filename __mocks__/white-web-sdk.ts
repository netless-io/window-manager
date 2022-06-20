import { vi } from "vitest";

class InvisiblePlugin {
    attributes: any = {};
    setAttributes (attrs: any) {
        this.attributes = { ...this.attributes, ...attrs };
    }
}

const UpdateEventKind = {
    Inserted: 0,
    Updated: 1,
    Removed: 2,
}

enum ApplianceNames {
    selector = "selector",
    clicker = "clicker",
    laserPointer = "laserPointer",
    pencil = "pencil",
    rectangle = "rectangle",
    ellipse = "ellipse",
    shape = "shape",
    eraser = "eraser",
    text = "text",
    straight = "straight",
    arrow = "arrow",
    hand = "hand",
}

enum ViewMode {
    Freedom = "freedom",
    Follower = "follower",
    Broadcaster = "broadcaster",
}

enum AnimationMode {
    Immediately = "immediately",
    Continuous = "continuous",
}

const isPlayer = vi.fn(() => false);
const unlistenDisposed = vi.fn();
const unlistenUpdated = vi.fn();
const toJS = vi.fn();

export {
    InvisiblePlugin, UpdateEventKind, ApplianceNames, ViewMode, isPlayer, unlistenDisposed,
    unlistenUpdated, toJS, AnimationMode
}
