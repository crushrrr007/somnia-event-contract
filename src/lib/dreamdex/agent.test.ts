import { describe, expect, it } from 'vitest'
import { brierScore, computeEdgeDecision, snapQuantity, validatePolicy } from './agent'

const ONE = 1_000_000n // 6-decimal quote token

function decide(probability: number, fillPriceCents: number, overrides: Partial<Parameters<typeof computeEdgeDecision>[0]> = {}) {
  return computeEdgeDecision({
    probability,
    fillPriceRaw: BigInt(Math.round((fillPriceCents / 100) * 1_000_000)),
    oneCollateral: ONE,
    minEdgeBps: 300,
    slippageBps: 200,
    allowedDirection: 'both',
    ...overrides,
  })
}

describe('computeEdgeDecision', () => {
  it('buys YES when the agent probability clears the fill price by the minimum edge', () => {
    const decision = decide(70, 60)
    expect(decision).toMatchObject({ action: 'execute', side: 0, label: 'YES' })
    if (decision.action === 'execute') {
      // limit = fill + slippage (2%) = 62c, below fair 70c
      expect(decision.limitPriceRaw).toBe(620_000n)
    }
  })

  it('caps the YES limit at fair minus one tick when slippage would exceed fair value', () => {
    const decision = decide(64, 60, { slippageBps: 500 })
    expect(decision).toMatchObject({ action: 'execute', side: 0 })
    if (decision.action === 'execute') {
      expect(decision.limitPriceRaw).toBe(639_999n)
    }
  })

  it('buys NO when the agent probability undercuts the fill price by the minimum edge', () => {
    const decision = decide(40, 60)
    expect(decision).toMatchObject({ action: 'execute', side: 2, label: 'NO' })
    if (decision.action === 'execute') {
      // YES-side limit = fill - slippage = 58c, above fair 40c
      expect(decision.limitPriceRaw).toBe(580_000n)
    }
  })

  it('skips when the probability sits inside the edge band', () => {
    expect(decide(62, 60)).toMatchObject({ action: 'skip', reason: 'insufficient edge' })
    expect(decide(58, 60)).toMatchObject({ action: 'skip', reason: 'insufficient edge' })
  })

  it('respects the allowed direction', () => {
    expect(decide(70, 60, { allowedDirection: 'no' })).toMatchObject({ action: 'skip', reason: 'direction not allowed' })
    expect(decide(40, 60, { allowedDirection: 'yes' })).toMatchObject({ action: 'skip', reason: 'direction not allowed' })
  })

  it('rejects out-of-range probabilities', () => {
    expect(decide(120, 60)).toMatchObject({ action: 'skip', reason: 'probability out of range' })
    expect(decide(-5, 60)).toMatchObject({ action: 'skip', reason: 'probability out of range' })
  })
})

describe('snapQuantity', () => {
  it('rounds down to the lot grid', () => {
    expect(snapQuantity(1234n, 100n)).toBe(1200n)
    expect(snapQuantity(100n, 100n)).toBe(100n)
    expect(snapQuantity(99n, 100n)).toBe(0n)
  })

  it('passes through when there is no lot size', () => {
    expect(snapQuantity(123n, 0n)).toBe(123n)
  })
})

describe('brierScore', () => {
  it('scores perfect and worst calls', () => {
    expect(brierScore(100, true)).toBe(0)
    expect(brierScore(0, false)).toBe(0)
    expect(brierScore(0, true)).toBe(1)
    expect(brierScore(100, false)).toBe(1)
  })

  it('scores a 50/50 call the same either way', () => {
    expect(brierScore(50, true)).toBeCloseTo(0.25)
    expect(brierScore(50, false)).toBeCloseTo(0.25)
  })
})

describe('validatePolicy', () => {
  const base = {
    marketId: '0x01' as const,
    marketAddress: '0x0000000000000000000000000000000000000001' as const,
    poolAddress: '0x0000000000000000000000000000000000000002' as const,
    collateral: '0x0000000000000000000000000000000000000003' as const,
    question: 'Question?',
    thesis: 'A thesis long enough to pass validation.',
    direction: 'both' as const,
    minFill: 0,
    minEdgeBps: 300,
    maxContracts: 5,
    slippageBps: 200,
    cooldownSeconds: 60,
    maxDecisions: 3,
    shadowMode: true,
    baseDecimals: 6,
  }

  it('accepts a complete policy', () => {
    expect(validatePolicy(base)).toEqual({ ok: true })
  })

  it('rejects short theses and sub-1% edges', () => {
    const result = validatePolicy({ ...base, thesis: 'short', minEdgeBps: 50 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.length).toBe(2)
  })

  it('rejects decision caps above the contract maximum', () => {
    const result = validatePolicy({ ...base, maxDecisions: 11 })
    expect(result.ok).toBe(false)
  })
})
