import { test, expect } from "@playwright/test";
import { createRoom, gotoRoom, getWindow, getPageState } from "./helper";

test.describe("页面操作", () => {
    test.beforeEach(async ({ page }) => {
        const { uuid, token } = await createRoom();
        await gotoRoom(page, uuid, token);
    });

    test("添加-切换-删除-跳页", async ({ page }) => {
        const handle = await getWindow(page);

        await handle.evaluate(async window => {
            await window.manager.addPage();
        });
        const pageState = await getPageState(handle);
        expect(pageState).toMatchObject({ index: 0, length: 2 });

        await handle.evaluate(async window => {
            await window.manager.nextPage();
        });

        const pageState2 = await getPageState(handle);
        expect(pageState2).toMatchObject({ index: 1, length: 2 });

        await handle.evaluate(async window => {
            await window.manager.removePage(1);
        });

        const pageState3 = await getPageState(handle);
        expect(pageState3).toMatchObject({ index: 0, length: 1 });

        await handle.evaluate(async window => {
            await window.manager.addPage();
            await window.manager.addPage();
        });

        await handle.evaluate(async window => {
            await window.manager.jumpPage(2);
        });
        const pageState4 = await getPageState(handle);
        expect(pageState4).toMatchObject({ index: 2, length: 3 });
    });
});
