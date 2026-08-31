import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { createWalletClient, custom, type Address, type EIP1193Provider, type Hex, type WalletClient } from 'viem'
import { somniaShannon } from '@somnia-chain/markets-sdk/chains'
import {
  buildPassportMetrics,
  evaluateDecisionScore,
  normalizeBook,
  type OutcomeIndex,
} from '../../lib/dreamdex/decision'
import {
  executeIocOrder,
  listLiveMarkets,
  listWalletSettlementHistory,
  listWalletTradeHistory,
  loadSettlement,
  redeemSettlement,
  type LiveMarketWithBook,
  type SettlementSnapshot,
} from '../../lib/dreamdex/gateway'
import {
  DECISION_REGISTRY_ADDRESS,
  createChallenge as createOnchainChallenge,
  fetchDecisions,
  fetchWalletChallenges,
  joinChallenge as joinOnchainChallenge,
  recordDecision,
} from '../../lib/dreamdex/registry'
import {
  VERIFIED_REPLAY,
  clearWalletSession,
  confidenceBands,
  describeTradeError,
  deriveCoachReviews,
  duelModes,
  enrichTradeRecord,
  formatFollowUpTime,
  formatTradeDate,
  initialSettlementState,
  initialTradeState,
  isCoachFollowUpReady,
  loadChallenge,
  mergeChallenges,
  mergeTradeHistory,
  readChallengeCache,
  readCoachFollowUps,
  readTradeHistory,
  readWalletSession,
  reasonCards,
  saveChallengeCache,
  saveCoachFollowUp,
  saveTradeRecord,
  saveWalletSession,
  shortAddress,
  toChallengeRecord,
  tradeHistoryKey,
  type ChallengePayload,
  type ChallengeRecord,
  type CoachFollowUp,
  type DuelMode,
  type LobbyView,
  type PracticeSide,
  type ReasonId,
  type SettlementState,
  type TradeRecord,
  type TradeState,
  type WalletState,
} from './lobby-model'

export type { LobbyView } from './lobby-model'

type ProviderListener = (...args: unknown[]) => void
type InjectedProvider = EIP1193Provider & {
  on?: (event: string, listener: ProviderListener) => void
  removeListener?: (event: string, listener: ProviderListener) => void
}

declare global {
  interface Window {
    ethereum?: InjectedProvider
  }
}

function formatCountdown(expiry: string) {
  const seconds = Math.max(0, Number(expiry) - Math.floor(Date.now() / 1000))
  const minutes = Math.floor(seconds / 60)
  if (minutes < 1) return '< 1m'
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

function MarketCard({ market, onSelect }: { market: LiveMarketWithBook; onSelect: () => void }) {
  const book = normalizeBook(market.book, market.quoteDecimals)
  const formatProbability = (probability: number | null) => probability === null
    ? '—'
    : `${Math.round(probability * 100)}%`
  return (
    <article className="market-card" data-market-id={market.marketId}>
      <div className="market-card-topline">
        <span className="market-asset">{market.asset}</span>
        <span className="market-status"><span className="status-dot" /> {market.status}</span>
      </div>
      <h3>{market.question}</h3>
      <div className="market-meta">
        <span>closes in <strong>{formatCountdown(market.expiry)}</strong></span>
        <span>{market.interval ?? 'live'} window</span>
      </div>
      <div className="market-book">
        <span>YES book</span>
        <strong>{book.hasLiquidity ? `${formatProbability(book.bestBid)} bid / ${formatProbability(book.bestAsk)} ask` : 'No liquidity yet'}</strong>
      </div>
      <button className="market-action" type="button" onClick={onSelect}>Compose a call <span>↗</span></button>
      <p className="market-id">marketId · …{market.marketId.slice(-8)}</p>
    </article>
  )
}

function ChallengeInvite({
  challenge,
  available,
  onJoin,
}: {
  challenge: ChallengeRecord
  available: boolean
  onJoin: () => void
}) {
  return (
    <section className="coach-inbox-preview" aria-labelledby="challenge-invite-title">
      <div>
        <p className="eyebrow">Incoming reason duel</p>
        <h3 id="challenge-invite-title">A call is waiting.<br /><em>Bring your own view.</em></h3>
        <p className="coach-inbox-lede">This invite is tied to one live market. You keep your own position and choose your own reason.</p>
      </div>
      <article className="coach-message-card">
        <div className="coach-message-topline">
          <span className="coach-unread"><span className="status-dot" /> Friend challenge</span>
          <span>{challenge.asset} · {challenge.interval ?? 'live'}</span>
        </div>
        <strong>{challenge.question}</strong>
        <p>Someone has committed first. The challenge closes with the market, not with a shared pot.</p>
        <button type="button" className="coach-message-action" onClick={onJoin} disabled={!available}>
          {available ? 'Open this market' : 'Market no longer live'} <span>-&gt;</span>
        </button>
      </article>
    </section>
  )
}

function ChallengeRecordPanel({ challenge }: { challenge: ChallengeRecord }) {
  const inviteUrl = typeof window === 'undefined' ? `/?challenge=${challenge.id}` : `${window.location.origin}/?challenge=${challenge.id}`
  return (
    <div className="trade-result">
      <span>Reason Duel · {challenge.status === 'joined' ? 'opponent joined' : 'invite ready'}</span>
      <strong>{challenge.status === 'joined' ? 'Two independent calls recorded.' : 'Share the round after your fill.'}</strong>
      <small>{challenge.asset} · {challenge.interval ?? 'live'} · same marketId · …{challenge.marketId.slice(-8)}</small>
      {challenge.status === 'waiting' && <small>Invite link · {inviteUrl}</small>}
      {challenge.status === 'joined' && challenge.opponent && <small>Opponent wallet · {shortAddress(challenge.opponent.wallet as Address)}</small>}
      <small>No pooled funds. Each player owns and redeems their own position.</small>
    </div>
  )
}

function DuelBoard({ challenges, onOpen }: { challenges: ChallengeRecord[]; onOpen: (challenge: ChallengeRecord) => void }) {
  return (
    <section className="trade-history" aria-labelledby="duel-board-title">
      <div className="trade-history-heading">
        <div>
          <p className="eyebrow">Reason Duel board</p>
          <h3 id="duel-board-title">Return to the call.</h3>
        </div>
        <span>{challenges.length} round{challenges.length === 1 ? '' : 's'}</span>
      </div>
      {challenges.length === 0 ? (
        <p className="trade-history-empty">Create a Reason Duel from any live market and its invite will stay visible here while this session is open.</p>
      ) : (
        <div className="trade-history-list">
          {challenges.map((challenge) => (
            <article className="trade-history-card" key={challenge.id}>
              <div className="trade-history-topline">
                <span>{challenge.asset} · {challenge.interval ?? 'live'}</span>
                <span>{challenge.status === 'joined' ? 'joined' : 'waiting for a friend'}</span>
              </div>
              <strong>{challenge.question}</strong>
              <small>marketId · …{challenge.marketId.slice(-8)} · {challenge.status === 'joined' ? 'two independent calls recorded' : 'no pooled funds'}</small>
              <div className="trade-history-actions">
                <button type="button" onClick={() => onOpen(challenge)}>{challenge.status === 'joined' ? 'View round' : 'Open round'}</button>
              </div>
            </article>
          ))}
        </div>
      )}
      <small className="trade-history-note">Rounds are wallet-authored on Somnia. Browser cache only speeds up repeat visits; the chain remains the source of truth.</small>
    </section>
  )
}

function OverviewSnapshot({ markets, followUps, challenges, wallet, onViewChange }: { markets: LiveMarketWithBook[]; followUps: CoachFollowUp[]; challenges: ChallengeRecord[]; wallet: WalletState; onViewChange: (view: LobbyView) => void }) {
  const readyFollowUps = followUps.filter((followUp) => isCoachFollowUpReady(followUp.scheduledAt, Date.now())).length
  return (
    <section className="dashboard-snapshot" aria-labelledby="snapshot-title">
      <div className="dashboard-snapshot-head">
        <div>
          <p className="eyebrow">Workspace snapshot</p>
          <h2 id="snapshot-title">Make one clear call.</h2>
        </div>
        <span className="live-indicator"><span className="status-dot" /> live system</span>
      </div>
      <div className="dashboard-metrics">
        <article><span>Live windows</span><strong>{markets.length}</strong><small>DreamDEX markets available</small></article>
        <article><span>Coach queue</span><strong>{readyFollowUps > 0 ? `${readyFollowUps} ready` : followUps.length}</strong><small>{readyFollowUps > 0 ? 'reviews waiting for you' : 'scheduled reviews'}</small></article>
        <article><span>Reason Duels</span><strong>{challenges.length}</strong><small>{challenges.length > 0 ? 'rounds in this browser' : 'start from a live market'}</small></article>
      </div>
      <div className="dashboard-snapshot-actions">
        <button className="primary-button" type="button" onClick={() => onViewChange('markets')}>Open live markets <span>-&gt;</span></button>
        <button className="secondary-button" type="button" onClick={() => onViewChange('coach')}>Open Coach <span>-&gt;</span></button>
      </div>
      <p className="dashboard-snapshot-note">{wallet.address ? 'Wallet connected. Each decision remains self-custodied and bounded.' : 'No wallet connected. Start with the rehearsal, then connect only when you are ready to sign.'}</p>
    </section>
  )
}

function BeginnerLesson() {
  const [practiceSide, setPracticeSide] = useState<PracticeSide | null>(null)

  return (
    <section className="beginner-lesson" aria-labelledby="beginner-lesson-title">
      <div className="beginner-lesson-copy">
        <p className="eyebrow">00 / Start here</p>
        <h2 id="beginner-lesson-title">Learn the call<br /><em>in one move.</em></h2>
        <p>Before a wallet or a market, practice the only rule that matters first: compare the close with the open.</p>
        <span className="lesson-caption">No wallet. No funds. Just one useful idea.</span>
      </div>
      <div className="lesson-card">
        <div className="lesson-card-topline">
          <span>Practice round</span>
          <span>45 sec</span>
        </div>
        <div className="lesson-price-row">
          <div><span>Opening price</span><strong>100</strong></div>
          <div className="lesson-arrow" aria-hidden="true">-&gt;</div>
          <div><span>Closing price</span><strong>103</strong></div>
        </div>
        {!practiceSide ? (
          <>
            <p className="lesson-question">If the close is 103 and the open is 100, which side wins?</p>
            <div className="lesson-choice-grid">
              {(['UP', 'DOWN'] as const).map((side) => (
                <button key={side} type="button" className="lesson-choice" onClick={() => setPracticeSide(side)}>
                  <span>{side}</span>
                  <small>{side === 'UP' ? 'close >= open' : 'close < open'}</small>
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className={`lesson-feedback ${practiceSide === 'UP' ? 'lesson-feedback-correct' : 'lesson-feedback-coach'}`}>
            <span>{practiceSide === 'UP' ? 'Nice read.' : 'Useful miss.'}</span>
            <strong>{practiceSide === 'UP' ? 'UP wins this round.' : 'UP wins this round.'}</strong>
            <p>
              {practiceSide === 'UP'
                ? 'You compared the closing price with the opening price. That is the whole first decision.'
                : 'With a close of 103 and an open of 100, UP wins. The result is feedback, not a punishment.'}
            </p>
            <button type="button" className="lesson-reset" onClick={() => setPracticeSide(null)}>Try another rehearsal</button>
          </div>
        )}
      </div>
    </section>
  )
}

function CoachInboxPreview({
  wallet,
  followUps,
  history,
  settlements,
  onReview,
  onOpenMarkets,
}: {
  wallet: WalletState
  followUps: CoachFollowUp[]
  history: TradeRecord[]
  settlements: Map<string, SettlementSnapshot>
  onReview: (record: TradeRecord) => void
  onOpenMarkets: () => void
}) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const reviews = deriveCoachReviews(history, followUps, settlements, now)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <section className="coach-inbox-preview" aria-labelledby="coach-inbox-title">
      <div>
        <p className="eyebrow">Decision Coach · receipt-based feedback</p>
        <h3 id="coach-inbox-title">The market closes.<br /><em>The lesson stays.</em></h3>
        <p className="coach-inbox-lede">Decision Coach compares your wallet-authored direction, confidence, and entry price with settlement. It is deterministic feedback from your own receipts—not AI advice or a trade recommendation.</p>
      </div>
      {!wallet.address ? (
        <article className="coach-message-card coach-empty-card">
          <div className="coach-message-topline"><span>Wallet-scoped reviews</span><span>Disconnected</span></div>
          <strong>Connect from the navigation bar.</strong>
          <p>Your review queue is reconstructed from indexed fills and on-chain decision receipts after you connect.</p>
        </article>
      ) : reviews.length === 0 ? (
        <article className="coach-message-card coach-empty-card">
          <div className="coach-message-topline"><span>Decision Coach</span><span>No receipts yet</span></div>
          <strong>Make one call worth reviewing.</strong>
          <p>Choose a live market, record your confidence and reason, then return here after the market closes.</p>
          <button type="button" className="coach-message-action" onClick={onOpenMarkets}>Open live markets <span>-&gt;</span></button>
        </article>
      ) : (
        <div className="coach-message-list">
          {reviews.slice(0, 6).map((review) => {
            const isExpanded = expanded === review.id
            const resultLabel = review.record?.decisionResult === 'WIN' ? 'Direction correct' : review.record?.decisionResult === 'LOSS' ? 'Direction missed' : review.record?.decisionResult === 'VOID' ? 'Market voided' : 'Review complete'
            return (
              <article className={`coach-message-card coach-status-${review.status}`} key={review.id}>
                <div className="coach-message-topline">
                  <span className="coach-unread"><span className="status-dot" /> {review.status === 'reviewed' ? resultLabel : review.status === 'ready' ? 'Review ready' : 'Review queued'}</span>
                  <span>{review.asset} · {review.interval ?? 'live'}</span>
                </div>
                <strong>{review.status === 'reviewed' ? resultLabel : review.status === 'ready' ? 'Settlement is ready to inspect.' : 'Your decision is waiting for expiry.'}</strong>
                <p>{review.status === 'queued' && review.scheduledAt
                  ? `Your ${review.side} call becomes reviewable at ${formatFollowUpTime(review.scheduledAt)}.`
                  : review.status === 'reviewed'
                    ? review.record?.decisionScore == null ? 'The receipt is settled. Review the outcome and entry before your next call.' : `Calibration score: ${(review.record.decisionScore * 100).toFixed(0)}%. Use the result to calibrate your next confidence level.`
                    : 'Check the settled direction, calibration score, and any claimable position.'}</p>
                <button type="button" className="coach-message-action" onClick={() => setExpanded(isExpanded ? null : review.id)}>
                  {isExpanded ? 'Hide decision' : 'View decision'} <span>{isExpanded ? '^' : '-&gt;'}</span>
                </button>
                {isExpanded && (
                  <div className="coach-message-detail">
                    <span>Wallet-authored decision</span>
                    <strong>{review.side} · {review.confidence == null ? 'confidence unavailable' : `${review.confidence}% confidence`} · {review.reason}</strong>
                    <small>{review.question} · marketId …{review.marketId.slice(-8)}</small>
                    {review.record && review.status !== 'queued' && (
                      <button type="button" className="coach-message-action" onClick={() => onReview(review.record!)}>
                        {review.status === 'reviewed' ? 'Open full review' : 'Review settlement'} <span>-&gt;</span>
                      </button>
                    )}
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}

function WalletDock({
  wallet,
  onConnect,
  onSwitchChain,
  onDisconnect,
}: {
  wallet: WalletState
  onConnect: () => void
  onSwitchChain: () => void
  onDisconnect: () => void
}) {
  const connectedAddress = wallet.status === 'connected' ? wallet.address : null
  const [mount, setMount] = useState<HTMLElement | null>(null)

  useEffect(() => {
    setMount(document.getElementById('navbar-wallet'))
  }, [])

  if (!mount) return null

  return createPortal(
    <div className="navbar-wallet" aria-label="Wallet connection">
      {wallet.status === 'wrong-network' ? (
        <button className="navbar-wallet-button navbar-wallet-warning" type="button" onClick={onSwitchChain}>Switch network</button>
      ) : connectedAddress ? (
        <button
          className="navbar-wallet-button navbar-wallet-connected"
          type="button"
          onClick={onDisconnect}
          title="Disconnect wallet"
        >
          <span className="status-dot" /> {shortAddress(connectedAddress)}
        </button>
      ) : (
        <button className="navbar-wallet-button" type="button" onClick={onConnect} disabled={wallet.status === 'connecting'}>
          {wallet.status === 'connecting' ? 'Connecting…' : 'Connect wallet'}
        </button>
      )}
      {wallet.status === 'error' && wallet.message && <span className="sr-only" role="status">{wallet.message}</span>}
    </div>,
    mount,
  )
}

function VerifiedReplay() {
  return (
    <section className="trade-history replay-panel" aria-labelledby="replay-title">
      <div className="trade-history-heading">
        <div>
          <p className="eyebrow">Demo replay · read only</p>
          <h3 id="replay-title">One round, fully proven.</h3>
        </div>
        <span>no wallet required</span>
      </div>
      <p className="trade-history-empty">A captured ETH 15m round replayed from immutable testnet evidence. This view never creates a new order.</p>
      <div className="composer-market">
        <span>{VERIFIED_REPLAY.asset} · {VERIFIED_REPLAY.interval} · Redeemed</span>
        <strong>{VERIFIED_REPLAY.question}</strong>
        <small>marketId · …{VERIFIED_REPLAY.marketId.slice(-8)}</small>
      </div>
      <div className="risk-preview" aria-label="Verified replay result">
        <div><span>Decision</span><strong>{VERIFIED_REPLAY.outcome}</strong></div>
        <div><span>Filled</span><strong>{VERIFIED_REPLAY.fillAmount} contracts</strong></div>
        <div><span>Entry</span><strong>{VERIFIED_REPLAY.fillPrice}</strong></div>
        <div><span>Redeemed</span><strong>5.00 tUSDC</strong></div>
      </div>
      <div className="trade-history-actions">
        <a href={`${somniaShannon.blockExplorers.default.url}/tx/${VERIFIED_REPLAY.tradeHash}`} target="_blank" rel="noreferrer">View trade receipt ↗</a>
        <a href={`${somniaShannon.blockExplorers.default.url}/tx/${VERIFIED_REPLAY.redemptionHash}`} target="_blank" rel="noreferrer">View redemption ↗</a>
      </div>
      <small className="trade-history-note">Replay evidence is labeled separately from live activity and is not counted as a new trade.</small>
    </section>
  )
}

async function addSomniaTestnet(client: WalletClient) {
  await client.request({
    method: 'wallet_addEthereumChain',
    params: [{
      chainId: `0x${somniaShannon.id.toString(16)}`,
      chainName: somniaShannon.name,
      nativeCurrency: somniaShannon.nativeCurrency,
      rpcUrls: [...somniaShannon.rpcUrls.default.http],
      blockExplorerUrls: [somniaShannon.blockExplorers.default.url],
    }],
  })
}

function SettlementRail({
  settlement,
  onCheckSettlement,
  onRedeem,
}: {
  settlement: SettlementState
  onCheckSettlement: () => void
  onRedeem: (outcomeIdx: OutcomeIndex) => void
}) {
  return (
    <div className="settlement-panel">
      <div className="settlement-heading">
        <span>Settlement rail</span>
        <strong>{settlement.snapshot?.stage ?? 'Not checked'}</strong>
      </div>
      <p>Re-read the market by `marketId` after expiry. Claims stay disabled until the chain fixes the outcome.</p>
      <button className="settlement-check" type="button" onClick={onCheckSettlement} disabled={settlement.status === 'loading' || settlement.status === 'redeeming'}>
        {settlement.status === 'loading' ? 'Checking settlement…' : 'Check settlement'}
      </button>
      {settlement.snapshot && (
        <>
          <div className="settlement-balances">
            <div><span>UP held</span><strong>{settlement.snapshot.yesBalance.toString()}</strong></div>
            <div><span>DOWN held</span><strong>{settlement.snapshot.noBalance.toString()}</strong></div>
          </div>
          {settlement.snapshot.stage === 'Trading' || settlement.snapshot.stage === 'Locked' ? (
            <small className="settlement-muted">No outcome is claimable yet. Check again after the market resolves.</small>
          ) : settlement.snapshot.claimable.length > 0 ? (
            <div className="claim-list">
              {settlement.snapshot.claimable.map((position) => (
                <button key={position.outcomeIdx} className="claim-button" type="button" onClick={() => onRedeem(position.outcomeIdx)} disabled={settlement.status === 'redeeming'}>
                  {settlement.status === 'redeeming' ? 'Waiting for wallet…' : `Redeem ${position.label}`} <span>{position.balance.toString()}</span>
                </button>
              ))}
            </div>
          ) : (
            <small className="settlement-muted">No claimable held outcome. Losing sides are intentionally blocked.</small>
          )}
        </>
      )}
      {settlement.message && <small className={settlement.status === 'error' ? 'settlement-error' : 'settlement-muted'}>{settlement.message}</small>}
      {settlement.redemptionHash && (
        <a className="redemption-link" href={`${somniaShannon.blockExplorers.default.url}/tx/${settlement.redemptionHash}`} target="_blank" rel="noreferrer">View redemption receipt ↗</a>
      )}
    </div>
  )
}

function DecisionComposer({
  market,
  wallet,
  trade,
  settlement,
  challenge,
  defaultMode = 'solo',
  onExecute,
  onCheckSettlement,
  onRedeem,
  onClose,
}: {
  market: LiveMarketWithBook
  wallet: WalletState
  trade: TradeState
  settlement: SettlementState
  challenge: ChallengeRecord | null
  defaultMode?: DuelMode
  onExecute: (outcome: 'UP' | 'DOWN', amount: number, confidence: number, thesis: string, mode: DuelMode) => void
  onCheckSettlement: () => void
  onRedeem: (outcomeIdx: OutcomeIndex) => void
  onClose: () => void
}) {
  const [outcome, setOutcome] = useState<'UP' | 'DOWN'>('UP')
  const [amount, setAmount] = useState(5)
  const [confidence, setConfidence] = useState(55)
  const [thesis, setThesis] = useState<ReasonId>(reasonCards[0].id)
  const [duelMode, setDuelMode] = useState<DuelMode>(defaultMode)
  const book = normalizeBook(market.book, market.quoteDecimals)
  const entryPrice = outcome === 'UP'
    ? book.bestAsk
    : book.bestBid === null ? null : 1 - book.bestBid
  const estimatedCost = entryPrice === null ? null : amount * entryPrice
  const estimatedProfit = estimatedCost === null ? null : amount - estimatedCost
  const formatTokens = (value: number | null) => value === null ? '—' : value.toFixed(2)

  return (
    <div className="composer-backdrop">
      <aside className="composer" role="dialog" aria-modal="true" aria-labelledby="composer-title">
        <div className="composer-head">
          <div>
            <p className="eyebrow">02 / Decision composer</p>
            <h2 id="composer-title">Make the call.</h2>
          </div>
          <button className="composer-close" type="button" onClick={onClose} aria-label="Close decision composer">×</button>
        </div>

        <div className="composer-market">
          <span>{market.asset} · {market.interval}</span>
          <strong>{market.question}</strong>
          <small>marketId · …{market.marketId.slice(-8)}</small>
        </div>

        <div className="mode-field">
          <div className="mode-heading">
            <span>How do you want to learn?</span>
            <small>choose a round</small>
          </div>
          <div className="mode-grid">
            {duelModes.map((mode) => (
              <button
                key={mode.id}
                type="button"
                className={`mode-option ${duelMode === mode.id ? 'selected' : ''}`}
                onClick={() => setDuelMode(mode.id)}
              >
                <strong>{mode.label}</strong>
                <small>{mode.copy}</small>
              </button>
            ))}
          </div>
          {duelMode === 'friend' && (
            <p className="mode-note"><strong>No shared pot.</strong> You and your friend each keep your own DreamDEX position. The winner is the settled direction; the lesson score is separate.</p>
          )}
          {duelMode === 'benchmark' && (
            <p className="mode-note"><strong>Read-only comparison.</strong> The Shadow Coach never trades or gives financial advice. It is a fixed reference for your post-settlement lesson.</p>
          )}
        </div>

        <fieldset className="outcome-picker">
          <legend>Your outcome</legend>
          <button className={outcome === 'UP' ? 'selected' : ''} type="button" onClick={() => setOutcome('UP')}>
            <span>UP / YES</span><strong>{book.bestAsk === null ? '—' : `${Math.round(book.bestAsk * 100)}¢`}</strong>
          </button>
          <button className={outcome === 'DOWN' ? 'selected' : ''} type="button" onClick={() => setOutcome('DOWN')}>
            <span>DOWN / NO</span><strong>{book.bestBid === null ? '—' : `${Math.round((1 - book.bestBid) * 100)}¢`}</strong>
          </button>
        </fieldset>

        <label className="composer-field">
          <span>Outcome contracts <small>max 10</small></span>
          <input type="number" min="1" max="10" step="1" value={amount} onChange={(event) => setAmount(Math.min(10, Math.max(1, Number(event.target.value))))} />
        </label>

        <div className="composer-field reason-field">
          <span>Why this side? <small>pick one reason</small></span>
          <div className="reason-card-grid">
            {reasonCards.map((reason) => (
              <button
                key={reason.id}
                type="button"
                className={`reason-card ${thesis === reason.id ? 'selected' : ''}`}
                onClick={() => setThesis(reason.id)}
              >
                <strong>{reason.label}</strong>
                <small>{reason.copy}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="composer-field confidence-field">
          <span>How sure are you? <small>self-reported</small></span>
          <div className="confidence-grid">
            {confidenceBands.map((band) => (
              <button
                key={band.label}
                type="button"
                className={`confidence-option ${confidence === band.value ? 'selected' : ''}`}
                onClick={() => setConfidence(band.value)}
              >
                <strong>{band.label}</strong>
                <small>{band.copy}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="risk-preview" aria-label="Risk preview">
          <div><span>Estimated cost</span><strong>{formatTokens(estimatedCost)} tUSDC</strong></div>
          <div><span>Maximum loss</span><strong>{formatTokens(estimatedCost)} tUSDC</strong></div>
          <div><span>Profit if correct</span><strong>{formatTokens(estimatedProfit)} tUSDC</strong></div>
          <div><span>Payout if correct</span><strong>{amount.toFixed(2)} tUSDC</strong></div>
        </div>

        <p className="testnet-notice">Testnet practice only. The final price and fill can change before wallet confirmation.</p>
        <p className="commitment-note">When you sign, your side, reason, confidence, and maximum loss become this round's decision record.</p>
        {challenge && <ChallengeRecordPanel challenge={challenge} />}
        {wallet.status === 'connected' && wallet.address ? (
          <>
            <div className="wallet-connected">
              <span>Wallet connected</span>
              <strong>{shortAddress(wallet.address)}</strong>
              <small>{trade.status === 'preparing' ? 'Checking market, balance, and live liquidity.' : 'Ready to sign a bounded IOC order.'}</small>
            </div>
            <button
              className="composer-submit"
              type="button"
              disabled={trade.status === 'preparing' || trade.status === 'confirmed' || entryPrice === null}
              onClick={() => onExecute(outcome, amount, confidence, thesis, duelMode)}
            >
              {trade.status === 'preparing'
                ? 'Preparing trade…'
                : trade.status === 'confirmed'
                  ? 'Trade confirmed'
                  : `Place ${amount} ${outcome === 'UP' ? 'YES' : 'NO'} contracts`}
            </button>
          </>
      ) : (
        <p className="composer-wallet-prompt" role="status">
          {wallet.status === 'wrong-network'
            ? 'Switch to Somnia testnet from the wallet control in the navigation bar.'
            : 'Connect your wallet from the navigation bar to place this trade.'}
        </p>
      )}
        {wallet.message && <p className={`wallet-message ${wallet.status === 'error' ? 'wallet-error' : ''}`}>{wallet.message}</p>}
        {trade.message && <p className={`wallet-message ${trade.status === 'error' ? 'wallet-error' : ''}`}>{trade.message}</p>}
        {trade.result && (
          <div className="trade-result">
            <span>On-chain receipt</span>
            <strong>{trade.result.filledAmount.toFixed(2)} / {trade.result.requestedAmount.toFixed(2)} filled</strong>
            {trade.result.averageFillPrice !== null && <small>average fill · {(trade.result.averageFillPrice * 100).toFixed(1)}¢</small>}
            <a href={`${somniaShannon.blockExplorers.default.url}/tx/${trade.result.hash}`} target="_blank" rel="noreferrer">View transaction ↗</a>
          </div>
        )}
        {trade.result && wallet.address && <SettlementRail settlement={settlement} onCheckSettlement={onCheckSettlement} onRedeem={onRedeem} />}
      </aside>
    </div>
  )
}

function TradeHistoryPanel({
  history,
  settlements,
  onReview,
}: {
  history: TradeRecord[]
  settlements: Map<string, SettlementSnapshot>
  onReview: (record: TradeRecord) => void
}) {
  const metrics = buildPassportMetrics(history.map((record) => ({
    filledAmount: record.filledAmount,
    cost: record.averageFillPrice === null ? 0 : record.filledAmount * record.averageFillPrice,
    score: evaluateDecisionScore({
      outcome: record.outcome,
      confidence: record.confidence,
      fillPrice: record.averageFillPrice,
      filledAmount: record.filledAmount,
      isResolved: settlements.get(record.marketId.toLowerCase())?.isResolved ?? record.settlement?.isResolved ?? false,
      isVoided: settlements.get(record.marketId.toLowerCase())?.isVoided ?? record.settlement?.isVoided ?? false,
      winningOutcome: settlements.get(record.marketId.toLowerCase())?.winningOutcome ?? record.settlement?.winningOutcome,
    }),
    realizedPayout: null,
  })))

  return (
    <section className="trade-history" aria-labelledby="trade-history-title">
      <div className="trade-history-heading">
        <div>
          <p className="eyebrow">Your decision receipts</p>
          <h3 id="trade-history-title">Keep the proof.</h3>
        </div>
        <span>{history.length} saved round{history.length === 1 ? '' : 's'}</span>
      </div>
      {history.length === 0 ? (
        <p className="trade-history-empty">Your confirmed trades will stay here for this wallet, even after you close the composer.</p>
      ) : (
        <div className="trade-history-list">
          {history.map((record) => (
              <article className="trade-history-card" key={record.id}>
              <div className="trade-history-topline">
                <span>{record.asset} · {record.interval ?? 'live'}</span>
                <time dateTime={new Date(record.createdAt).toISOString()}>{formatTradeDate(record.createdAt)}</time>
              </div>
              <strong>{record.outcome === 'UP' ? 'UP / YES' : 'DOWN / NO'} · {record.filledAmount.toFixed(2)} contracts filled</strong>
              <small>{record.question}</small>
              <div className="trade-history-actions">
                <a href={`${somniaShannon.blockExplorers.default.url}/tx/${record.hash}`} target="_blank" rel="noreferrer">View transaction ↗</a>
                <button type="button" onClick={() => onReview(record)}>Review settlement</button>
              </div>
            </article>
          ))}
        </div>
      )}
      <div className="risk-preview passport-summary" aria-label="Decision passport summary">
        <div><span>Rounds</span><strong>{metrics.rounds}</strong></div>
        <div><span>Resolved sample</span><strong>{metrics.resolvedRounds}</strong></div>
        <div><span>Win rate</span><strong>{metrics.winRate === null ? '—' : `${Math.round(metrics.winRate * 100)}%`}</strong></div>
        <div><span>Known at risk</span><strong>{metrics.totalAtRisk.toFixed(2)} tUSDC</strong></div>
      </div>
      <small className="trade-history-note">Win rate and calibration exclude unresolved and void rounds. Scored sample: {metrics.calibrationSampleSize}.</small>
      <small className="trade-history-note">Wallet-scoped history is synced from chain fills and local receipts; every round stays linked to its `marketId` and transaction receipt.</small>
    </section>
  )
}

function DecisionReceipt({ record, snapshot }: { record: TradeRecord; snapshot: SettlementSnapshot | null }) {
  if (!snapshot) {
    return <div className="trade-result"><span>Decision result</span><strong>Check settlement to reveal the result.</strong></div>
  }

  const score = evaluateDecisionScore({
    outcome: record.outcome,
    confidence: record.confidence,
    fillPrice: record.averageFillPrice,
    filledAmount: record.filledAmount,
    isResolved: snapshot.isResolved,
    isVoided: snapshot.isVoided,
    winningOutcome: snapshot.winningOutcome,
  })
  const resultLabel = score.result === 'WIN'
    ? 'Won'
    : score.result === 'LOSS'
      ? 'Lost'
      : score.result === 'VOID'
        ? 'Voided / refunded path'
        : score.result === 'NO_FILL'
          ? 'No fill'
          : 'Awaiting final outcome'

  return (
    <div className="trade-result">
      <span>Decision result · {snapshot.stage}</span>
      <strong>{resultLabel}</strong>
      {score.decisionScore !== null && <small>decision score · {score.decisionScore}/100</small>}
      {score.marketRelativeDelta !== null && <small>market-relative delta · {score.marketRelativeDelta >= 0 ? '+' : ''}{score.marketRelativeDelta.toFixed(3)}</small>}
      {record.confidence === undefined
        ? <small>self-reported confidence was not captured for this imported fill</small>
        : <small>self-reported confidence · {record.confidence}%{record.thesis ? ` · ${record.thesis}` : ''}</small>}
      <small>Score formula: 100 × (1 − Brier loss). One round is not proof of future performance.</small>
    </div>
  )
}

function TradeReview({
  record,
  settlement,
  onCheckSettlement,
  onRedeem,
  onClose,
}: {
  record: TradeRecord
  settlement: SettlementState
  onCheckSettlement: () => void
  onRedeem: (outcomeIdx: OutcomeIndex) => void
  onClose: () => void
}) {
  return (
    <div className="composer-backdrop">
      <aside className="composer" role="dialog" aria-modal="true" aria-labelledby="review-title">
        <div className="composer-head">
          <div>
            <p className="eyebrow">03 / Trade receipt</p>
            <h2 id="review-title">Review the round.</h2>
          </div>
          <button className="composer-close" type="button" onClick={onClose} aria-label="Close trade review">×</button>
        </div>
        <div className="composer-market">
          <span>{record.asset} · {record.interval}</span>
          <strong>{record.question}</strong>
          <small>marketId · …{record.marketId.slice(-8)}</small>
        </div>
        <div className="trade-result">
          <span>On-chain receipt</span>
          <strong>{record.filledAmount.toFixed(2)} / {record.requestedAmount.toFixed(2)} filled</strong>
          {record.averageFillPrice !== null && <small>average fill · {(record.averageFillPrice * 100).toFixed(1)}¢</small>}
          <a href={`${somniaShannon.blockExplorers.default.url}/tx/${record.hash}`} target="_blank" rel="noreferrer">View transaction ↗</a>
        </div>
        <DecisionReceipt record={record} snapshot={settlement.snapshot} />
        <SettlementRail settlement={settlement} onCheckSettlement={onCheckSettlement} onRedeem={onRedeem} />
      </aside>
    </div>
  )
}

export function MarketLobby({ view, onViewChange }: { view: LobbyView; onViewChange: (view: LobbyView) => void }) {
  const [markets, setMarkets] = useState<LiveMarketWithBook[]>([])
  const [diagnostics, setDiagnostics] = useState<{ scanned: number; checked: number; bookCoverage: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedMarket, setSelectedMarket] = useState<LiveMarketWithBook | null>(null)
  const [incomingChallenge, setIncomingChallenge] = useState<ChallengeRecord | null>(null)
  const [activeChallenge, setActiveChallenge] = useState<ChallengeRecord | null>(null)
  const [challenges, setChallenges] = useState<ChallengeRecord[]>([])
  const [challengeError, setChallengeError] = useState<string | null>(null)
  const [trade, setTrade] = useState<TradeState>(initialTradeState)
  const [settlement, setSettlement] = useState<SettlementState>(initialSettlementState)
  const [history, setHistory] = useState<TradeRecord[]>([])
  const [historySettlements, setHistorySettlements] = useState<Map<string, SettlementSnapshot>>(new Map())
  const [followUps, setFollowUps] = useState<CoachFollowUp[]>([])
  const [reviewRecord, setReviewRecord] = useState<TradeRecord | null>(null)
  const [reviewSettlement, setReviewSettlement] = useState<SettlementState>(initialSettlementState)
  const [wallet, setWallet] = useState<WalletState>(() => {
    const session = readWalletSession()
    return {
      client: null,
      address: session?.address ?? null,
      chainId: session?.chainId ?? null,
      status: session ? 'connecting' : 'idle',
      message: null,
    }
  })

  useEffect(() => {
    const provider = window.ethereum
    const session = readWalletSession()
    if (!session) return
    if (!provider) {
      setWallet((current) => ({ ...current, status: 'error', message: 'Wallet provider unavailable. Reconnect your browser wallet to continue.' }))
      return
    }

    let active = true
    const syncWallet = async () => {
      const client = createWalletClient({ chain: somniaShannon, transport: custom(provider) })
      const [address] = await client.getAddresses()
      if (!address) {
        clearWalletSession()
        if (active) setWallet({ client: null, address: null, chainId: null, status: 'idle', message: null })
        return
      }
      const chainId = await client.getChainId()
      saveWalletSession(address, chainId)
      if (active) {
        setWallet({
          client,
          address,
          chainId,
          status: chainId === somniaShannon.id ? 'connected' : 'wrong-network',
          message: chainId === somniaShannon.id ? null : `Wallet is on chain ${chainId}; SignalSprint requires Somnia testnet.`,
        })
      }
    }
    const handleAccountsChanged: ProviderListener = () => {
      if (readWalletSession()) void syncWallet()
    }
    const handleChainChanged: ProviderListener = () => {
      if (readWalletSession()) void syncWallet()
    }

    void syncWallet().catch((cause: unknown) => {
      if (active) setWallet((current) => ({ ...current, status: 'error', message: cause instanceof Error ? cause.message : 'Saved wallet could not be restored.' }))
    })
    provider.on?.('accountsChanged', handleAccountsChanged)
    provider.on?.('chainChanged', handleChainChanged)
    return () => {
      active = false
      provider.removeListener?.('accountsChanged', handleAccountsChanged)
      provider.removeListener?.('chainChanged', handleChainChanged)
    }
  }, [])

  useEffect(() => {
    let active = true
    const cachedChallenges = readChallengeCache()
    setChallenges(cachedChallenges)
    if (!wallet.address || !DECISION_REGISTRY_ADDRESS) return () => { active = false }
    fetchWalletChallenges(wallet.address)
      .then((onchain) => {
        const records = onchain.map((challenge) => toChallengeRecord(
          challenge,
          markets.find((market) => market.marketId.toLowerCase() === challenge.marketId.toLowerCase()),
        ))
        const merged = mergeChallenges(records, cachedChallenges)
        saveChallengeCache(merged)
        if (active) setChallenges(merged)
      })
      .catch((cause: unknown) => {
        if (active && cachedChallenges.length === 0) {
          setChallengeError(cause instanceof Error ? cause.message : 'On-chain challenges could not be loaded.')
        }
      })
    return () => { active = false }
  }, [wallet.address, markets])

  useEffect(() => {
    setFollowUps(readCoachFollowUps())
  }, [])

  useEffect(() => {
    if (!wallet.address) {
      setHistory([])
      setHistorySettlements(new Map())
      return
    }

    let active = true
    const address = wallet.address
    const localHistory = readTradeHistory(address)
    setHistory(localHistory)

    async function syncHistory() {
      let records = localHistory
      try {
        const remoteHistory = await listWalletTradeHistory(address)
        let hydratedRemote = remoteHistory
        if (DECISION_REGISTRY_ADDRESS) {
          const decisions = await fetchDecisions(address)
          const byTradeHash = new Map(decisions.map((decision) => [decision.tradeHash.toLowerCase(), decision]))
          hydratedRemote = remoteHistory.map((record) => {
            const decision = byTradeHash.get(record.hash.toLowerCase())
            return decision ? { ...record, confidence: decision.confidence, thesis: decision.thesis } : record
          })
        }
        records = mergeTradeHistory(hydratedRemote, readTradeHistory(address))
      } catch {
        // Keep locally saved receipts visible while the chain or indexer is unavailable.
      }
      if (!active) return
      setHistory(records)

      const snapshots = await listWalletSettlementHistory({
        address,
        marketIds: records.map((record) => record.marketId),
      })
      if (active) {
        const settlements = new Map(snapshots.map((snapshot) => [snapshot.market.marketId.toLowerCase(), snapshot]))
        const hydratedRecords = records.map((record) => {
          const snapshot = settlements.get(record.marketId.toLowerCase())
          if (!snapshot) return record
          const hydrated = enrichTradeRecord(record, snapshot)
          saveTradeRecord(hydrated)
          return hydrated
        })
        setHistory(hydratedRecords)
        setHistorySettlements(settlements)
      }
    }

    void syncHistory()

    return () => {
      active = false
    }
  }, [wallet.address])

  useEffect(() => {
    const challengeId = new URLSearchParams(window.location.search).get('challenge')
    if (!challengeId) return
    let active = true
    loadChallenge(challengeId, markets)
      .then((challenge) => {
        saveChallengeCache([challenge, ...readChallengeCache()])
        if (active) {
          setIncomingChallenge(challenge)
          setChallenges((current) => mergeChallenges([challenge], current))
          onViewChange('coach')
        }
      })
      .catch((cause: unknown) => {
        const cachedChallenge = readChallengeCache().find((challenge) => challenge.id === challengeId)
        if (active && cachedChallenge) {
          setIncomingChallenge(cachedChallenge)
          setChallenges((current) => mergeChallenges([cachedChallenge], current))
        } else if (active) {
          setChallengeError(cause instanceof Error ? cause.message : 'This challenge could not be loaded.')
        }
      })
    return () => {
      active = false
    }
  }, [markets, onViewChange])

  function openChallenge(challenge: ChallengeRecord) {
    const market = markets.find((candidate) => candidate.marketId.toLowerCase() === challenge.marketId.toLowerCase())
    if (!market) {
      setChallengeError('This market is no longer live. The invite can no longer be joined.')
      return
    }
    setActiveChallenge(challenge)
    setTrade(initialTradeState)
    setSettlement(initialSettlementState)
    setSelectedMarket(market)
    onViewChange('markets')
  }

  function openIncomingChallenge() {
    if (!incomingChallenge) return
    openChallenge(incomingChallenge)
  }

  async function connectWallet() {
    const provider = window.ethereum
    if (!provider) {
      setWallet((current) => ({ ...current, status: 'error', message: 'Install a browser wallet to continue.' }))
      return
    }

    setWallet((current) => ({ ...current, status: 'connecting', message: null }))
    try {
      const client = createWalletClient({ chain: somniaShannon, transport: custom(provider) })
      const [address] = await client.requestAddresses()
      const chainId = await client.getChainId()
      saveWalletSession(address, chainId)
      setWallet({
        client,
        address,
        chainId,
        status: chainId === somniaShannon.id ? 'connected' : 'wrong-network',
        message: chainId === somniaShannon.id ? null : `Wallet is on chain ${chainId}; SignalSprint requires Somnia testnet.`,
      })
    } catch (cause: unknown) {
      setWallet((current) => ({
        ...current,
        status: 'error',
        message: cause instanceof Error ? cause.message : 'Wallet connection was not completed.',
      }))
    }
  }

  async function switchWalletChain() {
    if (!wallet.client) return
    try {
      try {
        await wallet.client.switchChain({ id: somniaShannon.id })
      } catch {
        await addSomniaTestnet(wallet.client)
        await wallet.client.switchChain({ id: somniaShannon.id })
      }
      const chainId = await wallet.client.getChainId()
      if (wallet.address) saveWalletSession(wallet.address, chainId)
      setWallet((current) => ({
        ...current,
        chainId,
        status: chainId === somniaShannon.id ? 'connected' : 'wrong-network',
        message: chainId === somniaShannon.id ? null : `Wallet is on chain ${chainId}; SignalSprint requires Somnia testnet.`,
      }))
    } catch (cause: unknown) {
      setWallet((current) => ({ ...current, status: 'error', message: cause instanceof Error ? cause.message : 'Network switch was not completed.' }))
    }
  }

  function disconnectWallet() {
    clearWalletSession()
    setWallet({ client: null, address: null, chainId: null, status: 'idle', message: null })
    setHistory([])
    setHistorySettlements(new Map())
  }

  async function executeTrade(outcome: 'UP' | 'DOWN', amount: number, confidence: number, thesis: string, mode: DuelMode) {
    if (!wallet.client || !wallet.address || wallet.status !== 'connected' || !selectedMarket) return
    setTrade({ status: 'preparing', message: null, result: null })
    setSettlement(initialSettlementState)
    try {
      const result = await executeIocOrder({
        marketId: selectedMarket.marketId,
        outcome,
        amount,
        address: wallet.address,
        walletClient: wallet.client,
      })
      setTrade({
        status: 'confirmed',
        message: result.filledAmount > 0
          ? `Confirmed: ${result.filledAmount.toFixed(2)} contracts filled.`
          : 'Confirmed on-chain, but the IOC found no matching contracts.',
        result,
      })
      setHistory(saveTradeRecord({
        id: result.hash,
        hash: result.hash,
        wallet: wallet.address.toLowerCase(),
        marketId: selectedMarket.marketId,
        asset: selectedMarket.asset,
        interval: selectedMarket.interval ?? null,
        question: selectedMarket.question,
        outcome,
        requestedAmount: result.requestedAmount,
        filledAmount: result.filledAmount,
        averageFillPrice: result.averageFillPrice,
        createdAt: Date.now(),
        confidence,
        thesis,
      }))

      if (result.filledAmount > 0 && DECISION_REGISTRY_ADDRESS) {
        try {
          await recordDecision({
            marketId: selectedMarket.marketId as Hex,
            tradeHash: result.hash as Hex,
            side: outcome,
            confidence,
            thesis,
            address: wallet.address,
            walletClient: wallet.client,
          })
          setTrade((current) => ({ ...current, message: `${current.message} Decision receipt saved on-chain.` }))
        } catch (cause: unknown) {
          setTrade((current) => ({
            ...current,
            message: `${current.message} Trade is confirmed; decision receipt was skipped: ${cause instanceof Error ? cause.message : 'wallet request not completed.'}`,
          }))
        }
      }

      if (result.filledAmount > 0) {
        const scheduledAt = Number(selectedMarket.expiry) * 1000
        if (Number.isFinite(scheduledAt)) {
          setFollowUps(saveCoachFollowUp({
            id: result.hash,
            marketId: selectedMarket.marketId,
            asset: selectedMarket.asset,
            interval: selectedMarket.interval ?? null,
            question: selectedMarket.question,
            side: outcome,
            reason: thesis,
            confidence,
            scheduledAt,
          }))
        }
      }

      if (mode === 'friend' && result.filledAmount > 0) {
        const payload: ChallengePayload = {
          marketId: selectedMarket.marketId,
          asset: selectedMarket.asset,
          interval: selectedMarket.interval ?? null,
          question: selectedMarket.question,
          expiry: selectedMarket.expiry,
          side: outcome,
          reason: thesis,
          confidence,
          amount: result.filledAmount,
          wallet: wallet.address.toLowerCase(),
        }
        try {
          if (!DECISION_REGISTRY_ADDRESS) throw new Error('Decision Registry is not configured.')
          if (incomingChallenge) {
            await joinOnchainChallenge({
              id: incomingChallenge.id,
              side: payload.side,
              confidence: payload.confidence,
              reason: payload.reason,
              amount: payload.amount,
              address: wallet.address,
              walletClient: wallet.client,
            })
          }
          const challengeId = incomingChallenge?.id ?? await createOnchainChallenge({
            marketId: payload.marketId as Hex,
            side: payload.side,
            confidence: payload.confidence,
            reason: payload.reason,
            amount: payload.amount,
            expiry: Number(payload.expiry),
            address: wallet.address,
            walletClient: wallet.client,
          })
          const challenge = await loadChallenge(challengeId, markets)
          saveChallengeCache([challenge, ...readChallengeCache()])
          setActiveChallenge(challenge)
          setChallenges((current) => mergeChallenges([challenge], current))
          if (incomingChallenge) setIncomingChallenge(challenge)
          setTrade((current) => ({
            ...current,
            message: incomingChallenge ? 'Duel joined. Your independent position is recorded.' : 'Duel created. Share the invite link with your friend.',
          }))
        } catch (cause: unknown) {
          setTrade((current) => ({
            ...current,
            message: `Trade confirmed, but duel setup failed: ${cause instanceof Error ? cause.message : 'challenge service unavailable.'}`,
          }))
        }
      }
    } catch (cause: unknown) {
      setTrade({
        status: 'error',
        message: describeTradeError(cause),
        result: null,
      })
    }
  }

  async function checkSettlement() {
    if (!wallet.address || !selectedMarket) return
    setSettlement({ ...initialSettlementState, status: 'loading' })
    try {
      const snapshot = await loadSettlement({ marketId: selectedMarket.marketId, address: wallet.address })
      setSettlement({ status: 'ready', message: null, snapshot, redemptionHash: null })
    } catch (cause: unknown) {
      setSettlement({ ...initialSettlementState, status: 'error', message: cause instanceof Error ? cause.message : 'Settlement could not be read.' })
    }
  }

  async function redeem(outcomeIdx: OutcomeIndex) {
    if (!wallet.client || !wallet.address || !selectedMarket) return
    setSettlement((current) => ({ ...current, status: 'redeeming', message: null }))
    try {
      const result = await redeemSettlement({
        marketId: selectedMarket.marketId,
        address: wallet.address,
        walletClient: wallet.client,
        outcomeIdx,
      })
      const snapshot = await loadSettlement({ marketId: selectedMarket.marketId, address: wallet.address })
      setSettlement({
        status: 'ready',
        message: `Redeemed ${result.amount.toString()} ${result.outcomeIdx === 0 ? 'UP' : 'DOWN'} outcome units.`,
        snapshot,
        redemptionHash: result.hash,
      })
    } catch (cause: unknown) {
      setSettlement((current) => ({ ...current, status: 'error', message: cause instanceof Error ? cause.message : 'Redemption was not completed.' }))
    }
  }

  function reviewTrade(record: TradeRecord) {
    setReviewRecord(record)
    setReviewSettlement(initialSettlementState)
  }

  async function checkReviewSettlement() {
    if (!wallet.address || !reviewRecord) return
    setReviewSettlement({ ...initialSettlementState, status: 'loading' })
    try {
      const snapshot = await loadSettlement({ marketId: reviewRecord.marketId, address: wallet.address })
      const hydratedRecord = enrichTradeRecord(reviewRecord, snapshot)
      saveTradeRecord(hydratedRecord)
      setReviewRecord(hydratedRecord)
      setHistory((current) => current.map((record) => tradeHistoryKey(record) === tradeHistoryKey(reviewRecord) ? hydratedRecord : record))
      setHistorySettlements((current) => new Map(current).set(snapshot.market.marketId.toLowerCase(), snapshot))
      setReviewSettlement({ status: 'ready', message: null, snapshot, redemptionHash: null })
    } catch (cause: unknown) {
      setReviewSettlement({ ...initialSettlementState, status: 'error', message: cause instanceof Error ? cause.message : 'Settlement could not be read.' })
    }
  }

  async function redeemReviewed(outcomeIdx: OutcomeIndex) {
    if (!wallet.client || !wallet.address || !reviewRecord) return
    setReviewSettlement((current) => ({ ...current, status: 'redeeming', message: null }))
    try {
      const result = await redeemSettlement({
        marketId: reviewRecord.marketId,
        address: wallet.address,
        walletClient: wallet.client,
        outcomeIdx,
      })
      const snapshot = await loadSettlement({ marketId: reviewRecord.marketId, address: wallet.address })
      const hydratedRecord = enrichTradeRecord(reviewRecord, snapshot)
      saveTradeRecord(hydratedRecord)
      setReviewRecord(hydratedRecord)
      setHistory((current) => current.map((record) => tradeHistoryKey(record) === tradeHistoryKey(reviewRecord) ? hydratedRecord : record))
      setHistorySettlements((current) => new Map(current).set(snapshot.market.marketId.toLowerCase(), snapshot))
      setReviewSettlement({
        status: 'ready',
        message: `Redeemed ${result.amount.toString()} ${result.outcomeIdx === 0 ? 'UP' : 'DOWN'} outcome units.`,
        snapshot,
        redemptionHash: result.hash,
      })
    } catch (cause: unknown) {
      setReviewSettlement((current) => ({ ...current, status: 'error', message: cause instanceof Error ? cause.message : 'Redemption was not completed.' }))
    }
  }

  useEffect(() => {
    let active = true
    listLiveMarkets()
      .then((result) => {
        if (active) {
          setMarkets(result.markets)
          setDiagnostics({ scanned: result.scanned, checked: result.checked, bookCoverage: result.bookCoverage })
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not load live markets.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [])

  return (
    <section className={`lobby lobby-view-${view}`} aria-labelledby="lobby-title">
      <WalletDock wallet={wallet} onConnect={connectWallet} onSwitchChain={switchWalletChain} onDisconnect={disconnectWallet} />
      {view === 'overview' && <>
        <OverviewSnapshot markets={markets} followUps={followUps} challenges={challenges} wallet={wallet} onViewChange={onViewChange} />
        <BeginnerLesson />
      </>}
      {view === 'markets' && <>
        <div className="section-heading">
          <div>
            <p className="eyebrow">01 / Live market board</p>
            <h2 id="lobby-title">Pick a window<br /><em>worth proving.</em></h2>
          </div>
          <p className="section-note">Read-only testnet discovery. Every card is keyed to the live `marketId` so a recycled pool never overwrites your record.</p>
        </div>
        {loading && <div className="lobby-state">Querying DreamDEX live markets<span className="loading-dots">...</span></div>}
        {error && <div className="lobby-state lobby-error">Live market query failed: {error}</div>}
        {challengeError && <div className="lobby-state lobby-error">Challenge: {challengeError}</div>}
        {incomingChallenge && !selectedMarket && <ChallengeInvite challenge={incomingChallenge} available={markets.some((market) => market.marketId.toLowerCase() === incomingChallenge.marketId.toLowerCase())} onJoin={openIncomingChallenge} />}
        {!loading && !error && (
          <div className="market-grid">
            {markets.map((market) => (
              <MarketCard key={market.marketId} market={market} onSelect={() => {
                setTrade(initialTradeState)
                setSettlement(initialSettlementState)
                setActiveChallenge(incomingChallenge?.marketId.toLowerCase() === market.marketId.toLowerCase() ? incomingChallenge : null)
                setSelectedMarket(market)
              }} />
            ))}
          </div>
        )}
        {!loading && !error && markets.length === 0 && <div className="lobby-state">No live binary markets are available right now.</div>}
        {import.meta.env.DEV && diagnostics && (
          <aside className="diagnostics" aria-label="Development diagnostics">
            <span>DEV DIAGNOSTICS</span>
            <span>scanned {diagnostics.scanned}</span>
            <span>checked {diagnostics.checked}</span>
            <span>eligible {markets.length}</span>
            <span>book coverage {diagnostics.bookCoverage}/{markets.length}</span>
          </aside>
        )}
      </>}
      {view === 'coach' && <>
        {challengeError && <div className="lobby-state lobby-error">Challenge: {challengeError}</div>}
        {incomingChallenge && !selectedMarket && <ChallengeInvite challenge={incomingChallenge} available={markets.some((market) => market.marketId.toLowerCase() === incomingChallenge.marketId.toLowerCase())} onJoin={openIncomingChallenge} />}
        <CoachInboxPreview
          wallet={wallet}
          followUps={followUps}
          history={history}
          settlements={historySettlements}
          onReview={reviewTrade}
          onOpenMarkets={() => onViewChange('markets')}
        />
        <DuelBoard challenges={challenges} onOpen={openChallenge} />
      </>}
      {view === 'history' && <>
        <VerifiedReplay />
        {wallet.address ? <TradeHistoryPanel history={history} settlements={historySettlements} onReview={reviewTrade} /> : <div className="history-empty-state"><p className="eyebrow">Wallet history</p><h2>Connect a wallet to see your receipts.</h2><p>Your decision records are wallet-scoped. Open Live markets when you are ready to connect and trade.</p><button className="primary-button" type="button" onClick={() => onViewChange('markets')}>Open live markets <span>-&gt;</span></button></div>}
      </>}
      {selectedMarket && (
        <DecisionComposer
          key={selectedMarket.marketId}
          market={selectedMarket}
          wallet={wallet}
          trade={trade}
          settlement={settlement}
          challenge={activeChallenge}
        defaultMode={activeChallenge?.status === 'waiting' ? 'friend' : 'solo'}
        onExecute={executeTrade}
          onCheckSettlement={checkSettlement}
          onRedeem={redeem}
          onClose={() => {
            setTrade(initialTradeState)
            setSettlement(initialSettlementState)
            setActiveChallenge(null)
            setSelectedMarket(null)
          }}
        />
      )}
      {reviewRecord && (
        <TradeReview
          record={reviewRecord}
          settlement={reviewSettlement}
          onCheckSettlement={checkReviewSettlement}
          onRedeem={redeemReviewed}
          onClose={() => {
            setReviewSettlement(initialSettlementState)
            setReviewRecord(null)
          }}
        />
      )}
    </section>
  )
}
