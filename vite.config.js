/* eslint-disable import/no-anonymous-default-export */
import path from "path";
import { defineConfig } from "vite";

export default defineConfig(({ command, mode }) => {
    const isProd = mode === "production";

    return {
        build: {
            lib: {
                entry: path.resolve(__dirname, "src/index.ts"),
                formats: ["es", "cjs"],
            },
            outDir: "dist",
            sourcemap: false,
            rollupOptions: {
                external: ["react", "white-web-sdk", "react-dom"],
                // plugins: [styles({ mode: "inject" })]
            },
            minify: false,
        },
    };
});
