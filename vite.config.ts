/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// The site is served from https://fernforager.github.io/sno-ball/ so every
// asset URL must start with /sno-ball/. Locally, `vite dev` and `vite preview`
// use the same prefix, which keeps the two environments identical.
export default defineConfig({
  base: '/sno-ball/',
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
