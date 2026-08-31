import { describe, expect, it } from 'vitest'
import {
  buildPassportMetrics,
  buildProtectedIocQuote,
  calculateBoundedApprovalCap,
  calculateBuyCollateral,
  claimableOutcomes,
  evaluateDecisionScore,
  filterEligibleMarkets,
  isTradeEligible,
  marketKey,
  needsTokenApproval,
  normalizeBook,
} from './decision'

describe('decision helpers', () => {
  it('scores a resolved win using confidence and entry probability', () => {
    const score = evaluateDecisionScore({
      outcome: 'UP',
      confidence: 80,
      fillPrice: 0.6,
      filledAmount: 5,
      isResolved: true,
      isVoided: false,
      winningOutcome: 0,
    })

    expect(score.result).toBe('WIN')
    expect(score.decisionScore).toBe(96)
    expect(score.userBrierLoss).toBeCloseTo(0.04)
    expect(score.marketRelativeDelta).toBeCloseTo(0.12)
  })

  it('scores a resolved loss and excludes void and unresolved rounds', () => {
    expect(evaluateDecisionScore({
      outcome: 'DOWN',
      confidence: 70,
      fillPrice: 0.4,
      filledAmount: 5,
      isResolved: true,
      isVoided: false,
      winningOutcome: 0,
    }).result).toBe('LOSS')
    expect(evaluateDecisionScore({
      outcome: 'UP',
      confidence: 70,
      fillPrice: 0.4,
      filledAmount: 5,
      isResolved: false,
      isVoided: true,
      winningOutcome: null,
    }).result).toBe('VOID')
    expect(evaluateDecisionScore({
      outcome: 'UP',
      confidence: 70,
      fillPrice: 0.4,
      filledAmount: 5,
      isResolved: false,
      isVoided: false,
      winningOutcome: null,
    }).result).toBe('PENDING')
  })

  it('builds passport aggregates with an exact resolved sample size', () => {
    const win = evaluateDecisionScore({
      outcome: 'UP',
      confidence: 80,
      fillPrice: 0.6,
      filledAmount: 5,
      isResolved: true,
      isVoided: false,
      winningOutcome: 0,
    })
    const loss = evaluateDecisionScore({
      outcome: 'UP',
      confidence: 60,
      fillPrice: 0.7,
      filledAmount: 2,
      isResolved: true,
      isVoided: false,
      winningOutcome: 1,
    })
    const metrics = buildPassportMetrics([
      { filledAmount: 5, cost: 3, score: win, realizedPayout: 5 },
      { filledAmount: 2, cost: 1.4, score: loss, realizedPayout: 0 },
      { filledAmount: 1, cost: 0.5, score: { ...win, result: 'VOID' }, realizedPayout: null },
      { filledAmount: 0, cost: 0, score: { ...win, result: 'NO_FILL' }, realizedPayout: null },
    ])

    expect(metrics).toMatchObject({
      rounds: 3,
      resolvedRounds: 2,
      wins: 1,
      winRate: 0.5,
      totalAtRisk: 4.9,
      realizedResult: 0.6,
      calibrationSampleSize: 2,
    })
  })

  it('requires Trading status and one minute of headroom', () => {
    expect(isTradeEligible(1, '1060', 1000)).toBe(true)
    expect(isTradeEligible(1, '1059', 1000)).toBe(false)
    expect(isTradeEligible(2, '1500', 1000)).toBe(false)
  })

  it('normalizes a raw book into probability-scale values', () => {
    expect(normalizeBook({ bestBid: '487000', bestAsk: '516000', mid: '501500' }, 6)).toEqual({
      bestBid: 0.487,
      bestAsk: 0.516,
      mid: 0.5015,
      hasLiquidity: true,
    })
  })

  it('preserves the empty-book state', () => {
    expect(normalizeBook(null, 6)).toEqual({
      bestBid: null,
      bestAsk: null,
      mid: null,
      hasLiquidity: false,
    })
  })

  it('uses a case-insensitive market identity', () => {
    expect(marketKey('0xABC')).toBe('0xabc')
  })

  it('only exposes the winning held side after resolution', () => {
    expect(claimableOutcomes({
      isResolved: true,
      isVoided: false,
      winningOutcome: 1,
      yesBalance: 2_000_000n,
      noBalance: 5_000_000n,
    })).toEqual([{ outcomeIdx: 1, label: 'DOWN', balance: 5_000_000n }])
  })

  it('exposes both held sides for a voided market and none before settlement', () => {
    expect(claimableOutcomes({
      isResolved: false,
      isVoided: true,
      winningOutcome: null,
      yesBalance: 1_000_000n,
      noBalance: 2_000_000n,
    })).toEqual([
      { outcomeIdx: 0, label: 'UP', balance: 1_000_000n },
      { outcomeIdx: 1, label: 'DOWN', balance: 2_000_000n },
    ])
    expect(claimableOutcomes({
      isResolved: false,
      isVoided: false,
      winningOutcome: 0,
      yesBalance: 1_000_000n,
      noBalance: 1_000_000n,
    })).toEqual([])
  })

  it('calculates BUY_YES and BUY_NO collateral on the quote scale', () => {
    expect(calculateBuyCollateral(400_000n, 5_000_000n, 6, false)).toBe(2_000_000n)
    expect(calculateBuyCollateral(400_000n, 5_000_000n, 6, true)).toBe(3_000_000n)
  })

  it('caps token approval at one collateral unit per requested contract', () => {
    expect(calculateBoundedApprovalCap(5, 10_000_000n, 6)).toBe(5_000_000n)
    expect(calculateBoundedApprovalCap(5, 2_000_000n, 6)).toBe(2_000_000n)
  })

  it('skips approval whenever the existing allowance covers the bounded cap', () => {
    expect(needsTokenApproval(5_000_000n, 5_000_000n)).toBe(false)
    expect(needsTokenApproval(8_000_000n, 5_000_000n)).toBe(false)
    expect(needsTokenApproval(4_999_999n, 5_000_000n)).toBe(true)
  })

  it('walks multiple YES ask levels and adds a tick-aligned protective cushion', () => {
    const quote = buildProtectedIocQuote(
      {
        yesBids: [],
        yesAsks: [
          { price: 400_000n, quantity: 3_000_000n },
          { price: 450_000n, quantity: 3_000_000n },
        ],
        noBids: [],
        noAsks: [],
      },
      'BUY_YES',
      5_000_000n,
      6,
      { tickSize: 1_000n, lotSize: 1_000n, minQuantity: 1_000n },
    )

    expect(quote).toEqual({
      yesPrice: 464_000n,
      collateral: 2_320_000n,
      filledQuantity: 5_000_000n,
      levelsConsumed: 2,
    })
  })

  it('inverts BUY_NO into YES terms while keeping collateral bounded', () => {
    const quote = buildProtectedIocQuote(
      {
        yesBids: [],
        yesAsks: [],
        noBids: [],
        noAsks: [{ price: 600_000n, quantity: 5_000_000n }],
      },
      'BUY_NO',
      5_000_000n,
      6,
      { tickSize: 1_000n, lotSize: 1_000n, minQuantity: 1_000n },
    )

    expect(quote).toEqual({
      yesPrice: 382_000n,
      collateral: 3_090_000n,
      filledQuantity: 5_000_000n,
      levelsConsumed: 1,
    })
  })

  it('re-quotes the failed BUY_NO transaction against its mined-block book', () => {
    const quote = buildProtectedIocQuote(
      {
        yesBids: [{ price: 512_000n, quantity: 200_000_000n }],
        yesAsks: [{ price: 542_000n, quantity: 200_000_000n }],
        noBids: [{ price: 458_000n, quantity: 200_000_000n }],
        noAsks: [{ price: 488_000n, quantity: 200_000_000n }],
      },
      'BUY_NO',
      5_000_000n,
      6,
      { tickSize: 1_000n, lotSize: 1_000n, minQuantity: 1_000n },
    )

    expect(quote).toEqual({
      yesPrice: 497_000n,
      collateral: 2_515_000n,
      filledQuantity: 5_000_000n,
      levelsConsumed: 1,
    })
    expect(quote?.yesPrice).toBeLessThan(566_000n)
  })

  it('rejects insufficient depth and off-lot quantities before approval', () => {
    const book = {
      yesBids: [],
      yesAsks: [{ price: 400_000n, quantity: 4_000_000n }],
      noBids: [],
      noAsks: [],
    }
    const params = { tickSize: 1_000n, lotSize: 1_000n, minQuantity: 1_000n }

    expect(buildProtectedIocQuote(book, 'BUY_YES', 5_000_000n, 6, params)).toBeNull()
    expect(buildProtectedIocQuote(book, 'BUY_YES', 500n, 6, params)).toBeNull()
  })

  it('filters stale, finalized, resolved, voided, and closing-soon candidates', () => {
    const candidates = [
      { id: 'accepted', onchainStatus: 1, expiry: '1060', finalized: false, isResolved: false, isVoided: false },
      { id: 'closing', onchainStatus: 1, expiry: '1059', finalized: false, isResolved: false, isVoided: false },
      { id: 'finalized', onchainStatus: 1, expiry: '1400', finalized: true, isResolved: false, isVoided: false },
      { id: 'resolved', onchainStatus: 1, expiry: '1400', finalized: false, isResolved: true, isVoided: false },
      { id: 'locked', onchainStatus: 2, expiry: '1400', finalized: false, isResolved: false, isVoided: false },
    ]

    expect(filterEligibleMarkets(candidates, 1000).map((market) => market.id)).toEqual(['accepted'])
  })
})
