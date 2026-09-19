---
description: "面向 ctx.web 的自托管 SearXNG 搜索提供商：部署如何通过其 JSON API 把统一的 web_search 工具指向自己的元搜索实例。"
kind: "package-reference"
---

# @deepseek-ai/dsh-web-search-searxng

[English](README.md) | 中文

## 摘要

借助 `dsh-web-search-searxng`，harness 通过自托管的 SearXNG 实例搜索网络，获得其聚合的各引擎结果，附带可移植的摘要与发布日期。当部署在自己的网络上运行 SearXNG 实例、希望不依赖供应商密钥、不访问外部 API、并自行控制引擎组合时，应选择它。SearXNG 不返回生成的答案，因此结果不含 `content`——只有可引用的来源。没有非空摘要的结果会被丢弃，因此一次调用可能返回少于请求数量的来源。面向模型的 `web_search` 工具位于 `dsh-tool-web`。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与推迟工作](#known-limitations-and-deferred-work)
- [开发者备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在已加载 web 服务的组合中挂载该提供商；它注册为 `searxng` 搜索提供商，因此当它是唯一可用的搜索后端时，`ctx.web.search()` 会自动解析它——也可以用 `searchProvider: searxng` 显式固定。

### 何时选择它

当部署在私有网络上运行 SearXNG 实例、希望自托管元搜索且不使用供应商密钥或外部 API 时，选择此后端。当实例基础 URL 为空或无法解析时，该提供商不可用——每次搜索调用都会以结构化错误失败。实例本身需要启用 JSON 格式（`search.formats` 包含 `json`），否则每次搜索都会以 `WEB_PROVIDER_ERROR` HTTP 403 失败。

### 最小配置

加载 web 服务与提供商；基础 URL 回退到启动环境中的 `$SEARXNG_BASE_URL`，其余设置均可选。

```yaml
- name: '@deepseek-ai/dsh-web'
- name: '@deepseek-ai/dsh-web-search-searxng'
  config:
    baseURL: http://192.168.1.50:8888
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `baseURL` | `$SEARXNG_BASE_URL` | 实例基础 URL；会追加 `/search`。为空或无法解析会使提供商不可用 |
| `categories` | (未设置) | 逗号分隔的 SearXNG 分类（如 `general,news`）；省略 = 实例默认值 |
| `language` | (未设置) | SearXNG 语言代码（如 `en`、`all`）；省略 = 实例默认值 |
| `timeRange` | (未设置) | 将结果限制在最近 `day`、`month` 或 `year` 内；省略 = 不限制 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-web-search-searxng)是每个可接受字段及其 JSDoc 的完整权威来源。

### 搜索返回什么

每个 SearXNG 结果映射为一个 `WebSearchSource`：`url`、`title`、`content` 作为 `snippet`，以及上游引擎提供时的 `publishedDate` 作为 `publishedAt`。没有非空 `content` 的结果没有可移植摘要，会被丢弃。请求的 `maxResults` 由服务强制执行（截断并标记）；SearXNG 没有结果数量参数，因此提供商发送完整页面，由缝隙层封顶。SearXNG 不返回生成的答案，因此结果不含 `content`。

### 失败与恢复

提供商失败——HTTP 错误、网络失败、无法解析或形状错误的响应体——以 `WebError` `WEB_PROVIDER_ERROR` 呈现；被中止的请求以 `WEB_ABORTED` 呈现。HTTP 重定向在接触 `Location` 目标之前即被拒绝，并以 `WEB_PROVIDER_ERROR` 呈现。403 通常意味着实例未启用 JSON 格式。调用方按错误码路由；面向模型的 `web_search` 工具在其自身的错误包装下向模型呈现失败。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

本节解释该提供商背后的设计决策；可观察行为已完整覆盖于[使用此包](#use-this-package)。

### 设计哲学

该提供商是 SearXNG JSON API 上的薄适配器，遵循两条刻意规则：

- **仅可移植摘要。** 来源的 `snippet` 只来自真实的 `content` 字段；从其他字段编造摘要会让缝隙层说谎，因此没有摘要的结果被整体丢弃。
- **不编造答案。** SearXNG 不返回生成的答案，因此省略 `content`，而不是编造模型可能信任的提供商文字。

### 源码地图

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：配置模式、环境变量回退、提供商注册 |
| [`src/provider.ts`](src/provider.ts) | `SearxngSearchProvider`：请求分发、中止分类、结果映射 |
| [`src/types.ts`](src/types.ts) | SearXNG 线型：`SearxngSearchResponse`、`SearxngResult`、`SearxngUnresponsiveEngine` |
| — | 不发布运行时不变量伴生包；此包除其拥有缝隙强制的契约外，不暴露独立的事件序列或可变数据关系。 |

### 请求与映射流程

`search()` 以 `q`、`format=json` 以及可选的 `categories`/`language`/`time_range` 过滤项 GET `{baseURL}/search`，并设置 `redirect: 'error'`，因此重定向会在接触目标前使请求失败。解析后的 `results[]` 逐条映射，没有摘要的条目被丢弃，服务在返回路上应用最终的 `maxResults` 上限。中止——名为 `AbortError` 的 `DOMException`——变为 `WEB_ABORTED`；其余一切变为 `WEB_PROVIDER_ERROR`。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级契约不够时阅读这些页面。它们从共享词汇出发，走向服务、面向模型的工具与设计依据。

- [Web 子系统](../../../docs/subsystems/web.zh.md) — 完整的搜索请求/结果词汇与错误码。
- [Web 包地图](../README.zh.md) — 包家族及各自角色。
- [dsh-web](../web/README.zh.md) — 该提供商注册进入的 web 服务。
- [dsh-tool-web](../tool-web/README.zh.md) — 渲染该提供商来源的面向模型 `web_search` 工具。
- [生成的配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-web-search-searxng) — 每个可接受配置字段及其源声明。
- [Web 能力缝隙决策](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.zh.md) — 为什么搜索与抓取共享一个提供商选择服务。

-----

<a id="model-experience"></a>
## 模型体验

间接地，通过 `dsh-tool-web`——它保留该提供商经 `maxResults` 封顶的 URL、标题、摘要与发布日期，或在消费者的错误包装下保留其确切的 `SearXNG search aborted`、`SearXNG search request failed: <error>`、`SearXNG returned an unprocessable response body: <error>` 失败。

#### KV 缓存影响

无直接失效；具名消费者负责任何请求前缀变更。

## 已知限制与推迟工作

<a id="known-limitations-and-deferred-work"></a>


这些限制定义了该提供商不适合的场景。它们是当前的包约束。

- **没有非空 `content` 的结果被整体丢弃** — 没有可映射的可移植摘要，因此可能返回少于请求数量的来源。
- **`publishedAt` 依赖引擎** — 大多数上游引擎省略 `publishedDate`，因此大多数来源没有发布日期。
- **实例质量取决于上游引擎** — 被实例 IP 机器人封锁的引擎会随时间降低结果质量；实例的 `/stats` 页面与响应中的 `unresponsive_engines` 是调优面。
- **实例没有 API 鉴权** — 它必须留在受信任网络内；提供商自身不携带凭据。
- **中止分类基于错误形状** — 只有名为 `AbortError` 的 `DOMException` 映射为 `WEB_ABORTED`；携带自定义原因（如 `dsh-timeout` 的 `TimeoutReason`）的中止呈现为 `WEB_PROVIDER_ERROR`。

<a id="dev-note"></a>
### 开发者备注

<details>
<summary>面向维护者的工作上下文——点击展开</summary>

此开发者备注是面向维护者的工作上下文：开放问题与未决方向。它明确不具有权威性——已发布的行为、限制与依据位于上述章节与所链接的 Agent 笔记中。

#### 未来：更宽的 SearXNG 控制面

SearXNG 的其余控制项——`pageno`、`safesearch`、站点 bang、逐引擎开关——保持未暴露。暴露它们需要先有提供商中性的服务字段，因此包家族添加一个协调的控制项，而非供应商专属参数。

</details>
