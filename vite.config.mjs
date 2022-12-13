import path from "path";
import dts from "vite-plugin-dts";
import { svelte, vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vitest/config";
import { dependencies, peerDependencies, version, devDependencies } from "./package.json";
import lodash from "lodash";

export default defineConfig(() => {
    // const isProd = mode === "production";

    return {
        test: {
            environment: "jsdom",
            deps: {
                inline: ["@juggle/resize-observer"],
            },
            setupFiles: "./test/setup.ts",
            include: ["test/**/*.test.ts"],
        },
        define: {
            __APP_VERSION__: JSON.stringify(version),
            __APP_DEPENDENCIES__: JSON.stringify({
                dependencies,
                peerDependencies,
                devDependencies,
            }),
        },
        plugins: [
            svelte({
                emitCss: false,
                preprocess: vitePreprocess(),
            }),
            dts(),
        ],
        build: {
            lib: {
                // eslint-disable-next-line no-undef
                entry: path.resolve(__dirname, "src/index.ts"),
                formats: ["es", "umd", "cjs"],
                name: "WindowManager",
                fileName: "index",
            },
            outDir: "dist",
            rollupOptions: {
                external: Object.keys({
                    ...lodash.omit(dependencies, ["@netless/telebox-insider"]),
                    ...peerDependencies,
                }),
            },
            minify: false,
        },
    };
});
