import { defineConfig } from 'tsdown'

// Self-contained build for git/tarball installs: transpile src/ to lib/
// without project references or type checking (the prepare script runs it).
export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: true,
  clean: true,
})
