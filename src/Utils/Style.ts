
export const isServer = typeof window === "undefined" || typeof window.document === "undefined";

const STYLE_ID = "__netless_window_manager_stylesheet"

export function injectStyle(style: string) {
    if (!isServer) {
        const styleDom = document.getElementById(STYLE_ID) as HTMLStyleElement;
        if (styleDom) return;
        const styleElement = document.createElement("style");
        styleElement.innerHTML = style;
        styleElement.id = STYLE_ID;
        return document.head.appendChild(styleElement);
    }
}
