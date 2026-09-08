import { defineConfig } from "@rstest/core"

export default defineConfig({
  root: import.meta.dirname,
  include: ["test/**/*.test.ts"],
  testEnvironment: "node",
  testTimeout: 10_000,
  hookTimeout: 10_000,
  source: {
    tsconfigPath: "./tsconfig.test.json"
  }
})
