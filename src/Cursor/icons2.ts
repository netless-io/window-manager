import type { MemberState } from "white-web-sdk";
import { ApplianceNames } from "white-web-sdk";

type Color = string;

const staticCircle = `data:image/svg+xml,%3Csvg width='24' height='24' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Ccircle cx='12' cy='12' r='2.5' stroke='%23000' stroke-linejoin='square'/%3E%3Ccircle cx='12' cy='12' r='3.5' stroke='%23FFF'/%3E%3C/g%3E%3C/svg%3E`;

function circleUrl(color: Color): string {
    return `data:image/svg+xml,%3Csvg width='24' height='24' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Ccircle cx='12' cy='12' r='2.5' stroke='%23${color}' stroke-linejoin='square'/%3E%3Ccircle cx='12' cy='12' r='3.5' stroke='%23${color}'/%3E%3C/g%3E%3C/svg%3E`;
}

function crossUrl(color: Color): string {
    return `data:image/svg+xml,%3Csvg width='24' height='24' xmlns='http://www.w3.org/2000/svg' fill='none'%3E%3Cpath d='M5 12H19' stroke='%23${color}' stroke-linejoin='round'/%3E%3Cpath d='M12 5V19' stroke='%23${color}' stroke-linejoin='round'/%3E%3C/svg%3E`;
}

function cssCursor(url: string): string {
    return `url("${url}") 12 12, auto`;
}

function makeStyleContent(config: { [cursor: string]: string }): string {
    let result = "";
    for (const cursor in config) {
        result += `.netless-whiteboard.${cursor} {cursor: ${config[cursor]}}\n`;
    }
    return result;
}

const $style = document.createElement("style");

export function enableLocal(memberState: MemberState): () => void {
    const [r, g, b] = memberState.strokeColor;
    const hex = ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    $style.textContent = makeStyleContent({
        "cursor-pencil": cssCursor(circleUrl(hex)),
        "cursor-eraser": cssCursor(staticCircle),
        "cursor-rectangle": cssCursor(crossUrl(hex)),
        "cursor-ellipse": cssCursor(crossUrl(hex)),
        "cursor-straight": cssCursor(crossUrl(hex)),
        "cursor-arrow": cssCursor(crossUrl(hex)),
        "cursor-shape": cssCursor(crossUrl(hex)),
    });
    document.head.appendChild($style);

    return () => {
        if ($style.parentNode == null) return;
        document.head.removeChild($style);
    };
}

const shapeAppliances: Set<ApplianceNames> = new Set([
    ApplianceNames.rectangle,
    ApplianceNames.ellipse,
    ApplianceNames.straight,
    ApplianceNames.arrow,
    ApplianceNames.shape,
]);

export function remoteIcon(applianceName: ApplianceNames, hex: string): string | undefined {
    if (applianceName === ApplianceNames.pencil) {
        return circleUrl(hex);
    } else if (applianceName === ApplianceNames.eraser) {
        return staticCircle;
    } else if (shapeAppliances.has(applianceName)) {
        return crossUrl(hex);
    }
}
