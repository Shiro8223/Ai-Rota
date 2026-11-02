import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src"), "@fixtures": path.resolve(__dirname, "fixtures") } },
  test: { environment: "node" },
});
