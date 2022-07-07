import { test, expect } from "@playwright/test";
import { getWindow, gotoRoom, createRoom, createApp } from "../helper";
import type { NetlessApp } from "../../dist/src";

test.describe("NetlessApp", () => {
    test("应用接口", async ({ page }) => {
        const { uuid, token } = await createRoom();
        await gotoRoom(page, uuid, token);
        const handle = await getWindow(page);

        await handle.evaluate(window => {
            const app: NetlessApp = {
                kind: "Text",
                setup: context => {
                    context.createWhiteBoardView();
                    const div = document.createElement("div");
                    div.className = "Test-APP";
                    context.box.mountStage(div);
                }
            }
            window.WindowManager.register({
                kind: "Test",
                src: app
            });
        });

        const appID = await createApp(handle, "Test");

        expect(appID).toBeDefined();
        await page.waitForTimeout(500);
        expect(await page.locator(".telebox-box .netless-whiteboard").count()).toEqual(1);
        expect(await page.locator(".telebox-box .Test-APP").count()).toEqual(1);
    });
});
