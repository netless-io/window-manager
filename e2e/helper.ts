import { request } from "@playwright/test";
import type { Page } from "@playwright/test";

export const getWindow = async (page: Page) => {
    const handle = await page.evaluateHandle(() => ({ window }));
    const properties = await handle.getProperties();
    const window = properties.get("window");
    if (window) {
        return window;
    } else {
        throw new Error("window is not found");
    }
}

export const gotoRoom = async (page: Page, uuid: string, token: string) => {
    await page.goto(`/?uuid=${uuid}&roomToken=${token}`);
    await page.waitForTimeout(2000);
}

export const createRoom = async () => {
    const context = await request.newContext();
    const roomResult = await context.post("https://api.netless.link/v5/rooms", {
        headers: {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            token: process.env.VITE_SDK_TOKEN!,
            region: "cn-hz",
            "Content-Type": "application/json",
        }
    });
    const roomBody = await roomResult.json();
    const tokenResult = await context.post(`https://api.netless.link/v5/tokens/rooms/${roomBody.uuid}`, {
        headers: {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            token: process.env.VITE_SDK_TOKEN!,
            "Content-Type": "application/json",
        },
        data: JSON.stringify({
            lifespan: 0,
            role: "admin",
        })
    });
    const tokenBody = await tokenResult.json();
    return { uuid: roomBody.uuid, token: tokenBody };
}
