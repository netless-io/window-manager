/* eslint-env node */

/** @type {import('ts-jest/dist/types').InitialOptionsTsJest} */
module.exports = {
    preset: "ts-jest",
    testEnvironment: "jsdom",
    globals: {
      "ts-jest": {
        tsconfig: "./test/tsconfig.json",
      },
    },
    testMatch: ["**/test/*.test.ts", "**/test/**/*.test.ts"],
    setupFiles: ["jest-canvas-mock", "jest-fetch-mock"],
    transform: {
        '^.+\\.svelte$': [
            'svelte-jester',
            {
                "preprocess": true
            }
        ],
        ".+\\.(css|svg|styl|less|sass|scss|png|jpg|ttf|woff|woff2)$": "jest-transform-stub"
    },
    moduleNameMapper: {
        "^.+.(css|styl|less|sass|scss|png|jpg|ttf|woff|woff2)$": "jest-transform-stub"
    }
  };
