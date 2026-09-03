import { erc20Abi, parseAbi, type Address, type Hex, type WalletClient, type PublicClient } from 'viem'
import { somniaShannon } from '@somnia-chain/markets-sdk/chains'

// Official Somnia Agents platform on Shannon testnet (chain 50312).
export const AGENT_REQUESTER_TESTNET: Address = '0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776'
// Somnia LLM Inference base agent (Qwen3-30B), deterministic across runners.
export const LLM_AGENT_ID = 12847293847561029384n
// Documented LLM runner execution headroom (0.07 SOMI per runner, 3 runners).
export const LLM_EXECUTION_COST_PER_AGENT = 70000000000000000n
// Reactivity subscription reserve requirement (not consumed).
export const SUBSCRIPTION_RESERVE_WEI = 32000000000000000000n

export const AGENT_FACTORY_ADDRESS = (import.meta.env.VITE_AGENT_FACTORY_ADDRESS ?? '') as Address
export function isAgentFactoryConfigured(): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(AGENT_FACTORY_ADDRESS)
}

export const agentFactoryAbi = parseAbi([
  'struct Policy { address market; address pool; string question; string thesis; uint8 allowedDirection; uint256 minFillRaw; uint256 minEdgeBps; uint256 maxContractsRaw; uint256 slippageBps; uint64 cooldownSeconds; uint8 maxDecisions; bool shadowMode; }',
  'function createVault(Policy policy, address collateralToken, uint256 collateralAmount) payable returns (address vault)',
  'function getVaults(address owner) view returns (address[])',
  'function agentRequester() view returns (address)',
])

export const agentVaultAbi = parseAbi([
  'function owner() view returns (address)',
  'function market() view returns (address)',
  'function pool() view returns (address)',
  'function question() view returns (string)',
  'function thesis() view returns (string)',
  'function allowedDirection() view returns (uint8)',
  'function armed() view returns (bool)',
  'function executed() view returns (bool)',
  'function shadowMode() view returns (bool)',
  'function pendingRequestId() view returns (uint256)',
  'function decisionsPaid() view returns (uint8)',
  'function maxDecisions() view returns (uint8)',
  'function subscriptionId() view returns (uint256)',
  'function minEdgeBps() view returns (uint256)',
  'function stop()',
  'function redeem()',
  'function recover()',
  'event Armed(uint256 indexed subscriptionId, uint256 collateralApproved)',
  'event SignalObserved(uint256 indexed requestId, uint256 fillPrice, uint256 quantityFilled)',
  'event DecisionReceipt(uint256 indexed requestId, uint256 probability, uint8 side, bool wouldExecute, bool executed, uint256 orderId, uint256 price, uint256 quantity, string reason)',
])

export type AgentDirection = 'both' | 'yes' | 'no'

export type AgentPolicyInput = {
  marketId: Hex
  marketAddress: Address
  poolAddress: Address
  collateral: Address
  question: string
  thesis: string
  direction: AgentDirection
  minFill: number
  minEdgeBps: number
  maxContracts: number
  slippageBps: number
  cooldownSeconds: number
  maxDecisions: number
  shadowMode: boolean
  baseDecimals: number
}

export type PolicyValidation = { ok: true } | { ok: false; errors: string[] }

export function validatePolicy(policy: AgentPolicyInput): PolicyValidation {
  const errors: string[] = []
  if (!policy.marketAddress || !policy.poolAddress) errors.push('Bind the vault to a live market and pool.')
  if (policy.thesis.trim().length < 12) errors.push('Write a thesis of at least 12 characters.')
  if (policy.thesis.length > 280) errors.push('Thesis must be 280 characters or fewer.')
  if (!Number.isFinite(policy.minEdgeBps) || policy.minEdgeBps < 100) errors.push('Minimum edge must be at least 1.0% (100 bps).')
  if (!Number.isFinite(policy.slippageBps) || policy.slippageBps < 10) errors.push('Slippage tolerance must be at least 0.1% (10 bps).')
  if (!Number.isFinite(policy.maxContracts) || policy.maxContracts <= 0) errors.push('Max contracts must be positive.')
  if (!Number.isFinite(policy.cooldownSeconds) || policy.cooldownSeconds < 30) errors.push('Cooldown must be at least 30 seconds.')
  if (!Number.isInteger(policy.maxDecisions) || policy.maxDecisions < 1 || policy.maxDecisions > 10) errors.push('Decision cap must be between 1 and 10.')
  if (!Number.isFinite(policy.minFill) || policy.minFill < 0) errors.push('Minimum triggering fill must be zero or more.')
  return errors.length ? { ok: false, errors } : { ok: true }
}

export type EdgeDecision =
  | { action: 'execute'; side: 0 | 2; limitPriceRaw: bigint; label: 'YES' | 'NO' }
  | { action: 'skip'; reason: string }

/**
 * Pure mirror of the vault's callback decision logic. Given the agent's
 * 0-100 fair-YES probability and the triggering fill price (raw), decide the
 * bounded IOC action or the precise skip reason.
 */
export function computeEdgeDecision(params: {
  probability: number
  fillPriceRaw: bigint
  oneCollateral: bigint
  minEdgeBps: number
  slippageBps: number
  allowedDirection: AgentDirection
}): EdgeDecision {
  const { probability, fillPriceRaw, oneCollateral, minEdgeBps, slippageBps, allowedDirection } = params
  if (probability < 0 || probability > 100) return { action: 'skip', reason: 'probability out of range' }

  const fairRaw = (BigInt(Math.round(probability)) * oneCollateral) / 100n
  const edgeRaw = (BigInt(Math.round(minEdgeBps)) * oneCollateral) / 10000n
  const slippageRaw = (BigInt(Math.round(slippageBps)) * oneCollateral) / 10000n

  if (fairRaw > fillPriceRaw + edgeRaw) {
    if (allowedDirection === 'no') return { action: 'skip', reason: 'direction not allowed' }
    const maxPay = fillPriceRaw + slippageRaw
    const limitPriceRaw = maxPay < fairRaw ? maxPay : fairRaw - 1n
    return { action: 'execute', side: 0, limitPriceRaw, label: 'YES' }
  }
  if (fairRaw < fillPriceRaw - edgeRaw) {
    if (allowedDirection === 'yes') return { action: 'skip', reason: 'direction not allowed' }
    const minAccept = fillPriceRaw - slippageRaw
    const limitPriceRaw = minAccept > fairRaw + 1n ? minAccept : fairRaw + 1n
    return { action: 'execute', side: 2, limitPriceRaw, label: 'NO' }
  }
  return { action: 'skip', reason: 'insufficient edge' }
}

/** Snap a raw quantity down to the lot grid. */
export function snapQuantity(quantityRaw: bigint, lotSize: bigint): bigint {
  if (lotSize <= 0n) return quantityRaw
  return (quantityRaw / lotSize) * lotSize
}

/**
 * Deterministic Brier score for a 0-100 probability against a settled
 * outcome. Returns 0 (perfect) to 1 (worst).
 */
export function brierScore(probability: number, won: boolean): number {
  const p = Math.min(1, Math.max(0, probability / 100))
  return (p - (won ? 1 : 0)) ** 2
}

export type AgentVaultSummary = {
  address: Address
  market: Address
  pool: Address
  question: string
  thesis: string
  armed: boolean
  executed: boolean
  shadowMode: boolean
  pendingRequestId: bigint
  decisionsPaid: number
  maxDecisions: number
  subscriptionId: bigint
  minEdgeBps: number
}

export async function listAgentVaults(params: {
  publicClient: PublicClient
  owner: Address
}): Promise<AgentVaultSummary[]> {
  if (!isAgentFactoryConfigured()) return []
  const vaultAddresses = await params.publicClient.readContract({
    address: AGENT_FACTORY_ADDRESS,
    abi: agentFactoryAbi,
    functionName: 'getVaults',
    args: [params.owner],
  })
  return Promise.all(
    vaultAddresses.map(async (vault) => {
      const [market, pool, question, thesis, armed, executed, shadowMode, pendingRequestId, decisionsPaid, maxDecisions, subscriptionId, minEdgeBps] =
        await Promise.all([
          params.publicClient.readContract({ address: vault, abi: agentVaultAbi, functionName: 'market' }),
          params.publicClient.readContract({ address: vault, abi: agentVaultAbi, functionName: 'pool' }),
          params.publicClient.readContract({ address: vault, abi: agentVaultAbi, functionName: 'question' }),
          params.publicClient.readContract({ address: vault, abi: agentVaultAbi, functionName: 'thesis' }),
          params.publicClient.readContract({ address: vault, abi: agentVaultAbi, functionName: 'armed' }),
          params.publicClient.readContract({ address: vault, abi: agentVaultAbi, functionName: 'executed' }),
          params.publicClient.readContract({ address: vault, abi: agentVaultAbi, functionName: 'shadowMode' }),
          params.publicClient.readContract({ address: vault, abi: agentVaultAbi, functionName: 'pendingRequestId' }),
          params.publicClient.readContract({ address: vault, abi: agentVaultAbi, functionName: 'decisionsPaid' }),
          params.publicClient.readContract({ address: vault, abi: agentVaultAbi, functionName: 'maxDecisions' }),
          params.publicClient.readContract({ address: vault, abi: agentVaultAbi, functionName: 'subscriptionId' }),
          params.publicClient.readContract({ address: vault, abi: agentVaultAbi, functionName: 'minEdgeBps' }),
        ])
      return {
        address: vault,
        market,
        pool,
        question,
        thesis,
        armed,
        executed,
        shadowMode,
        pendingRequestId,
        decisionsPaid: Number(decisionsPaid),
        maxDecisions: Number(maxDecisions),
        subscriptionId,
        minEdgeBps: Number(minEdgeBps),
      } satisfies AgentVaultSummary
    }),
  )
}

export type AgentReceipt = {
  requestId: bigint
  probability: number
  side: number
  wouldExecute: boolean
  executed: boolean
  orderId: bigint
  priceRaw: bigint
  quantityRaw: bigint
  reason: string
  txHash: Hex
  blockNumber: bigint
}

/** Reconstruct decision receipts from the vault's event logs. */
export async function listAgentReceipts(params: {
  publicClient: PublicClient
  vault: Address
  fromBlock?: bigint
}): Promise<AgentReceipt[]> {
  const logs = await params.publicClient.getLogs({
    address: params.vault,
    event: parseAbi([
      'event DecisionReceipt(uint256 indexed requestId, uint256 probability, uint8 side, bool wouldExecute, bool executed, uint256 orderId, uint256 price, uint256 quantity, string reason)',
    ])[0],
    fromBlock: params.fromBlock ?? 0n,
  })
  return logs
    .map((log) => {
      const args = log.args as {
        requestId: bigint
        probability: bigint
        side: number
        wouldExecute: boolean
        executed: boolean
        orderId: bigint
        price: bigint
        quantity: bigint
        reason: string
      }
      return {
        requestId: args.requestId,
        probability: Number(args.probability),
        side: Number(args.side),
        wouldExecute: args.wouldExecute,
        executed: args.executed,
        orderId: args.orderId,
        priceRaw: args.price,
        quantityRaw: args.quantity,
        reason: args.reason,
        txHash: log.transactionHash,
        blockNumber: log.blockNumber,
      }
    })
    .sort((left, right) => (left.blockNumber > right.blockNumber ? -1 : 1))
}

export type CreateVaultResult = { hash: Hex; vault: Address | null }

/** Approve the exact collateral amount, then create and arm the vault. */
export async function createAgentVault(params: {
  walletClient: WalletClient
  publicClient: PublicClient
  policy: AgentPolicyInput
  collateralAmount: bigint
  nativeBudget: bigint
}): Promise<CreateVaultResult> {
  if (!isAgentFactoryConfigured()) throw new Error('The agent factory is not deployed on this network yet.')
  const { walletClient, publicClient, policy, collateralAmount, nativeBudget } = params
  const account = walletClient.account?.address as Address

  if (collateralAmount > 0n) {
    const allowance = await publicClient.readContract({
      address: policy.collateral,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [account, AGENT_FACTORY_ADDRESS],
    })
    if (allowance < collateralAmount) {
      const hash = await walletClient.writeContract({
        address: policy.collateral,
        abi: erc20Abi,
        functionName: 'approve',
        args: [AGENT_FACTORY_ADDRESS, collateralAmount],
        account,
        chain: somniaShannon,
      })
      await publicClient.waitForTransactionReceipt({ hash })
    }
  }

  const hash = await walletClient.writeContract({
    address: AGENT_FACTORY_ADDRESS,
    abi: agentFactoryAbi,
    functionName: 'createVault',
    args: [
      {
        market: policy.marketAddress,
        pool: policy.poolAddress,
        question: policy.question,
        thesis: policy.thesis,
        allowedDirection: policy.direction === 'yes' ? 1 : policy.direction === 'no' ? 2 : 0,
        minFillRaw: BigInt(Math.round(policy.minFill * 10 ** policy.baseDecimals)),
        minEdgeBps: BigInt(Math.round(policy.minEdgeBps)),
        maxContractsRaw: BigInt(Math.round(policy.maxContracts * 10 ** policy.baseDecimals)),
        slippageBps: BigInt(Math.round(policy.slippageBps)),
        cooldownSeconds: BigInt(Math.round(policy.cooldownSeconds)),
        maxDecisions: policy.maxDecisions,
        shadowMode: policy.shadowMode,
      },
      policy.collateral,
      collateralAmount,
    ],
    value: nativeBudget,
    account,
    chain: somniaShannon,
  })
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  const vaultLog = receipt.logs.find((log) => log.address.toLowerCase() === AGENT_FACTORY_ADDRESS.toLowerCase())
  return { hash, vault: (vaultLog?.address as Address | undefined) ?? null }
}

export async function stopAgentVault(params: { walletClient: WalletClient; vault: Address }): Promise<Hex> {
  const hash = await params.walletClient.writeContract({
    address: params.vault,
    abi: agentVaultAbi,
    functionName: 'stop',
    account: params.walletClient.account?.address ?? null,
    chain: somniaShannon,
  })
  return hash
}

export async function redeemAgentVault(params: { walletClient: WalletClient; vault: Address }): Promise<Hex> {
  const hash = await params.walletClient.writeContract({
    address: params.vault,
    abi: agentVaultAbi,
    functionName: 'redeem',
    account: params.walletClient.account?.address ?? null,
    chain: somniaShannon,
  })
  return hash
}
