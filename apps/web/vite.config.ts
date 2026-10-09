import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset paths, so the build works from any subpath (GitHub Pages).
  base: './',
  test: {
    include: ['test/**/*.test.ts'],
  },
});
