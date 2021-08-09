/* eslint-disable import/no-anonymous-default-export */
import path from "path";

export default ({ command, mode }) => {
    const isProd = mode === "production";

    return {
        build: {
            lib: {
                entry: path.resolve(__dirname, "src/index.ts"),
                formats: ["es", "cjs"],
            },
            outDir: "dist",
            rollupOptions: {
                external: ["react", "white-web-sdk", "react-dom"],
            },
            minify: false,
        },
    };
};
