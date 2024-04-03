import { SvelteComponentTyped } from "svelte";

declare class Cursor extends SvelteComponentTyped<{
    readonly cursorName: string;
    readonly tagName?: string;
    readonly backgroundColor: string;
    readonly appliance: string;
    readonly x: number;
    readonly y: number;
    readonly src?: string;
    readonly visible: boolean;
    readonly avatar: string;
    readonly theme: string;
    readonly color: string;
    readonly cursorTagBackgroundColor: string;
    readonly opacity: number;
    readonly pencilEraserSize?: number;
    readonly custom?: boolean;
}> {}

export default Cursor;
