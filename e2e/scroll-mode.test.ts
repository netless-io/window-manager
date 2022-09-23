import { test, expect } from "@playwright/test";
import { gotoRoom, createRoom, getWindow, drawLine, createAnotherPage } from "./helper";

test.describe("scroll mode", () => {
    let uuid;
    let token;

    test.beforeAll(async () => {
        const result = await createRoom();
        uuid = result.uuid;
        token = result.token;
    });

    test("init", async ({ page }) => {
        await gotoRoom(page, uuid, token, "scroll");
        const handle = await getWindow(page);

        const camera = await handle.evaluate(w => w.manager.mainView.camera);
        expect(camera).toBeDefined();
        expect(camera.centerY).toBeGreaterThan(100);
        const viewMode = await handle.evaluate(w => w.manager.viewMode);
        expect(viewMode).toBe("scroll");
    });

    test("sync", async ({ page, browser }) => {
        await gotoRoom(page, uuid, token, "scroll");
        await drawLine(page);
        await page.mouse.wheel(200, 150);
        await page.reload();
        await page.waitForTimeout(2000);

        const buffer = await page
            .locator(".netless-window-manager-main-view .netless-whiteboard")
            .screenshot();
        expect(buffer).toBeDefined();

        const page2 = await createAnotherPage(browser, uuid, token, "scroll");
        const buffer2 = await page2.page
            .locator(".netless-window-manager-main-view .netless-whiteboard")
            .screenshot();
        expect(buffer).toEqual(buffer2);
        await page.close();
        await page2.page.close();
    });
});
