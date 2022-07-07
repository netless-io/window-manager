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

test("断网重连-关闭 APP", async ({ page, context, browser }) => {
    const { uuid, token } = await createRoom();
    await gotoRoom(page, uuid, token);

    const handle = await getWindow(page);
    await createApp(handle, "Counter");
    // 应用创建需要异步的初始化设置才能同步到其他端
    await page.waitForTimeout(1000);

    const appsCount = await queryAppLength(handle);
    expect(appsCount).toBe(1);

    const waitPage1 = async () => {
        await context.setOffline(true);
        await page.waitForTimeout(50 * 1000);
        const phase = await getRoomPhase(handle);
        expect(phase).toBe("reconnecting");

        await context.setOffline(false);
        await page.waitForTimeout(10 * 1000);
        const phase2 = await getRoomPhase(handle);
        expect(phase2).toBe("connected");

        const appsCount = await queryAppLength(handle);
        expect(appsCount).toBe(0);
    };

    const waitPage2 = async () => {
        const page2 = await createAnotherPage(browser, uuid, token);
        await page2.handle.evaluate(async window => {
            window.manager.queryAll().forEach(app => app.close());
        });
        await page2.page.waitForTimeout(1000);
        const appsCount2 = await queryAppLength(page2.handle);
        expect(appsCount2).toBe(0);
    };

    await Promise.all([waitPage1(), waitPage2()]);
});
