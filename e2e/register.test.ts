import { test, expect } from "@playwright/test"
import { getWindow, gotoRoom, createRoom } from "./helper";

test.describe("应用注册", () => {

    test("注册 CDN APP 所有端同步", async ({ page, browser }) => {
        const { uuid, token } = await createRoom();
        await gotoRoom(page, uuid, token);
        const handle = await getWindow(page);

        await handle.evaluate(window => {
            window.WindowManager.register({
                kind: "Countdown",
                src: "https://netless-app.oss-cn-hangzhou.aliyuncs.com/@netless/app-countdown/0.0.2/dist/main.iife.js",
            });
        });

        const appId = await handle.evaluate(async window => {
            const manager = window.manager;
            return await manager.addApp({
                kind: "Countdown",
            });
        });
        expect(appId).toBeDefined();

        const context2 = await browser.newContext();
        const page2 = await context2.newPage();
        await gotoRoom(page2, uuid, token);
        const handle2 = await getWindow(page2); 

        await page2.waitForTimeout(1000);
        const appsCount2 = await handle2.evaluate(async window => {
            await window.manager.addApp({
                kind: "Countdown",
            });
            return window.manager.queryAll().length;
        });
        expect(appsCount2).toBe(2);
    })
})
