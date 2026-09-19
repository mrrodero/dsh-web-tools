# @deepseek-ai/dsh-web-local-index

Local corpus index and `local_search` tool for the DeepSeek Harness web
capability bundle. Everything the session fetches (via the `indexed` provider)
or crawls (via `web_crawl`) lands in one local SQLite file and becomes
searchable — no keys, no network, no service.

- **Store**: built-in `node:sqlite` (WAL), one file at
  `$DSH_HOME/data/web-index/index.db` (configurable). Tables: `pages`
  (URL-keyed, latest index wins), a standalone FTS5 table (`unicode61`), and
  `chunks` (≈800-char content chunks with optional float32 embedding BLOBs).
- **Embeddings**: `all-MiniLM-L6-v2` (~23 MB quantized ONNX) via
  onnxruntime-node, lazily downloaded to `$DSH_HOME/data/web-index/models/`
  on first use. Hand-rolled WordPiece tokenizer; mean pooling + L2 normalize.
  Any failure degrades to lexical-only search (the model is never a dependency).
- **Search modes**:
  - `lexical` — FTS5 BM25 (each query term double-quoted, OR-joined).
  - `semantic` — KNN over chunk embeddings (cosine, in JS).
  - `hybrid` (default) — Reciprocal Rank Fusion (k=60) over per-query rankings.
- **`IndexedFetchProvider`** (id **`indexed`**): wraps the default HTTP fetch
  provider and indexes every successful result as a fire-and-forget side
  effect — indexing failures never fail the fetch. Set
  `web.fetchProvider: indexed` in the profile to auto-index all fetches.
- **`local_search` tool**: `{queries: string[1–4], maxResults?, mode?}` →
  ranked hits `{url, title, domain, score, snippet}` plus `modelReady`.

## Config

| Key | Default | Meaning |
| --- | --- | --- |
| `dbPath` | `$DSH_HOME/data/web-index/index.db` | SQLite database path |
| `registerProvider` | `true` | Register the `indexed` fetch provider |
| `registerTool` | `true` | Register the `local_search` tool |
| `maxResults` | `8` | Default hit cap for `local_search` |
| `maxQueries` | `4` | Query cap per `local_search` call |

## API

```ts
import {
  indexPage, searchLocal, pruneIndex, indexStats,
  configureIndexStore, ensureModel,
} from '@deepseek-ai/dsh-web-local-index'

configureIndexStore({ dbPath: '/path/to/index.db' })
await indexPage({ url: 'https://example.com/a', title: 'A', markdown: '…', fetchedAt: new Date().toISOString() })
const result = await searchLocal({ queries: ['memory safety'], maxResults: 8, mode: 'hybrid' })
await pruneIndex({ olderThanDays: 90 })
const stats = await indexStats()
```

## Scale & backup

~50 pages ≈ 1 MB; 1,000 ≈ 50 MB; 10,000 ≈ 150 MB of vectors (worst case < 1 GB).
Single writer (the DSH server process). Backup = copy the file.

## Known simplification

KNN runs in JS over in-memory vectors — sub-second at wave-1 scale; a vector
extension (e.g. sqlite-vec) is the wave-2 upgrade path. Chunks stored before
the model finished downloading are embedded by a background backfill pass.
