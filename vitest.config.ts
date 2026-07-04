import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/safety/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@minecraft/server": path.resolve(__dirname, "tests/setup/MinecraftServerMock.ts"),
    },
  },
});
