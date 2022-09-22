import { request } from "@playwright/test";
import type { Page, JSHandle, Browser } from "@playwright/test";

export const getWindow = async (page: Page): Promise<JSHandle> => {
    return await page.evaluateHandle("window");
};

export const gotoRoom = async (page: Page, uuid: string, token: string, viewMode?: string) => {
    let url = `/?uuid=${uuid}&roomToken=${token}`;
    if (viewMode) {
        url += `&viewMode=${viewMode}`;
    }
    await page.goto(url);
    await page.waitForTimeout(2000);
};

export const createRoom = async () => {
    const context = await request.newContext();
    const roomResult = await context.post("https://api.netless.link/v5/rooms", {
        headers: {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            token: process.env.VITE_SDK_TOKEN!,
            region: "cn-hz",
            "Content-Type": "application/json",
        },
    });
    const roomBody = await roomResult.json();
    const tokenResult = await context.post(
        `https://api.netless.link/v5/tokens/rooms/${roomBody.uuid}`,
        {
            headers: {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                token: process.env.VITE_SDK_TOKEN!,
                "Content-Type": "application/json",
            },
            data: JSON.stringify({
                lifespan: 0,
                role: "admin",
            }),
        }
    );
    const tokenBody = await tokenResult.json();
    return { uuid: roomBody.uuid, token: tokenBody };
};

export const createApp = async (handle: JSHandle, kind: string) => {
    return await handle.evaluate(
        async (window, { kind }) => {
            const manager = window.manager;
            return await manager.addApp({
                kind,
            });
        },
        { kind }
    );
};

export const getPageState = (handle: JSHandle) => {
    return handle.evaluate(window => window.manager.pageState);
};

export const queryAppLength = (handle: JSHandle) => {
    return handle.evaluate(async window => {
        return window.manager.queryAll().length;
    });
};

export const getRoomPhase = (handle: JSHandle) => {
    return handle.evaluate(async window => {
        return window.room.phase;
    });
};

export const createAnotherPage = async (browser: Browser, uuid: string, token: string, viewMode?: string) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await gotoRoom(page, uuid, token, viewMode);
    const handle = await getWindow(page);
    return { page, handle };
}

export const drawLine = async (page: Page) => {
    const size = page.viewportSize();
    if (!size) return;
    const x = size.width / 2;
    const y = size.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 50, y + 50);
    await page.mouse.move(x + 100, y + 100);
    await page.mouse.up();

    // 笔画只有画的端跟接收端会有细微的不同,刷新后笔迹才相同
    await page.reload();
    await page.waitForTimeout(2000);
}
