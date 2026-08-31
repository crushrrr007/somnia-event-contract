import { describe, expect, it } from 'vitest'
import { deriveCoachReviews, isCoachFollowUpReady, mergeChallenges, mergeTradeHistory } from './lobby-model'

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

  it('derives a ready coach review from canonical history without browser follow-ups', () => {
    const record = { id: 'fill', hash: '0xabc', wallet: '0x1', marketId: '0x01' as const, asset: 'ETH', interval: '15m', question: 'Question', outcome: 'UP' as const, requestedAmount: 2, filledAmount: 2, averageFillPrice: 0.6, createdAt: 1, confidence: 75, thesis: 'MOMENTUM' }
    const reviews = deriveCoachReviews([record], [], new Map(), 2_000)
    expect(reviews).toMatchObject([{ id: 'fill', status: 'ready', confidence: 75, reason: 'MOMENTUM' }])
  })

  it('keeps live settlements queued and resolved scored decisions reviewed', () => {
    const base = { id: 'fill', hash: '0xabc', wallet: '0x1', marketId: '0x01' as const, asset: 'ETH', interval: '15m', question: 'Question', outcome: 'UP' as const, requestedAmount: 2, filledAmount: 2, averageFillPrice: 0.6, createdAt: 1 }
    const trading = { market: { marketId: '0x01' as const, question: 'Question', asset: 'ETH', interval: '15m', expiry: '10', quoteDecimals: 6 }, stage: 'Trading' as const, onchainStatus: 1, isResolved: false, isVoided: false, winningOutcome: null, yesBalance: 0n, noBalance: 0n, claimable: [] }
    expect(deriveCoachReviews([base], [], new Map([['0x01', trading]]), 2_000)[0].status).toBe('queued')
    expect(deriveCoachReviews([{ ...base, decisionResult: 'WIN' as const, decisionScore: 0.9 }], [], new Map(), 2_000)[0].status).toBe('reviewed')
  })
})
