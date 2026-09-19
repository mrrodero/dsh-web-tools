# @deepseek-ai/dsh-web-crawl

The `web_crawl` tool: same-domain site crawling for the DeepSeek Harness web
capability bundle.

- BFS crawl from a seed URL, **same-domain only** (www-tolerant), with a
  robots.txt policy fetched and honored per domain (allow beats disallow on
  ties; `*` wildcards and `$` anchors supported).
- Rate-limited: a configurable delay between page fetches (default 500 ms).
- Two render modes:
  - `none` — plain HTTP fetch (node `fetch`), HTML only, 5 MB response cap.
  - `browser` — headless Chromium via `web-fetch-browser`'s
    `BrowserFetchProvider.withBrowser`: **one launch for the whole crawl**.
- Extraction: cheerio strips script/style/nav/footer/aside/head, prefers
  `main`/`article`/`[role="main"]`/`#content`/`.content`/`#main`/`.main`
  (fallback: body), then converts to markdown (shared `htmlToMarkdown`).
- Every crawled page is indexed into the local corpus (`web-local-index`)
  unless `index: false`.
- Output: a trust notice, a summary (pages fetched/failed/skipped, elapsed
  time), a sitemap, and per-page excerpts capped at `maxOutputChars`
  (default 200k — oversized results spill via the host's spill policy).

## Tool arguments

| Arg | Default | Meaning |
| --- | --- | --- |
| `url` | — | Seed URL (http/https) |
| `maxPages` | `50` | Page budget |
| `maxDepth` | `3` | Max hop distance from the seed |
| `render` | `none` | `none` (HTTP) or `browser` (Chromium) |
| `index` | `true` | Store pages in the local corpus |

## Config

| Key | Default | Meaning |
| --- | --- | --- |
| `maxPages` | `50` | Default page budget |
| `maxDepth` | `3` | Default max depth |
| `delayMs` | `500` | Delay between page fetches (ms) |
| `maxPageChars` | `20000` | Per-page extracted content cap (chars) |
| `maxResponseBytes` | `5000000` | HTTP response cap (bytes) |
| `navigationTimeoutMs` | `60000` | Browser navigation timeout (ms) |
| `maxOutputChars` | `200000` | Cap on the tool output (chars) |
| `executablePath` | Playwright's own Chromium | Chromium executable path (env fallback `DSH_BROWSER_EXECUTABLE_PATH`) |
| `userAgent` | `deepseek-harness/0.0.1 (+https://github.com/deepseek-ai)` | `User-Agent` for fetches and robots.txt matching |
