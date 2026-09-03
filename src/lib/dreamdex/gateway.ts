import {
  fromHuman,
  ORDER_TYPE,
  SOMNIA_TESTNET_ADDRESSES,
  SomniaMarkets,
  toHuman,
  type PlaceOrderResult,
  type BinaryMarket,
  type BookTop,
} from '@somnia-chain/markets-sdk'
import { somniaShannon } from '@somnia-chain/markets-sdk/chains'
import { erc20Abi, type Address, type Hex, type WalletClient } from 'viem'
import {
  buildProtectedIocQuote,
  calculateBoundedApprovalCap,
  claimableOutcomes,
  filterEligibleMarkets,
  MINIMUM_TRADE_HEADROOM_SECONDS,
  needsTokenApproval,
  type OutcomeIndex,
  type OutcomePosition,
  type DecisionResult,
} from './decision'

// Route browser reads through our same-origin proxy. Direct cross-origin reads
// can be blocked inside preview/deployed browser contexts even when the
// upstream indexer itself is healthy.
const INDEXER_URL = import.meta.env.VITE_INDEXER_URL ?? '/api/dreamdex-indexer'

export type LiveMarket = Pick<
  BinaryMarket,
  | 'marketId'
  | 'question'
  | 'asset'
  | 'status'
  | 'expiry'
  | 'interval'
  | 'venueId'
  | 'lastPrice'
  | 'tradeCount'
  | 'quoteDecimals'
  // Vault-binding fields for the Reactive Agent Lab.
  | 'marketAddress'
  | 'poolAddress'
  | 'collateral'
  | 'baseDecimals'
>

export type LiveMarketWithBook = LiveMarket & { book: BookTop | null }
export type LiveMarketsResult = {
  markets: LiveMarketWithBook[]
  scanned: number
  checked: number
  bookCoverage: number
}

export type IocTradeResult = {
  hash: string
  requestedAmount: number
  filledAmount: number
  averageFillPrice: number | null
  quoteDecimals: number
}

export type SettlementSnapshot = {
  market: Pick<LiveMarket, 'marketId' | 'question' | 'asset' | 'interval' | 'expiry' | 'quoteDecimals'>
  stage: 'Trading' | 'Locked' | 'Resolved' | 'Voided'
  onchainStatus: number
  isResolved: boolean
  isVoided: boolean
  winningOutcome: number | null
  yesBalance: bigint
  noBalance: bigint
  claimable: OutcomePosition[]
}

export type RedemptionResult = {
  hash: string
  outcomeIdx: OutcomeIndex
  amount: bigint
}

export type WalletTradeRecord = {
  id: string
  hash: string
  wallet: string
  marketId: Hex
  asset: string
  interval: string | null
  question: string
  outcome: 'UP' | 'DOWN'
  requestedAmount: number
  filledAmount: number
  averageFillPrice: number | null
  createdAt: number
  confidence?: number
  thesis?: string
  settlement?: {
    stage: SettlementSnapshot['stage']
    isResolved: boolean
    isVoided: boolean
    winningOutcome: number | null
    checkedAt: number
  }
  decisionResult?: DecisionResult
  decisionScore?: number | null
  marketRelativeDelta?: number | null
}

function tradeFailure(message: string): Error {
  return new Error(message)
}

function settlementStage({ status, isResolved, isVoided }: { status: number; isResolved: boolean; isVoided: boolean }): SettlementSnapshot['stage'] {
  if (isVoided) return 'Voided'
  if (isResolved) return 'Resolved'
  if (status === 2) return 'Locked'
  return 'Trading'
}

async function readSettlementSnapshot(
  exchange: SomniaMarkets,
  marketId: Hex,
  address: Address,
): Promise<SettlementSnapshot> {
  const market = await exchange.client.getBinaryMarket(marketId)
  if (!market) throw tradeFailure('This market could not be found.')

  const onchain = await exchange.client.getMarketOnchain(marketId)
  const [yesBalance, noBalance] = await Promise.all([
    exchange.client.getOutcomeBalance({
      outcomeToken: onchain.outcomeToken,
      account: address,
      id: onchain.yesId,
    }),
    exchange.client.getOutcomeBalance({
      outcomeToken: onchain.outcomeToken,
      account: address,
      id: onchain.noId,
    }),
  ])

  return {
    market: {
      marketId: market.marketId,
      question: market.question,
      asset: market.asset,
      interval: market.interval,
      expiry: market.expiry,
      quoteDecimals: market.quoteDecimals,
    },
    stage: settlementStage(onchain),
    onchainStatus: onchain.status,
    isResolved: onchain.isResolved,
    isVoided: onchain.isVoided,
    winningOutcome: onchain.winningOutcome,
    yesBalance,
    noBalance,
    claimable: claimableOutcomes({
      isResolved: onchain.isResolved,
      isVoided: onchain.isVoided,
      winningOutcome: onchain.winningOutcome,
      yesBalance,
      noBalance,
    }),
  }
}

export async function loadSettlement({
  marketId,
  address,
}: {
  marketId: Hex
  address: Address
}): Promise<SettlementSnapshot> {
  const exchange = new SomniaMarkets({
    chain: somniaShannon,
    indexerUrl: INDEXER_URL,
    addresses: SOMNIA_TESTNET_ADDRESSES,
    account: address,
  })

  try {
    return await readSettlementSnapshot(exchange, marketId, address)
  } finally {
    await exchange.close()
  }
}

export async function listWalletTradeHistory(address: Address): Promise<WalletTradeRecord[]> {
  const exchange = new SomniaMarkets({
    chain: somniaShannon,
    indexerUrl: INDEXER_URL,
    addresses: SOMNIA_TESTNET_ADDRESSES,
    account: address,
  })

  try {
    const [portfolio, markets] = await Promise.all([
      exchange.client.getPortfolio(address, { tradesLimit: 200 }),
      exchange.client.listBinaryMarkets({ limit: 200 }),
    ])
    const marketByAddress = new Map(markets.map((market) => [market.marketAddress.toLowerCase(), market]))
    return portfolio.trades.flatMap((trade) => {
      if (!trade.side) return []
      const market = marketByAddress.get(trade.market.marketAddress.toLowerCase())
      if (!market) return []
      const isDown = trade.side === 'BUY_NO' || trade.side === 'SELL_NO'
      const yesPrice = toHuman(BigInt(trade.fillPrice), market.quoteDecimals)
      const outcomePrice = isDown ? 1 - yesPrice : yesPrice
      const filledAmount = toHuman(BigInt(trade.quantity), market.baseDecimals)
      return [{
        id: trade.id,
        hash: trade.txHash,
        wallet: address.toLowerCase(),
        marketId: market.marketId,
        asset: market.asset,
        interval: market.interval ?? null,
        question: market.question,
        outcome: isDown ? 'DOWN' : 'UP',
        requestedAmount: filledAmount,
        filledAmount,
        averageFillPrice: outcomePrice,
        createdAt: Number(trade.timestamp) * 1000,
      }]
    })
  } finally {
    await exchange.close()
  }
}

export async function listWalletSettlementHistory({
  address,
  marketIds,
}: {
  address: Address
  marketIds: Hex[]
}): Promise<SettlementSnapshot[]> {
  const uniqueMarketIds = [...new Set(marketIds.map((marketId) => marketId.toLowerCase()))] as Hex[]
  if (uniqueMarketIds.length === 0) return []

  const exchange = new SomniaMarkets({
    chain: somniaShannon,
    indexerUrl: INDEXER_URL,
    addresses: SOMNIA_TESTNET_ADDRESSES,
    account: address,
  })

  try {
    const snapshots = await Promise.all(uniqueMarketIds.map(async (marketId) => {
      try {
        return await readSettlementSnapshot(exchange, marketId, address)
      } catch {
        return null
      }
    }))
    return snapshots.filter((snapshot): snapshot is SettlementSnapshot => snapshot !== null)
  } finally {
    await exchange.close()
  }
}

export async function listFinalizedSettlements({
  venueId,
  address,
}: {
  venueId: string
  address: Address
}): Promise<SettlementSnapshot[]> {
  const exchange = new SomniaMarkets({
    chain: somniaShannon,
    indexerUrl: INDEXER_URL,
    addresses: SOMNIA_TESTNET_ADDRESSES,
    account: address,
  })

  try {
    const settled = await exchange.client.listBinaryMarkets({ venueId, status: 'Finalized', limit: 120 })
    return (await Promise.all(settled.map(async (market) => (
      readSettlementSnapshot(exchange, market.marketId as Hex, address)
    )))).filter((snapshot) => snapshot.isResolved || snapshot.isVoided)
  } finally {
    await exchange.close()
  }
}

export async function redeemSettlement({
  marketId,
  address,
  walletClient,
  outcomeIdx,
}: {
  marketId: Hex
  address: Address
  walletClient: WalletClient
  outcomeIdx: OutcomeIndex
}): Promise<RedemptionResult> {
  const exchange = new SomniaMarkets({
    chain: somniaShannon,
    indexerUrl: INDEXER_URL,
    addresses: SOMNIA_TESTNET_ADDRESSES,
    account: address,
    walletClient,
  })

  try {
    const market = await exchange.client.getBinaryMarket(marketId)
    if (!market) throw tradeFailure('This market could not be found.')
    const onchain = await exchange.client.getMarketOnchain(marketId)
    const [yesBalance, noBalance] = await Promise.all([
      exchange.client.getOutcomeBalance({ outcomeToken: onchain.outcomeToken, account: address, id: onchain.yesId }),
      exchange.client.getOutcomeBalance({ outcomeToken: onchain.outcomeToken, account: address, id: onchain.noId }),
    ])
    const candidate = claimableOutcomes({
      isResolved: onchain.isResolved,
      isVoided: onchain.isVoided,
      winningOutcome: onchain.winningOutcome,
      yesBalance,
      noBalance,
    }).find((position) => position.outcomeIdx === outcomeIdx)
    if (!candidate) throw tradeFailure('That outcome is not claimable for this wallet.')

    const result = await exchange.trader.redeem({
      marketId,
      market: onchain.marketAddress,
      outcomeToken: onchain.outcomeToken,
      outcomeIdx,
      amount: candidate.balance,
    })
    if (result.receipt?.status === 'reverted') throw tradeFailure('Redemption reverted on-chain.')
    return { hash: result.hash, outcomeIdx, amount: candidate.balance }
  } finally {
    await exchange.close()
  }
}

function averageFillPrice(result: PlaceOrderResult, quoteDecimals: number): number | null {
  const filled = result.fills.reduce((total, fill) => total + fill.quantityFilled, 0n)
  if (filled === 0n) return null
  const weightedPrice = result.fills.reduce(
    (total, fill) => total + fill.fillPrice * fill.quantityFilled,
    0n,
  )
  return toHuman(weightedPrice / filled, quoteDecimals)
}

async function approveExactCollateral({
  token,
  owner,
  spender,
  amount,
  walletClient,
  publicClient,
}: {
  token: Address
  owner: Address
  spender: Address
  amount: bigint
  walletClient: WalletClient
  publicClient: ReturnType<SomniaMarkets['client']['getViemClient']>
}) {
  const allowance = await publicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [owner, spender],
  })
  if (!needsTokenApproval(allowance, amount)) return

  const approve = async (value: bigint) => {
    const hash = await walletClient.writeContract({
      address: token,
      abi: erc20Abi,
      functionName: 'approve',
      args: [spender, value],
      account: owner,
      chain: somniaShannon,
    })
    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    if (receipt.status !== 'success') throw tradeFailure('Token approval was not confirmed.')
  }

  try {
    await approve(amount)
  } catch (cause) {
    if (allowance === 0n) throw cause
    await approve(0n)
    await approve(amount)
  }
}

export async function executeIocOrder({
  marketId,
  outcome,
  amount,
  address,
  walletClient,
}: {
  marketId: Hex
  outcome: 'UP' | 'DOWN'
  amount: number
  address: Address
  walletClient: WalletClient
}): Promise<IocTradeResult> {
  const exchange = new SomniaMarkets({
    chain: somniaShannon,
    indexerUrl: INDEXER_URL,
    addresses: SOMNIA_TESTNET_ADDRESSES,
    account: address,
    walletClient,
  })

  try {
    const market = await exchange.client.getBinaryMarket(marketId)
    if (!market) throw tradeFailure('This market is no longer available.')

    const quantity = fromHuman(amount, market.baseDecimals)
    const side = outcome === 'UP' ? 'BUY_YES' : 'BUY_NO'
    const loadProtectedQuote = async () => {
      const [onchain, book, bookParams] = await Promise.all([
        exchange.client.getMarketOnchain(marketId),
        exchange.client.getBinaryOrderBook(market.poolAddress, {
          depth: 10,
          decimals: market.quoteDecimals,
        }),
        exchange.client.getBinaryBookParams(market.poolAddress),
      ])
      const nowSec = BigInt(Math.floor(Date.now() / 1000))
      if (onchain.status !== 1 || onchain.finalized || onchain.isResolved || onchain.isVoided) {
        throw tradeFailure('This market is no longer trading.')
      }
      if (onchain.expiry - nowSec < BigInt(MINIMUM_TRADE_HEADROOM_SECONDS)) {
        throw tradeFailure(`This market closes in under ${MINIMUM_TRADE_HEADROOM_SECONDS} seconds. Choose the next market to avoid an expiry race.`)
      }
      if (onchain.pool.toLowerCase() !== market.poolAddress.toLowerCase()) {
        throw tradeFailure('This market binding changed. Refresh and choose it again.')
      }

      const topLevel = side === 'BUY_YES' ? book.yesAsks[0] : book.noAsks[0]
      if (!topLevel) {
        throw tradeFailure(`No live ${outcome === 'UP' ? 'YES ask' : 'NO ask'} liquidity is available.`)
      }
      const quote = buildProtectedIocQuote(book, side, quantity, market.quoteDecimals, bookParams)
      if (!quote) {
        throw tradeFailure(`Not enough protected ${outcome === 'UP' ? 'YES' : 'NO'} liquidity for ${amount} contracts; lower the amount or choose another market.`)
      }
      return quote
    }

    const initialQuote = await loadProtectedQuote()
    const [nativeBalance, collateralBalance] = await Promise.all([
      exchange.client.getNativeBalance(address),
      exchange.client.getErc20Balance(market.collateral, address),
    ])
    if (nativeBalance === 0n) throw tradeFailure('Your wallet needs STT for gas before trading.')
    if (collateralBalance < initialQuote.collateral) {
      const required = toHuman(initialQuote.collateral, market.quoteDecimals).toFixed(2)
      const available = toHuman(collateralBalance, market.quoteDecimals).toFixed(2)
      throw tradeFailure(`Insufficient tUSDC: need about ${required}, wallet has ${available}.`)
    }

    const approvalCap = calculateBoundedApprovalCap(amount, collateralBalance, market.quoteDecimals)
    const publicClient = exchange.client.getViemClient()
    await approveExactCollateral({
      token: market.collateral,
      owner: address,
      spender: market.poolAddress,
      amount: approvalCap,
      walletClient,
      publicClient,
    })

    const [quote, latestNativeBalance, latestCollateralBalance] = await Promise.all([
      loadProtectedQuote(),
      exchange.client.getNativeBalance(address),
      exchange.client.getErc20Balance(market.collateral, address),
    ])
    if (latestNativeBalance === 0n) throw tradeFailure('Your wallet needs STT for gas before trading.')
    if (latestCollateralBalance < quote.collateral) {
      const required = toHuman(quote.collateral, market.quoteDecimals).toFixed(2)
      const available = toHuman(latestCollateralBalance, market.quoteDecimals).toFixed(2)
      throw tradeFailure(`Insufficient tUSDC after approval: need about ${required}, wallet has ${available}.`)
    }
    if (quote.collateral > approvalCap) {
      throw tradeFailure('The refreshed price exceeds your bounded approval cap; choose the market again to set a new limit.')
    }

    const result = await exchange.trader.placeOrder({
      pool: market.poolAddress,
      side,
      price: quote.yesPrice,
      quantity,
      orderType: ORDER_TYPE.MARKET,
      autoApprove: false,
    })
    return {
      hash: result.hash,
      requestedAmount: amount,
      filledAmount: toHuman(result.fills.reduce((total, fill) => total + fill.quantityFilled, 0n), market.baseDecimals),
      averageFillPrice: averageFillPrice(result, market.quoteDecimals),
      quoteDecimals: market.quoteDecimals,
    }
  } finally {
    await exchange.close()
  }
}

function selectCandidates(markets: BinaryMarket[]): BinaryMarket[] {
  const supportedAssets = markets.filter((market) => market.asset === 'BTC' || market.asset === 'ETH')
  const preferredWindows = supportedAssets.filter((market) => market.interval === '15m' || market.interval === '1h')
  return (preferredWindows.length > 0 ? preferredWindows : supportedAssets).slice(0, 8)
}

/// Retry transient indexer failures ("Failed to fetch", 5xx) with backoff.
/// Network blips should degrade to a slower load, not a hard lobby error.
async function withIndexerRetry<T>(operation: (attempt: number) => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt)
    } catch (error) {
      lastError = error
      const message = error instanceof Error ? error.message : String(error)
      const transient = /failed to fetch|networkerror|timeout|temporarily|502|503|504/i.test(message)
      if (!transient || attempt === attempts) break
      await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** (attempt - 1)))
    }
  }
  throw lastError
}

export async function listLiveMarkets(): Promise<LiveMarketsResult> {
  const exchange = new SomniaMarkets({
    chain: somniaShannon,
    indexerUrl: INDEXER_URL,
    addresses: SOMNIA_TESTNET_ADDRESSES,
  })

  try {
    const liveMarkets = await withIndexerRetry(() => exchange.client.listLiveBinaryMarkets({ limit: 50 }))
    const candidates = selectCandidates(liveMarkets)
    const books = await exchange.client.getBookTops(candidates.map((market) => market.marketId))
    const checked = await Promise.all(candidates.map(async (market) => {
      const onchain = await exchange.client.getMarketOnchain(market.marketId)
      return {
        ...market,
        book: (books[market.marketId.toLowerCase()] ?? null) as BookTop | null,
        onchainStatus: onchain.status,
        finalized: onchain.finalized,
        isResolved: onchain.isResolved,
        isVoided: onchain.isVoided,
      }
    }))
    const eligible = filterEligibleMarkets(checked, Math.floor(Date.now() / 1000))
    const markets = eligible.map(({ onchainStatus: _onchainStatus, finalized: _finalized, isResolved: _isResolved, isVoided: _isVoided, ...market }) => market)
    return {
      markets: markets as LiveMarketWithBook[],
      scanned: liveMarkets.length,
      checked: candidates.length,
      bookCoverage: markets.filter((market) => market.book?.bestBid && market.book.bestAsk).length,
    }
  } finally {
    await exchange.close()
  }
}
