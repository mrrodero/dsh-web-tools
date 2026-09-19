/**
 * The embedding model: all-MiniLM-L6-v2 (384-dim) via onnxruntime-node,
 * lazily downloaded to `$DSH_HOME/data/web-index/models/` on first use.
 * The WordPiece tokenizer is hand-rolled (the model's `vocab.txt` is
 * downloaded alongside the weights). Any failure degrades the index to
 * lexical-only search — the model is an enhancement, never a dependency.
 * @module @deepseek-ai/dsh-web-local-index/model
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { InferenceSession, Tensor } from 'onnxruntime-node'

/** The quantized MiniLM ONNX export (Xenova mirror, ~23 MB). */
const MODEL_URL = 'https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/onnx/model.onnx'

/** The BERT vocab file (token → id), ~22 KB. */
const VOCAB_URL = 'https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/vocab.txt'

/** The model directory under the DSH home. */
function modelDir(): string {
  const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(dshHome, 'data', 'web-index', 'models')
}

/** BERT special token ids. */
export const CLS_ID = 101
export const SEP_ID = 102
export const UNK_ID = 100

/** The model's maximum token sequence length. */
export const MAX_TOKENS = 512

let session: InferenceSession | null | undefined
let sessionPromise: Promise<InferenceSession | null> | undefined
let vocab: Map<string, number> | undefined
let disabled = false

/**
 * Test seam: force lexical-only mode (no download, no session).
 */
export function disableModelForTests(): void {
  disabled = true
  session = null
  sessionPromise = Promise.resolve(null)
}

/**
 * Load (or reuse) the embedding session, downloading the model and vocab on
 * first use. Never throws: any failure resolves to `null` (lexical-only).
 */
export function ensureModel(): Promise<InferenceSession | null> {
  if (disabled) {
    sessionPromise ??= Promise.resolve(null)
    return sessionPromise
  }
  sessionPromise ??= loadModel()
  return sessionPromise
}

/** Whether the model is already loaded (no download is triggered). */
export function modelReadyNow(): boolean {
  return session !== null
}

async function loadModel(): Promise<InferenceSession | null> {
  try {
    const modelPath = join(modelDir(), 'all-MiniLM-L6-v2.onnx')
    const vocabPath = join(modelDir(), 'vocab.txt')
    if (!existsSync(modelPath)) await downloadFile(MODEL_URL, modelPath)
    if (!existsSync(vocabPath)) await downloadFile(VOCAB_URL, vocabPath)
    vocab = loadVocab(vocabPath)
    const ort = await import('onnxruntime-node')
    session = await ort.InferenceSession.create(modelPath)
    return session
  } catch (error) {
    console.warn(`[web-local-index] embedding model unavailable (${String(error)}); lexical-only search`)
    session = null
    return null
  }
}

/** Download a file atomically (`.part` then rename). */
async function downloadFile(url: string, dest: string): Promise<void> {
  mkdirSync(dirname(dest), { recursive: true })
  const response = await fetch(url)
  if (!response.ok) throw new Error(`download failed: HTTP ${response.status} for ${url}`)
  const buffer = Buffer.from(await response.arrayBuffer())
  writeFileSync(`${dest}.part`, buffer)
  renameSync(`${dest}.part`, dest)
}

/** Load the vocab file into a token→id map. */
function loadVocab(path: string): Map<string, number> {
  const lines = readFileSync(path, 'utf8').split(/\r?\n/u)
  const map = new Map<string, number>()
  lines.forEach((line, index) => {
    if (line !== '') map.set(line, index)
  })
  return map
}

/**
 * Tokenize text into BERT token ids: WordPiece longest-prefix subwords with
 * `[CLS]`/`[SEP]` framing, truncated to {@link MAX_TOKENS}.
 *
 * @param text - the text to tokenize.
 * @param vocabMap - the token→id map.
 * @returns the token ids.
 */
export function wordPieceTokenize(text: string, vocabMap: Map<string, number>): number[] {
  const tokens: number[] = [CLS_ID]
  for (const rawWord of text.toLowerCase().split(/\s+/u)) {
    const word = rawWord.replace(/[^a-z0-9]/gu, ' ').trim()
    if (word === '') continue
    for (const id of wordPiece(word, vocabMap)) {
      if (tokens.length >= MAX_TOKENS - 1) break
      tokens.push(id)
    }
  }
  tokens.push(SEP_ID)
  return tokens.slice(0, MAX_TOKENS)
}

/** WordPiece-decompose one cleaned word into token ids (longest prefix first). */
function wordPiece(word: string, vocabMap: Map<string, number>): number[] {
  const pieces: number[] = []
  let remaining = word
  let first = true
  while (remaining.length > 0) {
    let found: { id: number; length: number } | undefined
    for (let length = Math.min(remaining.length, 20); length >= 1; length--) {
      const candidate = remaining.slice(0, length)
      // Only pieces after the first carry the `##` continuation prefix.
      const id = first ? vocabMap.get(candidate) : vocabMap.get(`##${candidate}`)
      if (id !== undefined) {
        found = { id, length }
        break
      }
    }
    if (found === undefined) {
      pieces.push(UNK_ID)
      break
    }
    pieces.push(found.id)
    remaining = remaining.slice(found.length)
    first = false
  }
  return pieces
}

/**
 * Embed one text: tokenize, run the session, mean-pool the non-pad hidden
 * states, and L2-normalize.
 *
 * @param session - the loaded inference session.
 * @param text - the text to embed.
 * @returns the 384-dim unit vector.
 */
export async function embed(session: InferenceSession, text: string): Promise<Float32Array> {
  if (vocab === undefined) throw new Error('vocab not loaded')
  const ort = await import('onnxruntime-node')
  const ids = wordPieceTokenize(text, vocab)
  const seqLen = ids.length
  const int64Tensor = (values: Iterable<bigint>) => new ort.Tensor('int64', BigInt64Array.from(values), [1, seqLen])
  const attentionMask = BigInt64Array.from(ids.map(() => 1n))
  const output = await session.run({
    input_ids: int64Tensor(ids.map(id => BigInt(id))),
    attention_mask: int64Tensor(ids.map(() => 1n)),
    token_type_ids: int64Tensor(ids.map(() => 0n)),
  })
  const hidden = output['last_hidden_state'] as Tensor | undefined
  if (hidden === undefined) throw new Error('model produced no last_hidden_state output')
  const dims = hidden.dims.map(Number)
  const seq = dims[1] ?? 0
  const dim = dims[2] ?? 0
  const data = hidden.data as Float32Array
  const sum = new Float32Array(dim)
  let count = 0
  for (let i = 0; i < seq; i++) {
    if ((attentionMask[i] ?? 0n) === 0n) continue
    count += 1
    const offset = i * dim
    for (let j = 0; j < dim; j++) sum[j] = (sum[j] ?? 0) + (data[offset + j] ?? 0)
  }
  const pooled = new Float32Array(dim)
  if (count > 0) {
    for (let j = 0; j < dim; j++) pooled[j] = (sum[j] ?? 0) / count
  }
  const norm = Math.sqrt(pooled.reduce((acc, value) => acc + (value ?? 0) * (value ?? 0), 0))
  if (norm > 0) {
    for (let j = 0; j < dim; j++) pooled[j] = (pooled[j] ?? 0) / norm
  }
  return pooled
}

/**
 * Cosine similarity between two equal-length vectors.
 *
 * @param a - first vector.
 * @param b - second vector.
 * @returns the cosine similarity in [-1, 1] (0 for zero vectors).
 */
export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += (a[i] ?? 0) * (b[i] ?? 0)
  return dot
}
