import { defineConfig } from 'vitest/config';

// Bundles the engine as a dependency-free ES module. No Node built-ins are
// allowed, so the output runs unchanged in Cloudflare Workers.
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: 'engine',
    },
    rollupOptions: {
      // Any bare import (e.g. 'node:fs') would fail the build instead of being externalised.
      external: [],
    },
    target: 'es2022',
    minify: false,
  },
  test: {
    include: ['test/**/*.test.ts'],
    // Most tests run the simulation for game months: 5 s (the default) is too tight on a busy machine.
    testTimeout: 30_000,
  },
});
