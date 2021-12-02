import { AppManager } from "../src/AppManager";
import { AppProxy } from "../src/AppProxy";

describe("AppProxy", () => {
    const manager = {
        appProxies: new Map(),
    } as unknown as AppManager;

    afterEach(() => {
        jest.clearAllMocks();
        manager.appProxies.clear();
    });

    test("constructor", () => {
        const app = new AppProxy({ kind: "test" }, manager, "test", true);

        expect(app).toBeDefined();
        expect(manager.appProxies.size).toBe(1);
        expect(manager.appProxies.get("test")).toBe(app);
    });
});
