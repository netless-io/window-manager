import { test, expect } from "@playwright/test"
import { getWindow, gotoRoom, createRoom } from "./helper";

test.describe("正常流程", () => {
    test.beforeEach(async ({ page }) => {
        const { uuid, token } = await createRoom();
        await gotoRoom(page, uuid, token);
    });

    test.afterEach(async ({ page }) => {
        const handle = await getWindow(page);
        await handle.evaluate(async window => {
            window.manager.queryAll().forEach(app => app.close())
        });
        await page.waitForTimeout(1000);
    });

    test("挂载成功", async ({ page }) => {
        const handle = await getWindow(page);
        
        expect(await handle.evaluate(window => window.room.phase)).toBe("connected");
        expect(await handle.evaluate(window => window.manager.kind)).toBe("WindowManager");
        
        const pageState = await handle.evaluate(window => window.manager.pageState);
        expect(pageState).toHaveProperty("index");
        expect(pageState).toHaveProperty("length");
    });

    test("插入 APP", async ({ page }) => {
        const handle = await getWindow(page);

        const appId = await handle.evaluate(async window => {
            const manager = window.manager;
            return await manager.addApp({
                kind: "Counter",
            });
        });
        expect(appId).toBeDefined();
    });
})
