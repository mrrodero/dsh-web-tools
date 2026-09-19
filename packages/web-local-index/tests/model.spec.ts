import { describe, expect, it } from 'vitest'
import { CLS_ID, SEP_ID, UNK_ID, cosine, wordPieceTokenize } from '../src/model.ts'

/** A minimal BERT-style vocab for tokenizer tests. */
const vocab = new Map<string, number>([
  ['[CLS]', CLS_ID],
  ['[SEP]', SEP_ID],
  ['[UNK]', UNK_ID],
  ['hello', 1000],
  ['world', 1001],
  ['un', 1002],
  ['##happy', 1003],
  ['token', 1004],
  ['##ize', 1005],
])

describe('wordPieceTokenize', () => {
  it('frames with [CLS]/[SEP] and maps whole words', () => {
    expect(wordPieceTokenize('hello world', vocab)).toEqual([CLS_ID, 1000, 1001, SEP_ID])
  })

  it('decomposes unknown words into longest-prefix subwords', () => {
    expect(wordPieceTokenize('unhappy', vocab)).toEqual([CLS_ID, 1002, 1003, SEP_ID])
    expect(wordPieceTokenize('tokenize', vocab)).toEqual([CLS_ID, 1004, 1005, SEP_ID])
  })

  it('emits [UNK] for words with no subword coverage', () => {
    expect(wordPieceTokenize('zzz', vocab)).toEqual([CLS_ID, UNK_ID, SEP_ID])
  })

  it('is case-insensitive and strips punctuation', () => {
    expect(wordPieceTokenize('Hello, World!', vocab)).toEqual([CLS_ID, 1000, 1001, SEP_ID])
  })

  it('truncates to the token cap', () => {
    const ids = wordPieceTokenize('hello '.repeat(600).trim(), vocab)
    expect(ids.length).toBeLessThanOrEqual(512)
    expect(ids[0]).toBe(CLS_ID)
    expect(ids[ids.length - 1]).toBe(SEP_ID)
  })
})

describe('cosine', () => {
  it('is 1 for identical unit vectors and 0 for orthogonal ones', () => {
    const a = new Float32Array([1, 0])
    const b = new Float32Array([1, 0])
    const c = new Float32Array([0, 1])
    expect(cosine(a, b)).toBeCloseTo(1)
    expect(cosine(a, c)).toBeCloseTo(0)
  })

  it('returns 0 for mismatched lengths', () => {
    expect(cosine(new Float32Array([1, 0]), new Float32Array([1, 0, 0]))).toBe(0)
  })
})
