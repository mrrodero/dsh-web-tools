/**
 * @deepseek-ai/dsh-web-fetch-browser — headless-browser (Playwright) fetch
 * provider and `web_render` tool for the DeepSeek Harness web capability
 * seam (`ctx.web`). Registers a `WebFetchProvider` under the `browser` id
 * and, by default, the model-facing `web_render` tool. The browser is
 * launched per fetch (no warm singleton, no profile state); batch consumers
 * use `withBrowser` to amortize one launch across many pages.
 * @module @deepseek-ai/dsh-web-fetch-browser
 */

import type { Context } from '@deepseek-ai/cordis'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import z from '@deepseek-ai/schemastery'
import { BrowserFetchProvider, BROWSER_FETCH_PROVIDER_ID } from './provider.ts'
import { applyWebRenderTool } from './tool.ts'
import type { BrowserFetchProviderOptions, WebRenderValue } from './types.ts'

export { BrowserFetchProvider, BROWSER_FETCH_PROVIDER_ID } from './provider.ts'
/** The Playwright browser handle `withBrowser` hands to batch consumers. */
export type { Browser } from 'playwright'
export { htmlToMarkdown, extractTitle } from './render.ts'
export { validateBrowserUrl, isPublicAddress, MAX_URL_LENGTH } from './policy.ts'
export { EXTERNAL_WEB_CONTENT_NOTICE } from './trust.ts'
export type { BrowserFetchProviderOptions, WebRenderValue } from './types.ts'

/** Plugin registration name (the `id` in profile/bundle patch rows). */
export const name = 'web-fetch-browser'

/** Services this plugin requires from the host composition. */
export const inject = ['web', 'tools', 'systemPrompt']

/** Default navigation timeout for rendered fetches (ms). */
export const DEFAULT_RENDER_TIMEOUT_MS = 60_000

/** Default cooperative budget for the `web_render` tool call (ms). */
export const DEFAULT_RENDER_TOOL_TIMEOUT_MS = 90_000

/** Default cap on the serialized rendered DOM (chars). */
export const DEFAULT_MAX_BODY_CHARS = 100_000

/** Default cap on the complete rendered tool output (chars). */
export const DEFAULT_RENDER_MAX_OUTPUT_CHARS = 200_000

/** Default `User-Agent` sent to rendered pages. */
export const DEFAULT_USER_AGENT = 'deepseek-harness/0.0.1 (+https://github.com/deepseek-ai)'

/** Environment key for an explicit Chromium executable path. */
export const BROWSER_EXECUTABLE_ENV_KEY = 'DSH_BROWSER_EXECUTABLE_PATH'

/** Deployment configuration for the browser fetch provider. */
export interface Config {
  /** Path to a Chromium executable; empty = Playwright's own installed browser. */
  executablePath?: string
  /** Navigation timeout in milliseconds. */
  timeoutMs?: number
  /** Cap on the serialized rendered DOM (chars). */
  maxBodyChars?: number
  /** `User-Agent` sent to rendered pages. */
  userAgent?: string
  /** Register the `web_render` tool (default true). */
  registerTool?: boolean
  /** Cooperative budget for the `web_render` tool call (ms). */
  renderTimeoutMs?: number
  /** Cap on the complete rendered tool output (chars). */
  renderMaxOutputChars?: number
}

/**
 * The deployment configuration: an executable path (with an environment
 * fallback), navigation timeout, body cap, user agent, and the tool's
 * budget/output cap. Every field is optional with a safe default.
 */
export const Config: z<Config> = z.object({
  executablePath: z.string(),
  timeoutMs: z.number().default(DEFAULT_RENDER_TIMEOUT_MS),
  maxBodyChars: z.number().default(DEFAULT_MAX_BODY_CHARS),
  userAgent: z.string().default(DEFAULT_USER_AGENT),
  registerTool: z.boolean().default(true),
  renderTimeoutMs: z.number().default(DEFAULT_RENDER_TOOL_TIMEOUT_MS),
  renderMaxOutputChars: z.number().default(DEFAULT_RENDER_MAX_OUTPUT_CHARS),
})

/**
 * Wire the browser fetch provider and the `web_render` tool into the host
 * composition. All registrations are effect-scoped and disappear with the
 * plugin's effect.
 *
 * @param ctx - the host context providing the `web`, `tools`, and
 *   `systemPrompt` registries.
 * @param config - the deployment configuration (validated by {@link Config}).
 */
export function apply(ctx: Context, config: Config): void {
  const envExecutable = launchEnvironmentOf(ctx).get(BROWSER_EXECUTABLE_ENV_KEY)?.value
  const options: BrowserFetchProviderOptions = {
    executablePath: config.executablePath ?? envExecutable ?? '',
    timeoutMs: config.timeoutMs ?? DEFAULT_RENDER_TIMEOUT_MS,
    maxBodyChars: config.maxBodyChars ?? DEFAULT_MAX_BODY_CHARS,
    userAgent: config.userAgent ?? DEFAULT_USER_AGENT,
  }
  const provider = new BrowserFetchProvider(options)
  ctx.web.registerFetchProvider(provider)
  if (config.registerTool ?? true) {
    applyWebRenderTool(
      ctx,
      provider,
      config.renderTimeoutMs ?? DEFAULT_RENDER_TOOL_TIMEOUT_MS,
      config.renderMaxOutputChars ?? DEFAULT_RENDER_MAX_OUTPUT_CHARS,
    )
  }
}
