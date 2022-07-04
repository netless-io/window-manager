import { test, expect } from "@playwright/test";
import { createRoom, gotoRoom, getWindow } from "./helper";

test.describe("页面操作", () => {
    test.beforeEach(async ({ page }) => {
       const { uuid, token } = await createRoom();
       await gotoRoom(page, uuid, token);
    })

    test("添加切换删除", async ({ page }) => {
        const handle = await getWindow(page);
        
        await handle.evaluate(async window => {
            await window.manager.addPage();
        });
        const pageState = await handle.evaluate(window => window.manager.pageState);
        expect(pageState).toMatchObject({ index: 0, length: 2 });

        await handle.evaluate(async window => {
            await window.manager.nextPage()
        });

        const pageState2 = await handle.evaluate(window => window.manager.pageState);
        expect(pageState2).toMatchObject({ index: 1, length: 2 });

        await handle.evaluate(async window => {
            await window.manager.removePage(1)
        });

        const pageState3 = await handle.evaluate(window => window.manager.pageState);
        expect(pageState3).toMatchObject({ index: 0, length: 1 });
    })
});