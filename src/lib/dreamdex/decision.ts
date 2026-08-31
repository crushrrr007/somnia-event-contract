import {
  fromHuman,
  quoteBinaryOrderOverBook,
  slippageForCrossing,
  type BinaryBookParams,
  type BinaryOrderBook,
  type BinarySide,
  type BookTop,
} from '@somnia-chain/markets-sdk'

const TRADING_STATUS = 1
const MINIMUM_HEADROOM_SECONDS = 300

export function isTradeEligible(
  status: number,
  expiry: string,
  nowSec: number,
): boolean {
  const remaining = Number(expiry) - nowSec
  return status === TRADING_STATUS && remaining >= MINIMUM_HEADROOM_SECONDS
}

export type MarketEligibility = {
  expiry: string
  onchainStatus: number
  finalized: boolean
  isResolved: boolean
  isVoided: boolean
}

export function filterEligibleMarkets<T extends MarketEligibility>(
  markets: T[],
  nowSec: number,
): T[] {
  return markets.filter((market) => (
    !market.finalized &&
    !market.isResolved &&
    !market.isVoided &&
    isTradeEligible(market.onchainStatus, market.expiry, nowSec)
  ))
}

export type NormalizedBook = {
  bestBid: number | null
  bestAsk: number | null
  mid: number | null
  hasLiquidity: boolean
}

export function normalizeBook(book: BookTop | null, quoteDecimals: number): NormalizedBook {
  if (!book) {
    return { bestBid: null, bestAsk: null, mid: null, hasLiquidity: false }
  }

  const scale = 10 ** quoteDecimals
  const bestBid = book.bestBid === null ? null : Number(book.bestBid) / scale
  const bestAsk = book.bestAsk === null ? null : Number(book.bestAsk) / scale
  const mid = book.mid === null ? null : Number(book.mid) / scale

  return {
    bestBid,
    bestAsk,
    mid,
    hasLiquidity: bestBid !== null && bestAsk !== null,
  }
}

export function marketKey(marketId: string): string {
  return marketId.toLowerCase()
}

export type OutcomeIndex = 0 | 1

export type OutcomePosition = {
  outcomeIdx: OutcomeIndex
  label: 'UP' | 'DOWN'
  balance: bigint
}

export type DecisionResult = 'PENDING' | 'WIN' | 'LOSS' | 'VOID' | 'NO_FILL'

export type DecisionScore = {
  result: DecisionResult
  decisionScore: number | null
  marketRelativeDelta: number | null
  userBrierLoss: number | null
  marketBrierLoss: number | null
}

export function evaluateDecisionScore({
  outcome,
  confidence,
  fillPrice,
  filledAmount,
  isResolved,
  isVoided,
  winningOutcome,
}: {
  outcome: 'UP' | 'DOWN'
  confidence: number | null | undefined
  fillPrice: number | null
  filledAmount: number
  isResolved: boolean
  isVoided: boolean
  winningOutcome: number | null | undefined
}): DecisionScore {
  const emptyScore = (result: DecisionResult): DecisionScore => ({
    result,
    decisionScore: null,
    marketRelativeDelta: null,
    userBrierLoss: null,
    marketBrierLoss: null,
  })

  if (filledAmount <= 0) return emptyScore('NO_FILL')
  if (isVoided) return emptyScore('VOID')
  if (!isResolved || (winningOutcome !== 0 && winningOutcome !== 1)) return emptyScore('PENDING')

  const result = (outcome === 'UP' ? 0 : 1) === winningOutcome ? 'WIN' : 'LOSS'
  if (confidence === null || confidence === undefined || fillPrice === null) return emptyScore(result)

  const userProbabilityUp = outcome === 'UP' ? confidence / 100 : 1 - confidence / 100
  const marketProbabilityUp = outcome === 'UP' ? fillPrice : 1 - fillPrice
  const actualUp = winningOutcome === 0 ? 1 : 0
  const userBrierLoss = (userProbabilityUp - actualUp) ** 2
  const marketBrierLoss = (marketProbabilityUp - actualUp) ** 2

  return {
    result,
    decisionScore: Math.round(100 * (1 - userBrierLoss)),
    marketRelativeDelta: marketBrierLoss - userBrierLoss,
    userBrierLoss,
    marketBrierLoss,
  }
}

export type PassportRound = {
  filledAmount: number
  cost: number
  score: DecisionScore
  realizedPayout: number | null
}

export type PassportMetrics = {
  rounds: number
  resolvedRounds: number
  wins: number
  winRate: number | null
  totalAtRisk: number
  realizedResult: number | null
  averageScore: number | null
  calibrationSampleSize: number
}

export function buildPassportMetrics(rounds: PassportRound[]): PassportMetrics {
  const roundMetric = (value: number) => Math.round(value * 100) / 100
  const filledRounds = rounds.filter((round) => round.filledAmount > 0)
  const resolvedRounds = filledRounds.filter((round) => round.score.result === 'WIN' || round.score.result === 'LOSS')
  const scoredRounds = resolvedRounds.filter((round) => round.score.decisionScore !== null)
  const realizedRounds = filledRounds.filter((round) => round.realizedPayout !== null)
  const realizedResult = realizedRounds.length === 0
    ? null
    : realizedRounds.reduce((total, round) => total + (round.realizedPayout ?? 0) - round.cost, 0)

  return {
    rounds: filledRounds.length,
    resolvedRounds: resolvedRounds.length,
    wins: resolvedRounds.filter((round) => round.score.result === 'WIN').length,
    winRate: resolvedRounds.length === 0
      ? null
      : resolvedRounds.filter((round) => round.score.result === 'WIN').length / resolvedRounds.length,
    totalAtRisk: roundMetric(filledRounds.reduce((total, round) => total + round.cost, 0)),
    realizedResult: realizedResult === null ? null : roundMetric(realizedResult),
    averageScore: scoredRounds.length === 0
      ? null
      : scoredRounds.reduce((total, round) => total + (round.score.decisionScore ?? 0), 0) / scoredRounds.length,
    calibrationSampleSize: scoredRounds.length,
  }
}

export function claimableOutcomes({
  isResolved,
  isVoided,
  winningOutcome,
  yesBalance,
  noBalance,
}: {
  isResolved: boolean
  isVoided: boolean
  winningOutcome: number | null | undefined
  yesBalance: bigint
  noBalance: bigint
}): OutcomePosition[] {
  if (!isResolved && !isVoided) return []

  const positions: OutcomePosition[] = [
    { outcomeIdx: 0, label: 'UP', balance: yesBalance },
    { outcomeIdx: 1, label: 'DOWN', balance: noBalance },
  ]
  if (isVoided) return positions.filter((position) => position.balance > 0n)
  if (winningOutcome !== 0 && winningOutcome !== 1) return []
  return positions.filter((position) => position.outcomeIdx === winningOutcome && position.balance > 0n)
}

export function calculateBuyCollateral(
  yesPrice: bigint,
  quantity: bigint,
  quoteDecimals: number,
  buyNo: boolean,
): bigint {
  const oneBase = 10n ** BigInt(quoteDecimals)
  const quotePrice = buyNo ? oneBase - yesPrice : yesPrice
  return (quotePrice * quantity + oneBase - 1n) / oneBase
}

export function calculateBoundedApprovalCap(
  contractAmount: number,
  collateralBalance: bigint,
  quoteDecimals: number,
): bigint {
  const maximumTradeCollateral = fromHuman(contractAmount, quoteDecimals)
  return collateralBalance < maximumTradeCollateral
    ? collateralBalance
    : maximumTradeCollateral
}

export type ProtectedIocQuote = {
  yesPrice: bigint
  collateral: bigint
  filledQuantity: bigint
  levelsConsumed: number
}

export function buildProtectedIocQuote(
  book: BinaryOrderBook,
  side: BinarySide,
  quantity: bigint,
  quoteDecimals: number,
  params: BinaryBookParams,
): ProtectedIocQuote | null {
  const oneBase = 10n ** BigInt(quoteDecimals)
  if (
    quantity <= 0n ||
    params.tickSize <= 0n ||
    params.lotSize <= 0n ||
    quantity % params.lotSize !== 0n ||
    quantity < params.minQuantity
  ) {
    return null
  }

  const quote = quoteBinaryOrderOverBook(book, side, quantity, oneBase)
  if (quote.filledQuantity < quantity || quote.levelsConsumed === 0) return null

  const levels = side === 'BUY_YES' ? book.yesAsks : book.noAsks
  const deepestLevel = levels[quote.levelsConsumed - 1]
  if (!deepestLevel) return null

  const paddedRaw = deepestLevel.price + slippageForCrossing(deepestLevel.price, params.tickSize)
  const alignedUp = ((paddedRaw + params.tickSize - 1n) / params.tickSize) * params.tickSize
  const maxPrice = oneBase - params.tickSize
  const protectivePrice = alignedUp > maxPrice ? maxPrice : alignedUp
  if (protectivePrice <= 0n || protectivePrice >= oneBase) return null

  const yesPrice = side === 'BUY_YES' ? protectivePrice : oneBase - protectivePrice
  return {
    yesPrice,
    collateral: calculateBuyCollateral(yesPrice, quantity, quoteDecimals, side === 'BUY_NO'),
    filledQuantity: quote.filledQuantity,
    levelsConsumed: quote.levelsConsumed,
  }
}
