# dsh-web-tools

Locally hosted, API-free web capability bundle for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness):
self-web-search, fetching, rendering, crawling, and a local corpus index — no keys, no quotas, no SaaS.

One bundle, four plugin modules — a single npm package (`@deepseek-ai/dsh-web-tools`)
with four subpath entry points, because pnpm does not resolve `workspace:`
dependencies inside a git-dependency clone:

| Module (subpath) | Contributes |
| --- | --- |
| [`web-search-searxng`](src/web-search-searxng) | `web_search` backend: a `WebSearchProvider` for a self-hosted [SearXNG](https://docs.searxng.org/) instance |
| [`web-fetch-browser`](src/web-fetch-browser) | `web_render` tool + `browser` fetch provider: headless Chromium (Playwright) rendering to markdown |
| [`web-crawl`](src/web-crawl) | `web_crawl` tool: same-domain BFS crawl with robots.txt policy, HTTP or browser rendering, auto-indexing |
| [`web-local-index`](src/web-local-index) | `local_search` tool + `indexed` fetch provider: SQLite FTS5 + MiniLM embeddings over everything fetched/crawled |

The bundle's `cordis.patch.yml` registers all four modules as plugin rows
(`@deepseek-ai/dsh-web-tools/<module>`).

## Install

Install the whole bundle into a profile (e.g. `web`):

```sh
dsh plugin --profile web add github:mrrodero/dsh-web-tools#<commit-sha>
```

pnpm blocks dependency build scripts by default; allow the bundle's `prepare`
build (which compiles all four modules) in the profile's `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  '@deepseek-ai/dsh-web-tools': true
  esbuild: false          # transitive dep of tsdown; platform binary ships prebuilt
  onnxruntime-node: true
```

Then point the profile's patch at the bundle and its config:

```yaml
dsh.profile.bundles:
  - dsh-base
  - dsh-web-app
  - dsh-web-tools

web:
  searchProvider: searxng
  fetchProvider: indexed

web-search-searxng:
  baseURL: http://192.168.144.120:8888

web-local-index:
  # dbPath: /path/to/index.db   # default: $DSH_HOME/data/web-index/index.db
  # maxResults: 8
  # maxQueries: 4

web-crawl:
  # maxPages: 50
  # maxDepth: 3
  # delayMs: 500

web-fetch-browser:
  # executablePath: ''         # default: Playwright's own Chromium
  # timeoutMs: 60000
  # maxBodyChars: 100000
```

Bundle membership changes require a server restart; patch edits hot-reload.

## The tool surface

- **`web_search`** — live search through SearXNG (the existing built-in tool, now backed by your own instance).
- **`web_fetch`** — built-in fetch; with `fetchProvider: indexed`, every successful fetch is also stored in the local corpus.
- **`web_render`** — fetch a page in headless Chromium and return readable markdown (opt-in per call).
- **`web_crawl`** — crawl a same-domain site (robots.txt-respecting, rate-limited); each page is extracted to markdown and indexed.
- **`local_search`** — search the local corpus (lexical FTS5 BM25, semantic MiniLM embeddings, or RRF-fused hybrid). Answers from what the session has already fetched or crawled.

## The local index

- One SQLite file (`$DSH_HOME/data/web-index/index.db`, built-in `node:sqlite`, WAL).
- Pages are deduped by URL (latest index wins); content is chunked (~800 chars) for embedding.
- The embedding model (`all-MiniLM-L6-v2`, ~23 MB quantized ONNX) downloads to
  `$DSH_HOME/data/web-index/models/` on first use; until it is ready (or if it fails),
  search degrades to lexical-only.
- Scale expectations: ~50 pages ≈ 1 MB; 1,000 ≈ 50 MB; 10,000 ≈ 150 MB of vectors.
  Backup = copy the file. `pruneIndex` (exposed in the API) removes stale pages or whole domains.

## Known simplifications (wave 1)

- Browser SSRF guard: pre-navigation DNS public-address check; the http provider's
  address-pinning (TOCTOU) hardening is not replicated inside Playwright yet.
- The `indexed` provider wraps the default HTTP fetch limits (5 MB / 100k chars / 30 s).
- KNN runs in JS over in-memory vectors — sub-second at wave-1 scale; a vector
  extension (e.g. sqlite-vec) is the wave-2 upgrade path.

## Development

```sh
pnpm install
pnpm build
pnpm test
```

Node ≥ 24 (uses built-in `node:sqlite`). Playwright's Chromium is downloaded on
`pnpm install` (postinstall) for the browser module.
