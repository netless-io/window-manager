import { test, expect } from "@playwright/test";
import {
    getWindow,
    gotoRoom,
    createRoom,
    createApp,
    queryAppLength,
    getRoomPhase,
    createAnotherPage,
} from "../helper";

test("断网重连-重建 APP", async ({ page, context, browser }) => {
    const { uuid, token } = await createRoom();
    await gotoRoom(page, uuid, token);

    const handle = await getWindow(page);
    await context.setOffline(true);
    const appsCount = await handle.evaluate(async window => {
        return window.manager.queryAll().length;
    });
    expect(appsCount).toBe(0);

    const waitPage1 = async () => {
        await page.waitForTimeout(50 * 1000);
        const phase = await getRoomPhase(handle);
        expect(phase).toBe("reconnecting");

        await context.setOffline(false);
        await page.waitForTimeout(10 * 1000);
        const phase2 = await getRoomPhase(handle);
        expect(phase2).toBe("connected");

        const appsCount = await queryAppLength(handle);
        expect(appsCount).toBe(1);
    };

    const waitPage2 = async () => {
        const page2 = await createAnotherPage(browser, uuid, token);
        await createApp(page2.handle, "Counter");
        const appsCount2 = await queryAppLength(page2.handle);
        expect(appsCount2).toBe(1);
    };

    await Promise.all([waitPage1(), waitPage2()]);
});
