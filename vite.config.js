import path from "path";
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { dependencies, peerDependencies, version, devDependencies } from "./package.json"
import { omit } from "lodash";

export default defineConfig(({ mode }) => {
    const isProd = mode === "production";

    return {
        define: {
            __APP_VERSION__: JSON.stringify(version),
            __APP_DEPENDENCIES__: JSON.stringify({
                dependencies, peerDependencies, devDependencies
            }),
        },
        plugins: [
            svelte({
                emitCss: false,
                experimental: {
                    useVitePreprocess: true,
                },
            })
        ],
        build: {
            lib: {
                // eslint-disable-next-line no-undef
                entry: path.resolve(__dirname, "src/index.ts"),
                formats: ["es", "umd"], // TODO cjs 版本待修复
                name: "WindowManager",
                fileName: "index"
            },
            outDir: "dist",
            sourcemap: true,
            rollupOptions: {
                external: Object.keys({
                    ...omit(dependencies, ["@netless/telebox-insider"]),
                    ...peerDependencies,
                }),
            },
            minify: isProd,
        },
    };
});
