import type { Address, Hex, WalletClient } from 'viem'
import type { IocTradeResult, LiveMarketWithBook, SettlementSnapshot, WalletTradeRecord } from '../../lib/dreamdex/gateway'
import { evaluateDecisionScore } from '../../lib/dreamdex/decision'
import { fetchChallenge, type OnchainChallenge } from '../../lib/dreamdex/registry'

export type PracticeSide = 'UP' | 'DOWN'
export type ReasonId = 'ABOVE_OPEN' | 'MOMENTUM' | 'REVERSAL' | 'MARKET_ODDS' | 'INSTINCT'
export type DuelMode = 'solo' | 'friend' | 'benchmark'
export type LobbyView = 'overview' | 'markets' | 'coach' | 'history'

export const reasonCards = [
  { id: 'ABOVE_OPEN', label: 'Above the open', copy: 'Price is holding above the opening line.' },
  { id: 'MOMENTUM', label: 'Momentum', copy: 'The move looks strong enough to continue.' },
  { id: 'REVERSAL', label: 'Reversal', copy: 'The move looks stretched and may turn.' },
  { id: 'MARKET_ODDS', label: 'Market odds', copy: 'The contract price looks mispriced.' },
  { id: 'INSTINCT', label: 'Instinct', copy: 'I am practicing a hunch.' },
] as const

export const confidenceBands = [
  { label: 'Exploring', value: 55, copy: 'Learning the pattern' },
  { label: 'Leaning', value: 75, copy: 'I have a reason' },
  { label: 'Strong view', value: 90, copy: 'I would defend it' },
] as const

export const duelModes = [
  { id: 'solo', label: 'Solo lesson', copy: 'Trade, settle, learn' },
  { id: 'friend', label: 'Reason Duel', copy: 'Same market, no pot' },
  { id: 'benchmark', label: 'Shadow Coach', copy: 'Compare, do not copy' },
] as const

export type ChallengePayload = {
  marketId: string
  asset: string
  interval: string | null
  question: string
  expiry: string
  side: PracticeSide
  reason: string
  confidence: number
  amount: number
  wallet: string
}

export type ChallengeRecord = {
  id: string
  createdAt: number
  status: 'waiting' | 'joined'
  marketId: string
  asset: string
  interval: string | null
  question: string
  expiry: string
  creator: ChallengePayload
  opponent: ChallengePayload | null
}

export type CoachFollowUp = {
  id: string
  marketId: string
  asset: string
  interval: string | null
  question: string
  side: PracticeSide
  reason: string
  confidence: number
  scheduledAt: number
}

export type WalletState = {
  client: WalletClient | null
  address: Address | null
  chainId: number | null
  status: 'idle' | 'connecting' | 'connected' | 'wrong-network' | 'error'
  message: string | null
}

export type TradeState = {
  status: 'idle' | 'preparing' | 'confirmed' | 'error'
  message: string | null
  result: IocTradeResult | null
}

export type SettlementState = {
  status: 'idle' | 'loading' | 'ready' | 'redeeming' | 'error'
  message: string | null
  snapshot: SettlementSnapshot | null
  redemptionHash: string | null
}

export type TradeRecord = WalletTradeRecord
export const initialTradeState: TradeState = { status: 'idle', message: null, result: null }
export const initialSettlementState: SettlementState = { status: 'idle', message: null, snapshot: null, redemptionHash: null }

const CHALLENGE_CACHE_KEY = 'signalsprint.challenge-cache.v1'
const COACH_FOLLOW_UP_KEY = 'signalsprint.coach-follow-ups.v1'
const WALLET_SESSION_KEY = 'signalsprint.wallet-session.v1'
const TRADE_HISTORY_KEY = 'signalsprint.trade-history.v1'

type WalletSession = { address: Address; chainId: number }

export function toChallengeRecord(challenge: OnchainChallenge, market?: LiveMarketWithBook): ChallengeRecord {
  const payload = (call: OnchainChallenge['creator']): ChallengePayload => ({
    marketId: challenge.marketId,
    asset: market?.asset ?? 'Market', interval: market?.interval ?? null,
    question: market?.question ?? 'On-chain Reason Duel', expiry: challenge.expiry.toString(),
    side: call.side, reason: call.reason, confidence: call.confidence, amount: call.amount, wallet: call.wallet,
  })
  return {
    id: challenge.id, createdAt: challenge.createdAt, status: challenge.status, marketId: challenge.marketId,
    asset: market?.asset ?? 'Market', interval: market?.interval ?? null,
    question: market?.question ?? 'On-chain Reason Duel', expiry: challenge.expiry.toString(),
    creator: payload(challenge.creator), opponent: challenge.opponent ? payload(challenge.opponent) : null,
  }
}

export async function loadChallenge(id: string, markets: LiveMarketWithBook[] = []) {
  const challenge = await fetchChallenge(id)
  return toChallengeRecord(challenge, markets.find((market) => market.marketId.toLowerCase() === challenge.marketId.toLowerCase()))
}

export function mergeChallenges(...groups: ChallengeRecord[][]): ChallengeRecord[] {
  const unique = new Map<string, ChallengeRecord>()
  for (const group of groups) for (const challenge of group) unique.set(challenge.id, challenge)
  return [...unique.values()].sort((left, right) => right.createdAt - left.createdAt)
}

export function readChallengeCache(): ChallengeRecord[] {
  try {
    const stored = JSON.parse(window.localStorage.getItem(CHALLENGE_CACHE_KEY) ?? '[]') as ChallengeRecord[]
    return stored.filter((challenge) => typeof challenge?.id === 'string' && typeof challenge?.marketId === 'string')
  } catch { return [] }
}

export function saveChallengeCache(challenges: ChallengeRecord[]) {
  try { window.localStorage.setItem(CHALLENGE_CACHE_KEY, JSON.stringify(mergeChallenges(challenges).slice(0, 20))) } catch { /* chain is canonical */ }
}

export function readCoachFollowUps(): CoachFollowUp[] {
  try {
    const stored = JSON.parse(window.localStorage.getItem(COACH_FOLLOW_UP_KEY) ?? '[]') as CoachFollowUp[]
    return stored.filter((item) => typeof item?.id === 'string' && typeof item?.scheduledAt === 'number')
  } catch { return [] }
}

export function saveCoachFollowUp(followUp: CoachFollowUp): CoachFollowUp[] {
  const next = [followUp, ...readCoachFollowUps().filter((item) => item.id !== followUp.id)].sort((a, b) => b.scheduledAt - a.scheduledAt).slice(0, 20)
  try { window.localStorage.setItem(COACH_FOLLOW_UP_KEY, JSON.stringify(next)) } catch { /* current session remains available */ }
  return next
}

export function readWalletSession(): WalletSession | null {
  try {
    const stored = JSON.parse(window.localStorage.getItem(WALLET_SESSION_KEY) ?? 'null') as Partial<WalletSession> | null
    return typeof stored?.address === 'string' && typeof stored.chainId === 'number' ? { address: stored.address as Address, chainId: stored.chainId } : null
  } catch { return null }
}

export function saveWalletSession(address: Address, chainId: number) {
  try { window.localStorage.setItem(WALLET_SESSION_KEY, JSON.stringify({ address, chainId })) } catch { /* wallet remains usable */ }
}

export function clearWalletSession() {
  try { window.localStorage.removeItem(WALLET_SESSION_KEY) } catch { /* no-op */ }
}

export function readTradeHistory(address: Address): TradeRecord[] {
  try {
    const stored = JSON.parse(window.localStorage.getItem(TRADE_HISTORY_KEY) ?? '[]') as TradeRecord[]
    return stored.filter((record) => record.wallet.toLowerCase() === address.toLowerCase())
  } catch { return [] }
}

export function tradeHistoryKey(record: TradeRecord) {
  return `${record.hash.toLowerCase()}:${record.marketId.toLowerCase()}:${record.outcome}`
}

export function mergeTradeHistory(...groups: TradeRecord[][]): TradeRecord[] {
  const unique = new Map<string, TradeRecord>()
  for (const group of groups) for (const record of group) unique.set(tradeHistoryKey(record), record)
  return [...unique.values()].sort((left, right) => right.createdAt - left.createdAt)
}

export function enrichTradeRecord(record: TradeRecord, snapshot: SettlementSnapshot): TradeRecord {
  const score = evaluateDecisionScore({ outcome: record.outcome, confidence: record.confidence, fillPrice: record.averageFillPrice, filledAmount: record.filledAmount, isResolved: snapshot.isResolved, isVoided: snapshot.isVoided, winningOutcome: snapshot.winningOutcome })
  return { ...record, settlement: { stage: snapshot.stage, isResolved: snapshot.isResolved, isVoided: snapshot.isVoided, winningOutcome: snapshot.winningOutcome, checkedAt: Date.now() }, decisionResult: score.result, decisionScore: score.decisionScore, marketRelativeDelta: score.marketRelativeDelta }
}

export function saveTradeRecord(record: TradeRecord): TradeRecord[] {
  try {
    const stored = JSON.parse(window.localStorage.getItem(TRADE_HISTORY_KEY) ?? '[]') as TradeRecord[]
    const next = [record, ...stored.filter((item) => item.id !== record.id && item.hash !== record.hash)].slice(0, 30)
    window.localStorage.setItem(TRADE_HISTORY_KEY, JSON.stringify(next))
    return next.filter((item) => item.wallet.toLowerCase() === record.wallet.toLowerCase())
  } catch { return [record] }
}

export function isCoachFollowUpReady(scheduledAt: number, now: number) {
  return now >= scheduledAt
}

export type CoachReview = {
  id: string
  marketId: string
  asset: string
  interval: string | null
  question: string
  side: 'UP' | 'DOWN'
  reason: string
  confidence: number | null
  scheduledAt: number | null
  status: 'queued' | 'ready' | 'reviewed'
  record: TradeRecord | null
}

export function deriveCoachReviews(
  history: TradeRecord[],
  followUps: CoachFollowUp[],
  settlements: Map<string, SettlementSnapshot>,
  now: number,
): CoachReview[] {
  const followUpById = new Map(followUps.map((followUp) => [followUp.id.toLowerCase(), followUp]))
  const reviews = history.map((record): CoachReview => {
    const followUp = followUpById.get(record.id.toLowerCase()) ?? followUpById.get(record.hash.toLowerCase())
    const snapshot = settlements.get(record.marketId.toLowerCase())
    const expiry = snapshot ? Number(snapshot.market.expiry) * 1000 : followUp?.scheduledAt ?? null
    const status = record.decisionResult && record.decisionResult !== 'PENDING'
      ? 'reviewed'
      : snapshot?.stage === 'Trading' || (expiry !== null && expiry > now)
        ? 'queued'
        : 'ready'

    return {
      id: record.id,
      marketId: record.marketId,
      asset: record.asset,
      interval: record.interval,
      question: record.question,
      side: record.outcome,
      reason: record.thesis ?? followUp?.reason ?? 'No thesis recorded',
      confidence: record.confidence ?? followUp?.confidence ?? null,
      scheduledAt: expiry,
      status,
      record,
    }
  })

  const known = new Set(reviews.map((review) => review.id.toLowerCase()))
  for (const followUp of followUps) {
    if (known.has(followUp.id.toLowerCase())) continue
    reviews.push({
      ...followUp,
      status: isCoachFollowUpReady(followUp.scheduledAt, now) ? 'ready' : 'queued',
      record: null,
    })
  }

  const rank = { ready: 0, queued: 1, reviewed: 2 }
  return reviews.sort((left, right) => rank[left.status] - rank[right.status] || (right.scheduledAt ?? 0) - (left.scheduledAt ?? 0))
}

export function shortAddress(address: Address) { return `${address.slice(0, 6)}…${address.slice(-4)}` }
export function formatTradeDate(timestamp: number) { return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(timestamp) }
export function formatFollowUpTime(timestamp: number) { return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(timestamp) }
export function describeTradeError(cause: unknown) {
  const message = cause instanceof Error ? cause.message : 'Trade was not completed.'
  return message.includes('ImmediateOrCancelNoFill') ? 'The live book changed before the IOC could fill. No position was created; choose the market again and retry.' : message
}

export const VERIFIED_REPLAY = {
  marketId: '0x000000000000000000000000000000000000000000000000000000000000e3fb' as Hex,
  asset: 'ETH', interval: '15m', question: 'ETH closes at or above its opening price', outcome: 'UP / YES', fillAmount: '5.00', fillPrice: '64.2¢',
  tradeHash: '0x64a656c2b4410d5d05456d33b80b78fc55e3002045e7e8a1d2d26e721b01f099',
  redemptionHash: '0x5eb9f2f0b9779520de6f581d2aea9d63e3a4415d8f4383d1084473f23a53d30e',
} as const
