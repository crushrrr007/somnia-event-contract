import { useEffect, useMemo, useState } from 'react'
import { createPublicClient, http, type Address } from 'viem'
import { somniaShannon } from '@somnia-chain/markets-sdk/chains'
import {
  AGENT_REQUESTER_TESTNET,
  LLM_AGENT_ID,
  LLM_EXECUTION_COST_PER_AGENT,
  SUBSCRIPTION_RESERVE_WEI,
  brierScore,
  computeEdgeDecision,
  createAgentVault,
  isAgentFactoryConfigured,
  listAgentReceipts,
  listAgentVaults,
  redeemAgentVault,
  stopAgentVault,
  validatePolicy,
  type AgentPolicyInput,
  type AgentReceipt,
  type AgentVaultSummary,
} from '../../lib/dreamdex/agent'
import { loadSettlement, type LiveMarketWithBook } from '../../lib/dreamdex/gateway'
import type { TradeRecord, WalletState } from '../lobby/lobby-model'

const publicClient = createPublicClient({ chain: somniaShannon, transport: http() })

const GAS_BUFFER_WEI = 50000000000000000n // 0.05 STT

function formatStt(wei: bigint) {
  return (Number(wei) / 1e18).toFixed(2)
}

function formatUsdc(amount: number) {
  return amount.toFixed(2)
}

function shortHex(value: string) {
  return `…${value.slice(-6)}`
}

type ComposerState = {
  marketKey: string
  thesis: string
  direction: 'both' | 'yes' | 'no'
  minFill: number
  minEdgeBps: number
  maxContracts: number
  slippageBps: number
  cooldownSeconds: number
  maxDecisions: number
  shadowMode: boolean
  collateral: number
}

const initialComposer: ComposerState = {
  marketKey: '',
  thesis: '',
  direction: 'both',
  minFill: 0,
  minEdgeBps: 300,
  maxContracts: 5,
  slippageBps: 200,
  cooldownSeconds: 60,
  maxDecisions: 3,
  shadowMode: true,
  collateral: 50,
}

function eligibleAgentMarkets(markets: LiveMarketWithBook[]): LiveMarketWithBook[] {
  return markets.filter((market) => {
    const interval = market.interval ?? ''
    return (interval === '1h' || interval === '4h') && market.book?.bestBid != null && market.book?.bestAsk != null
  })
}

function VaultCard({
  vault,
  receipts,
  onStop,
  onRedeem,
  busy,
}: {
  vault: AgentVaultSummary
  receipts: AgentReceipt[]
  onStop: () => void
  onRedeem: () => void
  busy: boolean
}) {
  const status = !vault.armed && vault.pendingRequestId === 0n
    ? vault.executed ? 'executed' : 'stopped'
    : vault.pendingRequestId !== 0n ? 'awaiting agent' : 'armed'
  return (
    <article className={`agent-vault-card agent-vault-${status.replace(' ', '-')}`}>
      <div className="agent-vault-topline">
        <span className="agent-vault-status"><span className="status-dot" /> {status}</span>
        <span>{vault.shadowMode ? 'shadow mode' : 'live mode'} · {vault.decisionsPaid}/{vault.maxDecisions} decisions</span>
      </div>
      <strong>{vault.question}</strong>
      <p className="agent-vault-thesis">Policy thesis: {vault.thesis}</p>
      <small className="agent-vault-meta">
        vault {shortHex(vault.address)} · min edge {(Number(vault.minEdgeBps) / 100).toFixed(1)}%
        {vault.subscriptionId !== 0n && <> · subscription {vault.subscriptionId.toString()}</>}
      </small>
      {receipts.length > 0 && (
        <ul className="agent-receipt-list">
          {receipts.slice(0, 5).map((receipt) => (
            <li key={`${receipt.txHash}-${receipt.requestId.toString()}`}>
              <span className={`agent-receipt-badge ${receipt.executed ? 'executed' : receipt.wouldExecute ? 'shadow' : 'skipped'}`}>
                {receipt.executed ? 'executed' : receipt.wouldExecute ? 'shadow pass' : 'skipped'}
              </span>
              <span className="agent-receipt-detail">
                p={receipt.probability} · {receipt.reason}
                {receipt.executed && <> · order {receipt.orderId.toString()}</>}
              </span>
              <a href={`${somniaShannon.blockExplorers.default.url}/tx/${receipt.txHash}`} target="_blank" rel="noreferrer">tx ↗</a>
            </li>
          ))}
        </ul>
      )}
      <div className="agent-vault-actions">
        {vault.armed && <button type="button" className="secondary-button" onClick={onStop} disabled={busy}>Stop agent</button>}
        {!vault.armed && <button type="button" className="secondary-button" onClick={onRedeem} disabled={busy}>Redeem outcomes</button>}
      </div>
    </article>
  )
}

function CalibrationPanel({
  vaultReceipts,
  history,
  markets,
  walletAddress,
}: {
  vaultReceipts: Array<{ vault: AgentVaultSummary; receipts: AgentReceipt[] }>
  history: TradeRecord[]
  markets: LiveMarketWithBook[]
  walletAddress: Address | null
}) {
  const [outcomes, setOutcomes] = useState<Map<string, { won: boolean | null; resolved: boolean }>>(new Map())

  const marketByAddress = useMemo(() => {
    const map = new Map<string, LiveMarketWithBook>()
    for (const market of markets) map.set(marketAddressOf(market).toLowerCase(), market)
    return map
  }, [markets])

  const scoredCandidates = useMemo(
    () =>
      vaultReceipts.flatMap(({ vault, receipts }) =>
        receipts
          .filter((receipt) => receipt.probability > 0)
          .map((receipt) => {
            const market = marketByAddress.get(vault.market.toLowerCase())
            return market ? { receipt, marketId: market.marketId } : null
          }),
      ).filter((entry): entry is { receipt: AgentReceipt; marketId: `0x${string}` } => entry !== null),
    [vaultReceipts, marketByAddress],
  )

  useEffect(() => {
    let active = true
    const known = new Set(outcomes.keys())
    const missing = scoredCandidates.filter((entry) => !known.has(entry.receipt.txHash))
    if (missing.length === 0) return
    void (async () => {
      const next = new Map(outcomes)
      for (const entry of missing.slice(0, 4)) {
        try {
          const snapshot = await loadSettlement({
            marketId: entry.marketId,
            address: walletAddress ?? '0x0000000000000000000000000000000000000000',
          })
          if (!active) return
          next.set(entry.receipt.txHash, {
            won: snapshot.isVoided ? null : snapshot.winningOutcome === 0,
            resolved: snapshot.isResolved || snapshot.isVoided,
          })
        } catch {
          if (!active) return
          next.set(entry.receipt.txHash, { won: null, resolved: false })
        }
      }
      if (active) setOutcomes(next)
    })()
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoredCandidates])

  const scored: Array<{ receipt: AgentReceipt; won: boolean }> = scoredCandidates
    .filter((entry) => outcomes.get(entry.receipt.txHash)?.resolved)
    .map((entry) => {
      const outcome = outcomes.get(entry.receipt.txHash)
      return { receipt: entry.receipt, won: outcome?.won }
    })
    .filter((entry): entry is { receipt: AgentReceipt; won: boolean } => entry.won !== null)

  const agentBrier = scored.length === 0
    ? null
    : scored.reduce((total, entry) => total + brierScore(entry.receipt.probability, entry.won), 0) / scored.length

  const humanScores = history
    .filter((record) => record.decisionScore != null && (record.decisionResult === 'WIN' || record.decisionResult === 'LOSS'))
    .map((record) => record.decisionScore as number)
  const humanBrier = humanScores.length === 0 ? null : humanScores.reduce((total, score) => total + score, 0) / humanScores.length

  return (
    <section className="agent-calibration" aria-labelledby="agent-calibration-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Calibration benchmark</p>
          <h2 id="agent-calibration-title">Judgment,<br /><em>not just positions.</em></h2>
        </div>
        <p className="section-note">
          Skipped predictions are scored too. A lower Brier loss means better calibrated probability calls,
          whether the policy executed or passed.
        </p>
      </div>
      <div className="agent-calibration-grid">
        <div className="agent-calibration-card">
          <span>Agent Brier loss</span>
          <strong>{agentBrier === null ? '—' : agentBrier.toFixed(3)}</strong>
          <small>{scored.length} settled prediction{scored.length === 1 ? '' : 's'} (incl. skips)</small>
        </div>
        <div className="agent-calibration-card">
          <span>Your Brier loss</span>
          <strong>{humanBrier === null ? '—' : humanBrier.toFixed(3)}</strong>
          <small>{humanScores.length} scored manual call{humanScores.length === 1 ? '' : 's'}</small>
        </div>
      </div>
      {scored.length === 0 && (
        <p className="agent-calibration-empty">
          Agent predictions appear here after a vault's market settles. Rejected signals count — that is the point.
        </p>
      )}
    </section>
  )
}

function marketAddressOf(market: LiveMarketWithBook): string {
  return (market as unknown as { marketAddress?: string }).marketAddress ?? ''
}

export function AgentLab({
  wallet,
  markets,
  history,
  onViewChange,
}: {
  wallet: WalletState
  markets: LiveMarketWithBook[]
  history: TradeRecord[]
  onViewChange: (view: 'markets') => void
}) {
  const [composer, setComposer] = useState<ComposerState>(initialComposer)
  const [vaults, setVaults] = useState<AgentVaultSummary[]>([])
  const [receipts, setReceipts] = useState<Map<string, AgentReceipt[]>>(new Map())
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const eligible = useMemo(() => eligibleAgentMarkets(markets), [markets])
  const selectedMarket = eligible.find((market) => market.marketId === composer.marketKey) ?? null

  const nativeBudget = useMemo(
    () => SUBSCRIPTION_RESERVE_WEI + LLM_EXECUTION_COST_PER_AGENT * BigInt(composer.maxDecisions) + GAS_BUFFER_WEI,
    [composer.maxDecisions],
  )

  const policy: AgentPolicyInput | null = selectedMarket
    ? {
        marketId: selectedMarket.marketId,
        marketAddress: (selectedMarket as unknown as { marketAddress: Address }).marketAddress,
        poolAddress: (selectedMarket as unknown as { poolAddress: Address }).poolAddress,
        collateral: (selectedMarket as unknown as { collateral: Address }).collateral,
        question: selectedMarket.question,
        thesis: composer.thesis,
        direction: composer.direction,
        minFill: composer.minFill,
        minEdgeBps: composer.minEdgeBps,
        maxContracts: composer.maxContracts,
        slippageBps: composer.slippageBps,
        cooldownSeconds: composer.cooldownSeconds,
        maxDecisions: composer.maxDecisions,
        shadowMode: composer.shadowMode,
        baseDecimals: (selectedMarket as unknown as { baseDecimals: number }).baseDecimals,
      }
    : null

  const validation = policy ? validatePolicy(policy) : { ok: false as const, errors: ['Select a live market to arm.'] }

  async function refreshVaults() {
    if (!wallet.address) return
    try {
      const summaries = await listAgentVaults({ publicClient, owner: wallet.address })
      setVaults(summaries)
      const nextReceipts = new Map<string, AgentReceipt[]>()
      for (const vault of summaries) {
        try {
          nextReceipts.set(vault.address, await listAgentReceipts({ publicClient, vault: vault.address }))
        } catch {
          nextReceipts.set(vault.address, [])
        }
      }
      setReceipts(nextReceipts)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Vaults could not be loaded.')
    }
  }

  useEffect(() => {
    if (!wallet.address || !isAgentFactoryConfigured()) return
    void refreshVaults()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet.address])

  async function handleCreate() {
    if (!policy || !wallet.client || !validation.ok) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const collateralAmount = BigInt(Math.round(composer.collateral * 10 ** 6)) // tUSDC 6 decimals
      const result = await createAgentVault({
        walletClient: wallet.client,
        publicClient,
        policy,
        collateralAmount,
        nativeBudget,
      })
      setMessage(
        result.vault
          ? `Vault armed at ${shortHex(result.vault)}. It now watches the pool for qualifying fills.`
          : 'Vault created. It now watches the pool for qualifying fills.',
      )
      await refreshVaults()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Vault creation failed.')
    } finally {
      setBusy(false)
    }
  }

  async function handleStop(vault: Address) {
    if (!wallet.client) return
    setBusy(true)
    try {
      await stopAgentVault({ walletClient: wallet.client, vault })
      await refreshVaults()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Stop failed.')
    } finally {
      setBusy(false)
    }
  }

  async function handleRedeem(vault: Address) {
    if (!wallet.client) return
    setBusy(true)
    try {
      await redeemAgentVault({ walletClient: wallet.client, vault })
      await refreshVaults()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Redemption failed.')
    } finally {
      setBusy(false)
    }
  }

  const previewDecision = selectedMarket && selectedMarket.book?.bestAsk != null
    ? computeEdgeDecision({
        probability: 62,
        fillPriceRaw: BigInt(Math.round(Number(selectedMarket.book.bestAsk) * 10 ** selectedMarket.quoteDecimals)),
        oneCollateral: 10n ** BigInt(selectedMarket.quoteDecimals),
        minEdgeBps: composer.minEdgeBps,
        slippageBps: composer.slippageBps,
        allowedDirection: composer.direction,
      })
    : null

  return (
    <section className="agent-lab" aria-labelledby="agent-lab-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">02 / Reactive Agent Lab</p>
          <h2 id="agent-lab-title">Arm a policy.<br /><em>Let the chain act.</em></h2>
        </div>
        <p className="section-note">
          A vault watches your chosen market's pool for real fills. A qualifying fill asks Somnia's deterministic
          on-chain LLM for a fair-YES probability; the vault trades only if the edge clears your minimum.
          Every prediction — including skips — becomes a receipt. Unaudited hackathon software; shadow mode is default.
        </p>
      </div>

      {!isAgentFactoryConfigured() && (
        <div className="lobby-state lobby-error">
          The agent factory is not deployed for this build yet. Deploy it with{' '}
          <code>npm run deploy:agent-factory</code> and set <code>VITE_AGENT_FACTORY_ADDRESS</code>.
        </div>
      )}

      {isAgentFactoryConfigured() && !wallet.address && (
        <div className="lobby-state">
          <p className="eyebrow">Wallet-scoped policies</p>
          <h3>Connect a wallet to arm an agent.</h3>
          <p>Your vaults, receipts, and budgets are reconstructed from your own address.</p>
          <button className="primary-button" type="button" onClick={() => onViewChange('markets')}>
            Open live markets <span>-&gt;</span>
          </button>
        </div>
      )}

      {isAgentFactoryConfigured() && wallet.address && (
        <>
          {eligible.length === 0 ? (
            <div className="lobby-state">
              <p className="eyebrow">Eligible markets</p>
              <h3>No liquid 1h/4h markets are live right now.</h3>
              <p>Arming is restricted to longer windows with two-sided book liquidity so agent responses have headroom.</p>
              <button className="secondary-button" type="button" onClick={() => onViewChange('markets')}>Check live markets</button>
            </div>
          ) : (
            <div className="agent-composer">
              <div className="agent-composer-form">
                <label className="agent-field">
                  <span>Market</span>
                  <select
                    value={composer.marketKey}
                    onChange={(event) => setComposer((current) => ({ ...current, marketKey: event.target.value }))}
                  >
                    <option value="">Select a live market…</option>
                    {eligible.map((market) => (
                      <option key={market.marketId} value={market.marketId}>
                        {market.asset} · {market.interval} · {market.question}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="agent-field">
                  <span>Policy thesis ({composer.thesis.length}/280)</span>
                  <textarea
                    value={composer.thesis}
                    maxLength={280}
                    rows={3}
                    placeholder="e.g. Order-flow imbalance after a large taker print tends to mean-revert within the hour."
                    onChange={(event) => setComposer((current) => ({ ...current, thesis: event.target.value }))}
                  />
                </label>
                <div className="agent-field-row">
                  <label className="agent-field">
                    <span>Allowed direction</span>
                    <select
                      value={composer.direction}
                      onChange={(event) => setComposer((current) => ({ ...current, direction: event.target.value as ComposerState['direction'] }))}
                    >
                      <option value="both">Both sides</option>
                      <option value="yes">YES only</option>
                      <option value="no">NO only</option>
                    </select>
                  </label>
                  <label className="agent-field">
                    <span>Mode</span>
                    <select
                      value={composer.shadowMode ? 'shadow' : 'live'}
                      onChange={(event) => setComposer((current) => ({ ...current, shadowMode: event.target.value === 'shadow' }))}
                    >
                      <option value="shadow">Shadow (no orders)</option>
                      <option value="live">Live (bounded IOC)</option>
                    </select>
                  </label>
                </div>
                <div className="agent-field-row">
                  <label className="agent-field">
                    <span>Min edge %</span>
                    <input
                      type="number"
                      min={1}
                      step={0.5}
                      value={composer.minEdgeBps / 100}
                      onChange={(event) => setComposer((current) => ({ ...current, minEdgeBps: Math.round(Number(event.target.value) * 100) }))}
                    />
                  </label>
                  <label className="agent-field">
                    <span>Slippage %</span>
                    <input
                      type="number"
                      min={0.1}
                      step={0.1}
                      value={composer.slippageBps / 100}
                      onChange={(event) => setComposer((current) => ({ ...current, slippageBps: Math.round(Number(event.target.value) * 100) }))}
                    />
                  </label>
                </div>
                <div className="agent-field-row">
                  <label className="agent-field">
                    <span>Max contracts</span>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={composer.maxContracts}
                      onChange={(event) => setComposer((current) => ({ ...current, maxContracts: Number(event.target.value) }))}
                    />
                  </label>
                  <label className="agent-field">
                    <span>Decision cap</span>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      step={1}
                      value={composer.maxDecisions}
                      onChange={(event) => setComposer((current) => ({ ...current, maxDecisions: Math.min(10, Math.max(1, Math.round(Number(event.target.value)))) }))}
                    />
                  </label>
                </div>
                <div className="agent-field-row">
                  <label className="agent-field">
                    <span>Cooldown (s)</span>
                    <input
                      type="number"
                      min={30}
                      step={30}
                      value={composer.cooldownSeconds}
                      onChange={(event) => setComposer((current) => ({ ...current, cooldownSeconds: Number(event.target.value) }))}
                    />
                  </label>
                  <label className="agent-field">
                    <span>Collateral (tUSDC)</span>
                    <input
                      type="number"
                      min={0}
                      step={10}
                      value={composer.collateral}
                      onChange={(event) => setComposer((current) => ({ ...current, collateral: Number(event.target.value) }))}
                    />
                  </label>
                </div>
              </div>

              <aside className="agent-composer-summary">
                <div className="card-label">Before you sign</div>
                <ol className="agent-cost-list">
                  <li>
                    <span>Collateral approval</span>
                    <strong>{formatUsdc(composer.collateral)} tUSDC (exact)</strong>
                  </li>
                  <li>
                    <span>Vault creation + arm</span>
                    <strong>{formatStt(nativeBudget)} STT sent</strong>
                  </li>
                  <li>
                    <span>Reactivity reserve</span>
                    <strong>32.00 STT (held, not spent)</strong>
                  </li>
                  <li>
                    <span>Per-decision LLM budget</span>
                    <strong>{formatStt(LLM_EXECUTION_COST_PER_AGENT * 3n)} STT × {composer.maxDecisions}</strong>
                  </li>
                </ol>
                {previewDecision && (
                  <div className="agent-edge-preview">
                    <span>Edge preview at p=62 vs current ask</span>
                    <strong>
                      {previewDecision.action === 'execute'
                        ? `would buy ${previewDecision.label}`
                        : `skip: ${previewDecision.reason}`}
                    </strong>
                  </div>
                )}
                {!validation.ok && (
                  <ul className="agent-validation-errors">
                    {validation.errors.map((issue) => <li key={issue}>{issue}</li>)}
                  </ul>
                )}
                <button
                  className="primary-button"
                  type="button"
                  disabled={busy || !validation.ok}
                  onClick={handleCreate}
                >
                  {composer.shadowMode ? 'Arm shadow agent' : 'Arm live agent'} <span>-&gt;</span>
                </button>
                <small className="agent-unaudited-note">
                  Unaudited hackathon contract. The vault can only place bounded IOC orders inside the policy you set.
                </small>
              </aside>
            </div>
          )}

          {message && <div className="trade-result agent-message"><span>Vault armed</span><strong>{message}</strong></div>}
          {error && <div className="lobby-state lobby-error">{error}</div>}

          {vaults.length > 0 && (
            <div className="agent-vault-grid">
              {vaults.map((vault) => (
                <VaultCard
                  key={vault.address}
                  vault={vault}
                  receipts={receipts.get(vault.address) ?? []}
                  onStop={() => void handleStop(vault.address)}
                  onRedeem={() => void handleRedeem(vault.address)}
                  busy={busy}
                />
              ))}
            </div>
          )}

          <CalibrationPanel
            vaultReceipts={vaults.map((vault) => ({ vault, receipts: receipts.get(vault.address) ?? [] }))}
            history={history}
            markets={markets}
            walletAddress={wallet.address}
          />

          <p className="agent-platform-note">
            Decisions run through Somnia Agents ({shortHex(AGENT_REQUESTER_TESTNET)}, agent {LLM_AGENT_ID.toString()})
            with 3-runner majority consensus, and Somnia reactivity delivers pool fills same-block.
          </p>
        </>
      )}
    </section>
  )
}
