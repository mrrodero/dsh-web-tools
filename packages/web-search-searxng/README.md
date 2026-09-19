---
description: "The self-hosted SearXNG search provider for ctx.web: how deployments point the unified web_search tool at their own meta-search instance over its JSON API."
kind: "package-reference"
---

# @deepseek-ai/dsh-web-search-searxng

English | [中文](README.zh.md)

## Summary

With `dsh-web-search-searxng`, the harness searches the web through a self-hosted SearXNG instance and gets its aggregated, per-engine results with portable snippets and publication dates. Choose it when a deployment runs a SearXNG instance on its own network and wants no vendor key, no external API, and its own engine mix. SearXNG returns no generated answer, so results carry no `content` — only citeable sources. A result with no non-blank snippet is dropped, so a call can return fewer sources than requested. The model-facing `web_search` tool lives in `dsh-tool-web`.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the provider in a composition that already loads the web service; it registers as the `searxng` search provider, so `ctx.web.search()` resolves it automatically when it is the only usable search backend — or pin it with `searchProvider: searxng`.

### When to choose it

Choose this backend when a deployment runs a SearXNG instance (typically on a private LAN) and wants self-hosted meta-search with no vendor key and no external API. The provider is unavailable — and every search call fails with a structured error — when the instance base URL is empty or does not parse. The instance itself needs the JSON format enabled (`search.formats` including `json`) or every search fails with `WEB_PROVIDER_ERROR` HTTP 403.

### Minimal configuration

Load the web service and the provider; the base URL falls back to `$SEARXNG_BASE_URL` from the launch environment, and all other settings are optional.

```yaml
- name: '@deepseek-ai/dsh-web'
- name: '@deepseek-ai/dsh-web-search-searxng'
  config:
    baseURL: http://192.168.1.50:8888
```

| Field | Default | Meaning |
|---|---|---|
| `baseURL` | `$SEARXNG_BASE_URL` | Instance base URL; `/search` is appended. Empty or unparseable makes the provider unavailable |
| `categories` | (unset) | Comma-separated SearXNG categories (e.g. `general,news`); omitted = the instance default |
| `language` | (unset) | SearXNG language code (e.g. `en`, `all`); omitted = the instance default |
| `timeRange` | (unset) | Restrict results to the last `day`, `month`, or `year`; omitted = no restriction |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-web-search-searxng) is the exhaustive source for every accepted field and its JSDoc.

### What a search returns

Each SearXNG result maps to a `WebSearchSource`: `url`, `title`, `content` as `snippet`, and `publishedDate` as `publishedAt` when the upstream engine supplies one. A result with no non-blank `content` has no portable snippet and is dropped. The request's `maxResults` is enforced by the service, which truncates and flags; SearXNG has no result-count parameter, so the provider sends the full page and lets the seam cap it. SearXNG returns no generated answer, so the result carries no `content`.

### Failures and recovery

Provider failures — HTTP errors, network failures, unparseable or wrong-shape bodies — surface as `WebError` `WEB_PROVIDER_ERROR`; an aborted request surfaces as `WEB_ABORTED`. HTTP redirects are rejected before the `Location` target is contacted and surface as `WEB_PROVIDER_ERROR`. A 403 usually means the instance has the JSON format disabled. Callers route on the code; the model-facing `web_search` tool surfaces failures to the model under its own error wrapper.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the provider; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

The provider is a thin adapter over SearXNG's JSON API with two deliberate rules:

- **Portable snippets only.** A source gains a `snippet` only from a real `content` field; inventing one from other fields would make the seam lie, so snippet-less results are dropped entirely.
- **No invented answers.** SearXNG returns no generated answer, so `content` is omitted rather than fabricating provider prose the model might trust.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: config schema, environment fallback, provider registration |
| [`src/provider.ts`](src/provider.ts) | The `SearxngSearchProvider`: request dispatch, abort classification, result mapping |
| [`src/types.ts`](src/types.ts) | SearXNG wire types: `SearxngSearchResponse`, `SearxngResult`, `SearxngUnresponsiveEngine` |
| — | No runtime invariant companion is published; this package exposes no independent event sequence or mutable data relation beyond contracts enforced at its owning seam. |

### Request and mapping flow

`search()` GETs `{baseURL}/search` with `q`, `format=json`, and the optional `categories`/`language`/`time_range` filters, with `redirect: 'error'`, so a redirect fails the request without contacting the target. The parsed `results[]` are mapped one by one, snippet-less entries dropped, and the service applies the final `maxResults` bound on the way back. An abort — a `DOMException` named `AbortError` — becomes `WEB_ABORTED`; anything else becomes `WEB_PROVIDER_ERROR`.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the shared vocabulary to the service, the model-facing tools, and the design rationale.

- [Web subsystem](../../../docs/subsystems/web.md) — the exhaustive search request/result vocabulary and error codes.
- [Web package map](../README.md) — the package family and each role.
- [dsh-web](../web/README.md) — the web service this provider registers into.
- [dsh-tool-web](../tool-web/README.md) — the model-facing `web_search` tool that renders this provider's sources.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-web-search-searxng) — every accepted config field and its source declaration.
- [Web capability seam decision](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.md) — why search and fetch share one provider-selection service.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `dsh-tool-web`, which retains this provider's `maxResults`-bounded URLs, titles, snippets, and publication dates or its exact `SearXNG search aborted`, `SearXNG search request failed: <error>`, and `SearXNG returned an unprocessable response body: <error>` failures under the consumer's error wrapper.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when the provider is a poor fit. They are current package constraints.

- **A result with no non-blank `content` is dropped entirely** — there is no portable snippet to map, so fewer sources than requested can return.
- **`publishedAt` is engine-dependent** — most upstream engines omit `publishedDate`, so most sources carry no publication date.
- **Instance quality depends on upstream engines** — engines that get bot-blocked from the instance's IP degrade results over time; the instance's `/stats` page and the response's `unresponsive_engines` are the tuning surface.
- **The instance has no API auth** — it must stay on a trusted network; the provider carries no credential of its own.
- **Abort classification is error-shape-based** — only a `DOMException` named `AbortError` maps to `WEB_ABORTED`; an abort carrying a custom reason (such as `dsh-timeout`'s `TimeoutReason`) surfaces as `WEB_PROVIDER_ERROR`.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior, limits, and rationale live in the sections above and the linked Agent Notes.

#### Future: wider SearXNG control surface

SearXNG's remaining controls — `pageno`, `safesearch`, site bangs, and per-engine toggles — stay unexposed. Exposing them needs provider-neutral service fields first, so the family adds one coordinated control rather than a vendor-specific argument.

</details>
