import { test, expect } from "@playwright/test";
import { gotoRoom, createRoom, createAnotherPage, getWindow } from "./helper";

test.describe("视角同步", () => {
    let uuid;
    let token;

    test.beforeAll(async () => {
        const result = await createRoom();
        uuid = result.uuid;
        token = result.token;
    });

    test("主白板", async ({ page, browser }) => {
        await gotoRoom(page, uuid, token);
        const size = page.viewportSize();
        if (!size) return;
        const x = size.width / 2;
        const y = size.height / 2;
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x + 50, y + 50);
        await page.mouse.up();
        // 笔画只有画的端跟接收端会有细微的不同,刷新后笔迹才相同
        await page.reload();
        await page.waitForTimeout(2000);
        const buffer = await page
            .locator(".netless-window-manager-main-view .netless-whiteboard")
            .screenshot();
        expect(buffer).toBeDefined();

        const page2 = await createAnotherPage(browser, uuid, token);
        const buffer2 = await page2.page
            .locator(".netless-window-manager-main-view .netless-whiteboard")
            .screenshot();
        expect(buffer).toEqual(buffer2);
    });

    test("setContainerSizeRatio", async ({ page }) => {
        await gotoRoom(page, uuid, token);
        const handle = await getWindow(page);

        const camera = await handle.evaluate(w => w.manager.mainView.camera);
        expect(camera).toBeDefined();

        await handle.evaluate(async w => {
            w.manager.setContainerSizeRatio(1);
        });
        await page.waitForTimeout(500);
        await handle.evaluate(async w => {
            w.manager.setContainerSizeRatio(9 / 16);
        });
        const camera2 = await handle.evaluate(w => w.manager.mainView.camera);
        expect(camera).toEqual(camera2);
    });
});
