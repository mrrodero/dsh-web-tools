# @deepseek-ai/dsh-web-fetch-browser

Headless-browser (Playwright) fetch provider and `web_render` tool for the
DeepSeek Harness web capability seam (`ctx.web`).

- Registers a `WebFetchProvider` under the stable id **`browser`** (opt-in: set
  `web.fetchProvider: browser` in the profile to make it the default fetch path).
- Registers the model-facing **`web_render`** tool: fetch a URL in headless
  Chromium, wait for load, serialize the DOM to readable markdown (turndown +
  GFM), and return title + markdown.
- The browser is launched **per fetch** (no warm singleton, no browser profile
  state). Batch consumers use `BrowserFetchProvider.withBrowser(fn)` to amortize
  one launch across many pages.
- URL policy: http/https only, ≤ 2048 chars, and a manual public-address check
  (blocks loopback, private, link-local, CGNAT, and documentation ranges,
  including IPv4-mapped IPv6 forms).

## Config

| Key | Default | Meaning |
| --- | --- | --- |
| `executablePath` | Playwright's own Chromium | Explicit Chromium executable path (env fallback `DSH_BROWSER_EXECUTABLE_PATH`) |
| `timeoutMs` | `60000` | Navigation timeout (ms) |
| `maxBodyChars` | `100000` | Cap on the serialized rendered DOM (chars) |
| `userAgent` | `deepseek-harness/0.0.1 (+https://github.com/deepseek-ai)` | `User-Agent` sent to rendered pages |
| `registerTool` | `true` | Register the `web_render` tool |
| `renderTimeoutMs` | `90000` | Cooperative budget for one `web_render` call (ms) |
| `renderMaxOutputChars` | `200000` | Cap on the complete rendered tool output (chars) |

## API

```ts
import { BrowserFetchProvider, BROWSER_FETCH_PROVIDER_ID } from '@deepseek-ai/dsh-web-fetch-browser'

const provider = new BrowserFetchProvider({ executablePath: '', timeoutMs: 60_000 })
provider.available()
await provider.fetch({ url: 'https://example.com' })
// One launch for many pages:
await provider.withBrowser(async browser => { /* ... */ })
```

## Known simplification

The SSRF guard resolves DNS before navigation and checks the address class;
the http provider's post-resolution address pinning (TOCTOU protection) is not
yet replicated inside Playwright.
