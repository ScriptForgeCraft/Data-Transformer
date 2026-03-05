import { defineConfig } from "vite";

export default defineConfig({
    resolve: {
        alias: {
            // xlsx uses node-specific modules, we need to handle them
        },
    },
    optimizeDeps: {
        include: ["xlsx", "mammoth"],
    },
});
