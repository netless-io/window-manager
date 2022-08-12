import { test, expect } from "@playwright/test"
import { getWindow, gotoRoom, createRoom, createApp } from "./helper";
import type { AppRegister } from "../dist/src/Register";

test.describe("应用注册", () => {

    test.skip("注册 CDN APP 所有端同步", async ({ page, browser }) => {
        const { uuid, token } = await createRoom();
        await gotoRoom(page, uuid, token);
        const handle = await getWindow(page);

        await handle.evaluate(window => {
            window.WindowManager.register({
                kind: "Countdown",
                src: "https://netless-app.oss-cn-hangzhou.aliyuncs.com/@netless/app-countdown/0.0.2/dist/main.iife.js",
            });
        });
        const appId = await createApp(handle, "Countdown");
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

    test("获取下载到 indexeddb 的应用", async ({ page }) => {
        const { uuid, token } = await createRoom();
        await gotoRoom(page, uuid, token);
        const handle = await getWindow(page);

        await handle.evaluate(async window => {
            window.WindowManager.register({
                kind: "Countdown",
                src: "https://netless-app.oss-cn-hangzhou.aliyuncs.com/@netless/app-countdown/0.0.2/dist/main.iife.js",
            });
            const registry = window.WindowManager.registry as AppRegister;
            await registry.downloadApp("Countdown");
        });
        const indexed = await handle.evaluate(async window => {
            const registry = window.WindowManager.registry as AppRegister;
            return registry.indexed.size;
        });
        expect(indexed).toBe(1);
        const removeIndexed = await handle.evaluate(async window => {
            const registry = window.WindowManager.registry as AppRegister;
            await registry.removeIndexed("Countdown");
            return registry.indexed.size;
        });
        expect(removeIndexed).toBe(0);
    })
})
