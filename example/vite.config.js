import path from "path";
import fs from "fs";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { defineConfig } from "vite";

const demoDir = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const whiteWebSdkPackagePath = require.resolve("white-web-sdk/package.json");
const whiteWebSdkRequire = createRequire(whiteWebSdkPackagePath);
const agoraFoundationRoot = path.dirname(require.resolve("agora-foundation/package.json"));
const agoraFoundationRequire = createRequire(path.join(agoraFoundationRoot, "package.json"));
const localLogStubRoot = path.resolve(demoDir, "src/local-log");
const resolveDemoPackage = packageName => require.resolve(packageName);

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collectAgoraFoundationOptimizeDeps() {
    const deps = new Set();
    const scanDir = path.join(agoraFoundationRoot, "lib-es");
    const importPattern = /(?:import\s+(?:[^'"]+\s+from\s+)?|export\s+[^'"]+\s+from\s+)["']([^"']+)["']/g;

    const scanFile = filePath => {
        const source = fs.readFileSync(filePath, "utf8");
        let match;

        while ((match = importPattern.exec(source))) {
            const id = match[1];

            if (!id.startsWith(".") && !id.startsWith("/") && !id.startsWith("\0")) {
                deps.add(id);
            }
        }
    };

    const walk = dir => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const entryPath = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                walk(entryPath);
            } else if (entry.isFile() && entry.name.endsWith(".js")) {
                scanFile(entryPath);
            }
        }
    };

    walk(scanDir);
    return [...deps].filter(id => {
        try {
            agoraFoundationRequire.resolve(id);
            return true;
        } catch {
            return false;
        }
    }).sort();
}

const agoraFoundationOptimizeDeps = collectAgoraFoundationOptimizeDeps();
const agoraFoundationDependencyAliases = agoraFoundationOptimizeDeps.map(id => ({
    find: new RegExp(`^${escapeRegExp(id)}$`),
    replacement: agoraFoundationRequire.resolve(id),
}));

export default defineConfig({
    resolve: {
        alias: [
            {
                find: /^readable-stream$/,
                replacement: path.join(localLogStubRoot, "readable-stream-browser-stub.js"),
            },
            {
                find: /^stream$/,
                replacement: path.join(localLogStubRoot, "readable-stream-browser-stub.js"),
            },
            ...agoraFoundationDependencyAliases,
            {
                find: /^winston$/,
                replacement: path.join(localLogStubRoot, "winston-browser-stub.js"),
            },
            {
                find: /^winston-transport$/,
                replacement: path.join(localLogStubRoot, "winston-transport-browser-stub.js"),
            },
            {
                find: /^agora-foundation$/,
                replacement: path.join(agoraFoundationRoot, "lib-es/index.js"),
            },
            {
                find: /^agora-foundation\/lib\/(.*)$/,
                replacement: `${agoraFoundationRoot}/lib-es/$1`,
            },
            {
                find: /^agora-foundation\/(.*)$/,
                replacement: `${agoraFoundationRoot}/$1`,
            },
            {
                find: /^@netless\/app-plyr$/,
                replacement: resolveDemoPackage("@netless/app-plyr"),
            },
            {
                find: /^mobx$/,
                replacement: whiteWebSdkRequire.resolve("mobx/dist/mobx.esm.js"),
            },
        ],
        dedupe: ["white-web-sdk", "agora-foundation", "react", "react-dom", "mobx"],
    },
    optimizeDeps: {
        include: [
            "white-web-sdk",
            "agora-foundation/lib/logger",
            "agora-foundation/lib/logger/common",
            "agora-foundation/package.json",
            ...agoraFoundationOptimizeDeps,
        ],
    },
    server: {
        port: 4000,
        fs: {
            allow: [
                path.resolve(demoDir, "../.."),
            ],
        },
    },
    build: {
        commonjsOptions: {
            include: [
                /node_modules/,
            ],
            transformMixedEsModules: true,
            ignoreTryCatch: false,
        },
    },
});
