/**
 * Shared vocabulary for the browser fetch provider and `web_render` tool.
 * @module @deepseek-ai/dsh-web-fetch-browser/types
 */

/** Resolved provider options (the plugin's `apply` fills defaults). */
export interface BrowserFetchProviderOptions {
  /** Path to a Chromium executable; empty = Playwright's own installed browser. */
  readonly executablePath: string
  /** Navigation timeout in milliseconds. */
  readonly timeoutMs: number
  /** Cap on the serialized rendered DOM in characters. */
  readonly maxBodyChars: number
  /** `User-Agent` sent to the page. */
  readonly userAgent: string
}

/** Output value of one `web_render` call (the tool's canonical result shape). */
export interface WebRenderValue {
  /** Final URL after navigation (may differ from the request URL). */
  readonly url: string
  /** HTTP status code of the navigation response (0 when none). */
  readonly statusCode: number
  /** The rendered page's `<title>` text (empty when absent). */
  readonly title: string
  /** The rendered content as markdown. */
  readonly markdown: string
  /** True when the markdown was cut to the output cap. */
  readonly truncated: boolean
}
