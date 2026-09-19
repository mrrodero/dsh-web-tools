import { defineConfig } from 'tsdown'

// Self-contained build for git/tarball installs: transpile src/ to lib/
// without project references or type checking (the prepare script runs it).
// One entry per plugin module; the root entry keeps the package resolvable.
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'web-search-searxng/index': 'src/web-search-searxng/index.ts',
    'web-fetch-browser/index': 'src/web-fetch-browser/index.ts',
    'web-crawl/index': 'src/web-crawl/index.ts',
    'web-local-index/index': 'src/web-local-index/index.ts',
  },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: true,
  clean: true,
})
