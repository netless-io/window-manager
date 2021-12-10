import { AppManager } from "../src/AppManager";
import { AppProxy } from "../src/App";

describe("AppProxy", () => {
    const manager = {
        appProxies: new Map(),
        createAppProxyContext: jest.fn().mockReturnValue({
            setProxy: (id: string, proxy: AppProxy) => {
                manager.appProxies.set(id, proxy);
            }
        }),
        boxManager: jest.fn(),
    } as unknown as AppManager;

    afterEach(() => {
        jest.clearAllMocks();
        manager.appProxies.clear();
    });

    test("constructor", () => {
        const context = manager.createAppProxyContext();
        const app = new AppProxy({ kind: "test" }, context, manager.boxManager , "test", true);

        expect(app).toBeDefined();
        expect(manager.appProxies.size).toBe(1);
        expect(manager.appProxies.get("test")).toBe(app);
    });
});
