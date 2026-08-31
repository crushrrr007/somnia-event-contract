import {
  createPublicClient,
  decodeEventLog,
  http,
  parseAbi,
  type Address,
  type Hex,
  type WalletClient,
} from 'viem'
import { somniaShannon } from '@somnia-chain/markets-sdk/chains'

export const decisionRegistryAbi = parseAbi([
  'function recordDecision(bytes32 marketId, bytes32 tradeHash, uint8 side, uint8 confidence, string thesis)',
  'function getDecisions(address trader) view returns ((bytes32 marketId, bytes32 tradeHash, uint8 side, uint8 confidence, string thesis, uint64 createdAt)[])',
  'function createChallenge(bytes32 marketId, uint8 side, uint8 confidence, string reason, uint256 amount, uint64 expiry) returns (uint256 challengeId)',
  'function joinChallenge(uint256 challengeId, uint8 side, uint8 confidence, string reason, uint256 amount)',
  'function getChallenge(uint256 challengeId) view returns ((bytes32 marketId, uint64 expiry, uint64 createdAt, (address trader, uint8 side, uint8 confidence, string reason, uint256 amount) creator, (address trader, uint8 side, uint8 confidence, string reason, uint256 amount) opponent))',
  'function getChallengesForWallet(address trader) view returns (uint256[])',
  'event ChallengeCreated(uint256 indexed challengeId, address indexed creator, bytes32 indexed marketId, uint64 expiry)',
])

const DEFAULT_REGISTRY_ADDRESS = '0x4ac0e9353432fdce17948e0b2a2162de1a4d3593' as Address
const configuredAddress = import.meta.env.VITE_REGISTRY_ADDRESS
export const DECISION_REGISTRY_ADDRESS = configuredAddress && /^0x[0-9a-fA-F]{40}$/.test(configuredAddress)
  ? configuredAddress as Address
  : DEFAULT_REGISTRY_ADDRESS

const publicClient = createPublicClient({ chain: somniaShannon, transport: http() })
const AMOUNT_SCALE = 1_000_000n

export type OnchainDecision = {
  marketId: Hex
  tradeHash: Hex
  side: 'UP' | 'DOWN'
  confidence: number
  thesis: string
  createdAt: number
}

export type OnchainChallengeCall = {
  wallet: Address
  side: 'UP' | 'DOWN'
  confidence: number
  reason: string
  amount: number
}

export type OnchainChallenge = {
  id: string
  marketId: Hex
  expiry: number
  createdAt: number
  status: 'waiting' | 'joined'
  creator: OnchainChallengeCall
  opponent: OnchainChallengeCall | null
}

function registryAddress(): Address {
  if (!DECISION_REGISTRY_ADDRESS) throw new Error('Decision Registry is not configured yet. Set VITE_REGISTRY_ADDRESS after deploying the contract.')
  return DECISION_REGISTRY_ADDRESS
}

function sideIndex(side: 'UP' | 'DOWN'): number {
  return side === 'UP' ? 0 : 1
}

function decodeCall(call: { trader: Address; side: number; confidence: number; reason: string; amount: bigint }): OnchainChallengeCall {
  return {
    wallet: call.trader,
    side: call.side === 0 ? 'UP' : 'DOWN',
    confidence: call.confidence,
    reason: call.reason,
    amount: Number(call.amount) / Number(AMOUNT_SCALE),
  }
}

export async function recordDecision({
  marketId,
  tradeHash,
  side,
  confidence,
  thesis,
  address,
  walletClient,
}: {
  marketId: Hex
  tradeHash: Hex
  side: 'UP' | 'DOWN'
  confidence: number
  thesis: string
  address: Address
  walletClient: WalletClient
}): Promise<Hex> {
  const hash = await walletClient.writeContract({
    address: registryAddress(), abi: decisionRegistryAbi, functionName: 'recordDecision',
    args: [marketId, tradeHash, sideIndex(side), confidence, thesis], account: address, chain: somniaShannon,
  })
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error('Decision receipt reverted on-chain.')
  return hash
}

export async function fetchDecisions(trader: Address): Promise<OnchainDecision[]> {
  const records = await publicClient.readContract({
    address: registryAddress(), abi: decisionRegistryAbi, functionName: 'getDecisions', args: [trader],
  })
  return records.map((record) => ({
    marketId: record.marketId,
    tradeHash: record.tradeHash,
    side: record.side === 0 ? 'UP' : 'DOWN',
    confidence: record.confidence,
    thesis: record.thesis,
    createdAt: Number(record.createdAt) * 1000,
  }))
}

export async function createChallenge({ marketId, side, confidence, reason, amount, expiry, address, walletClient }: {
  marketId: Hex; side: 'UP' | 'DOWN'; confidence: number; reason: string; amount: number; expiry: number; address: Address; walletClient: WalletClient
}): Promise<string> {
  const hash = await walletClient.writeContract({
    address: registryAddress(), abi: decisionRegistryAbi, functionName: 'createChallenge',
    args: [marketId, sideIndex(side), confidence, reason, BigInt(Math.round(amount * Number(AMOUNT_SCALE))), BigInt(expiry)],
    account: address, chain: somniaShannon,
  })
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error('Challenge creation reverted on-chain.')
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({ abi: decisionRegistryAbi, data: log.data, topics: log.topics })
      if (decoded.eventName === 'ChallengeCreated') return decoded.args.challengeId.toString()
    } catch { /* Ignore unrelated logs in the receipt. */ }
  }
  throw new Error('Challenge was created, but its id could not be read from the receipt.')
}

export async function joinChallenge({ id, side, confidence, reason, amount, address, walletClient }: {
  id: string; side: 'UP' | 'DOWN'; confidence: number; reason: string; amount: number; address: Address; walletClient: WalletClient
}): Promise<Hex> {
  const hash = await walletClient.writeContract({
    address: registryAddress(), abi: decisionRegistryAbi, functionName: 'joinChallenge',
    args: [BigInt(id), sideIndex(side), confidence, reason, BigInt(Math.round(amount * Number(AMOUNT_SCALE)))],
    account: address, chain: somniaShannon,
  })
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error('Challenge join reverted on-chain.')
  return hash
}

export async function fetchChallenge(id: string): Promise<OnchainChallenge> {
  const result = await publicClient.readContract({
    address: registryAddress(), abi: decisionRegistryAbi, functionName: 'getChallenge', args: [BigInt(id)],
  })
  const opponent = result.opponent.trader === '0x0000000000000000000000000000000000000000' ? null : decodeCall(result.opponent)
  return {
    id, marketId: result.marketId, expiry: Number(result.expiry), createdAt: Number(result.createdAt) * 1000,
    status: opponent ? 'joined' : 'waiting', creator: decodeCall(result.creator), opponent,
  }
}

export async function fetchWalletChallenges(trader: Address): Promise<OnchainChallenge[]> {
  const ids = await publicClient.readContract({
    address: registryAddress(), abi: decisionRegistryAbi, functionName: 'getChallengesForWallet', args: [trader],
  })
  return Promise.all(ids.map((id) => fetchChallenge(id.toString())))
}
