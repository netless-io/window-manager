import { test, expect } from "@playwright/test"
import { getWindow, gotoRoom, createRoom, createApp, getPageState, getRoomPhase } from "./helper";

test.describe("正常流程", () => {
    test.beforeEach(async ({ page }) => {
        const { uuid, token } = await createRoom();
        await gotoRoom(page, uuid, token);
    });

    test.afterEach(async ({ page }) => {
        const handle = await getWindow(page);
        await handle.evaluate(async window => {
            window.manager.queryAll().forEach(app => app.close())
        })
        await page.waitForTimeout(1000);
    });

    test("挂载成功", async ({ page }) => {
        const handle = await getWindow(page);
        
        expect(await getRoomPhase(handle)).toBe("connected");
        expect(await handle.evaluate(window => window.manager.kind)).toBe("WindowManager");
        
        const pageState = await getPageState(handle);
        expect(pageState).toHaveProperty("index");
        expect(pageState).toHaveProperty("length");
    });

    test("插入 APP", async ({ page }) => {
        const handle = await getWindow(page);

        const appId = await createApp(handle, "Counter");
        expect(appId).toBeDefined();
    });
})
