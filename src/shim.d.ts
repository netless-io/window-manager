import type { SvelteComponent } from "svelte";

declare module "*.svelte" {
    const app: SvelteComponent;
    export default app;
}

declare global {
    const __APP_VERSION__: string;
    const __APP_DEPENDENCIES__: Record<string, string>;
}
