/* eslint-disable import/no-anonymous-default-export */
import path from "path";
import { defineConfig } from "vite";
import analyze from 'rollup-plugin-analyzer'
import { dependencies ,peerDependencies } from "./package.json"


export default defineConfig(({ command, mode }) => {
    const isProd = mode === "production";

    return {
        build: {
            lib: {
                entry: path.resolve(__dirname, "src/index.ts"),
                formats: ["es","umd"], // TODO cjs 版本待修复
                name: "WindowManager",
                fileName: "index"
            },
            outDir: "dist",
            sourcemap: true,
            rollupOptions: {
                external: Object.keys({
                    ...dependencies,
                    ...peerDependencies,
                }),
            },
            minify: false,
        },
    };
});
