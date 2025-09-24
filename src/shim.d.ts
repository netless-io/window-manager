import type { SvelteComponent } from "svelte";

declare module "*.svelte" {
    const app: SvelteComponent;
    export default app;
}

declare module "@netless/telebox-insider" {
    export * from "@netless/telebox-insider/dist/index.d.ts";
}

declare global {
    const __APP_VERSION__: string;
    const __APP_DEPENDENCIES__: Record<string, string>;
}
