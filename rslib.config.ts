import { defineConfig } from "@rslib/core"

export default defineConfig({
  lib: [{
    format: "esm",
    syntax: "es2022",
    dts: true
  }],
  source: {
    entry: {
      index: "./src/index.ts",
      utils: "./src/utils.ts"
    },
    tsconfigPath: "./tsconfig.json"
  },
  output: {
    cleanDistPath: true,
    sourceMap: {
      js: "source-map"
    },
    target: "node"
  }
})
