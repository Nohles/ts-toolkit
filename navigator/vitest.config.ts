import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "jsdom",
        include: ["test/**/*.test.ts"],
        maxWorkers: 2,
        restoreMocks: true,
    },
});
