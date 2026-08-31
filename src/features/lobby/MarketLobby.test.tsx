import { describe, expect, it } from 'vitest'
import { isCoachFollowUpReady, mergeChallenges, mergeTradeHistory } from './lobby-model'

describe('scheduled coach follow-ups', () => {
  it('stays queued before expiry and becomes ready at expiry', () => {
    expect(isCoachFollowUpReady(2_000, 1_999)).toBe(false)
    expect(isCoachFollowUpReady(2_000, 2_000)).toBe(true)
    expect(isCoachFollowUpReady(2_000, 2_001)).toBe(true)
  })

  it('prefers the latest challenge state for the same on-chain id', () => {
    const base = {
      id: '7', createdAt: 1, status: 'waiting' as const, marketId: '0x01' as const, asset: 'ETH', interval: '15m',
      question: 'Question', expiry: '10',
      creator: { marketId: '0x01' as const, asset: 'ETH', interval: '15m', question: 'Question', expiry: '10', side: 'UP' as const, reason: 'MOMENTUM', confidence: 75, amount: 2, wallet: '0x1' },
      opponent: null,
    }
    const joined = { ...base, status: 'joined' as const, opponent: { ...base.creator, side: 'DOWN' as const, wallet: '0x2' } }
    expect(mergeChallenges([base], [joined])).toEqual([joined])
  })

  it('deduplicates indexed and cached fills by transaction, market, and outcome', () => {
    const base = { id: 'fill', hash: '0xabc', wallet: '0x1', marketId: '0x01' as const, asset: 'ETH', interval: '15m', question: 'Question', outcome: 'UP' as const, requestedAmount: 2, filledAmount: 2, averageFillPrice: 0.6, createdAt: 1 }
    const hydrated = { ...base, confidence: 75, thesis: 'MOMENTUM' }
    expect(mergeTradeHistory([base], [hydrated])).toEqual([hydrated])
  })
})
