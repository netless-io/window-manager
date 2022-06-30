import { defineConfig } from "vite";

export default defineConfig({
    server: {
        port: 4000,
        watch: {
            interval: 10000,
        }
    },
});
