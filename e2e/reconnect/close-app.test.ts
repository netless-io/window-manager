import { test, expect } from "@playwright/test"
import { getWindow, gotoRoom, createRoom } from "../helper";

test("断网重连-关闭 APP", async ({ page, context, browser }) => {
    const { uuid, token } = await createRoom();
    await gotoRoom(page, uuid, token);

    const handle = await getWindow(page);
    await handle.evaluate(async window => {
        const manager = window.manager;
        return await manager.addApp({
            kind: "Counter",
        });
    });

    const appsCount = await handle.evaluate(async window => {
        return window.manager.queryAll().length
    });
    expect(appsCount).toBe(1);

    const waitPage1 = async () => {
        await context.setOffline(true);
        await page.waitForTimeout(50 * 1000);
        const phase = await handle.evaluate(window => window.room.phase);
        expect(phase).toBe("reconnecting");

        await context.setOffline(false);
        await page.waitForTimeout(10 * 1000);
        const phase2 = await handle.evaluate(window => window.room.phase);
        expect(phase2).toBe("connected");

        const appsCount = await handle.evaluate(async window => {
            return window.manager.queryAll().length
        });
        expect(appsCount).toBe(0);
    }

    const waitPage2 = async () => {
        const context2 = await browser.newContext();
        const page2 = await context2.newPage();
        await gotoRoom(page2, uuid, token);
        const handle2 = await getWindow(page2);
        await handle2.evaluate(async window => {
            window.manager.queryAll().forEach(app => app.close())
        });
        await page2.waitForTimeout(1000);
        const appsCount2 = await handle2.evaluate(async window => {
            return window.manager.queryAll().length;
        });
        expect(appsCount2).toBe(0);
    }

    await Promise.all([
        waitPage1(),
        waitPage2(),
    ]);
})
