import type { NetlessApp } from "../../dist";
import { WindowManager } from "../../dist";

type BoxSize = { width: number; height: number };

const formatSize = ({ width, height }: BoxSize): string =>
    `${width.toFixed(1)} x ${height.toFixed(1)} px`;

export const BoxSizeListener: NetlessApp = {
    kind: "BoxSizeListener",
    setup: context => {
        const content = document.createElement("div");
        content.style.cssText =
            "position:relative;width:100%;height:100%;overflow:hidden;background:#f4f7fb;";

        const panel = document.createElement("pre");
        panel.style.cssText =
            "position:absolute;z-index:1;top:12px;left:12px;margin:0;padding:12px;" +
            "background:rgba(255,255,255,.92);border:1px solid #b9c5d6;border-radius:4px;" +
            "color:#1f2937;font:13px/1.5 monospace;pointer-events:none;";
        content.appendChild(panel);

        let eventCount = 0;
        let latestSize: BoxSize | undefined;

        const render = () => {
            const domRect = content.getBoundingClientRect();
            const lines = [
                "boxSizeChange listener",
                `events: ${eventCount}`,
                `event size: ${latestSize ? formatSize(latestSize) : "waiting..."}`,
                `content DOM: ${formatSize({ width: domRect.width, height: domRect.height })}`,
                `updated: ${latestSize ? new Date().toLocaleTimeString() : "-"}`,
            ];
            panel.textContent = lines.join("\n");
        };

        const offBoxSizeChange = context.emitter.on("boxSizeChange", payload => {
            if (payload.appId !== context.appId) return;

            eventCount += 1;
            latestSize = { width: payload.width, height: payload.height };
            render();
            const domRect = content.getBoundingClientRect();
            const widthDelta = domRect.width - payload.width;
            const heightDelta = domRect.height - payload.height;
            console.log("[BoxSizeListener] boxSizeChange", {
                appId: payload.appId,
                eventCount,
                ...latestSize,
            });
            console.log(
                `[BoxSizeListener] sample=${eventCount} event=${formatSize(latestSize)} ` +
                    `dom=${formatSize({ width: domRect.width, height: domRect.height })} ` +
                    `delta=${widthDelta.toFixed(1)} x ${heightDelta.toFixed(1)} px`
            );
        });

        context.getBox().$content.appendChild(content);
        context.mountView(content);
        render();

        context.emitter.on("destroy", () => {
            offBoxSizeChange();
            content.remove();
        });
    },
};

WindowManager.register({
    kind: BoxSizeListener.kind,
    src: BoxSizeListener,
});
