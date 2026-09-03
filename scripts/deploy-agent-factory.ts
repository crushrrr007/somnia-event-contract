import { readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import solc from 'solc'
import { createPublicClient, createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { somniaShannon } from '@somnia-chain/markets-sdk/chains'

const rawPrivateKey = process.env.DEPLOYER_PRIVATE_KEY?.trim()
if (!rawPrivateKey) throw new Error('DEPLOYER_PRIVATE_KEY is required.')
const privateKey = (rawPrivateKey.startsWith('0x') ? rawPrivateKey : `0x${rawPrivateKey}`) as `0x${string}`

// Official Somnia Agents platform on Shannon testnet (chain 50312).
const AGENT_REQUESTER_TESTNET = '0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776'
// Somnia LLM Inference base agent (Qwen3-30B), deterministic across runners.
const LLM_AGENT_ID = 12847293847561029384n

const contractsRoot = path.resolve(import.meta.dirname ?? '.', '../contracts')

// solc import callbacks are synchronous.
function resolveImport(importPath: string): { contents: string } | { error: string } {
  const candidates = importPath.startsWith('@somnia-chain/')
    ? [path.resolve('node_modules', importPath)]
    : [path.resolve(contractsRoot, importPath), path.resolve(contractsRoot, `${importPath}.sol`)]
  for (const candidate of candidates) {
    try {
      return { contents: readFileSync(candidate, 'utf8') }
    } catch {
      continue
    }
  }
  return { error: `Import not found: ${importPath}` }
}

const vaultSource = await readFile(path.join(contractsRoot, 'ReactiveDecisionVault.sol'), 'utf8')
const factorySource = await readFile(path.join(contractsRoot, 'ReactiveDecisionFactory.sol'), 'utf8')

const input = {
  language: 'Solidity',
  sources: {
    'ReactiveDecisionVault.sol': { content: vaultSource },
    'ReactiveDecisionFactory.sol': { content: factorySource },
  },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    viaIR: true,
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
  },
}

const output = JSON.parse(solc.compile(JSON.stringify(input), { import: resolveImport }))
const errors = (output.errors ?? []).filter((error: { severity: string }) => error.severity === 'error')
if (errors.length) throw new Error(errors.map((error: { formattedMessage: string }) => error.formattedMessage).join('\n'))

const factoryArtifact = output.contracts['ReactiveDecisionFactory.sol'].ReactiveDecisionFactory
const account = privateKeyToAccount(privateKey as `0x${string}`)
const transport = http()
const publicClient = createPublicClient({ chain: somniaShannon, transport })
const walletClient = createWalletClient({ account, chain: somniaShannon, transport })

const balance = await publicClient.getBalance({ address: account.address })
console.log(`Deployer ${account.address} balance: ${Number(balance) / 1e18} STT`)

const hash = await walletClient.deployContract({
  abi: factoryArtifact.abi,
  bytecode: `0x${factoryArtifact.evm.bytecode.object}`,
  args: [AGENT_REQUESTER_TESTNET, LLM_AGENT_ID],
})
const receipt = await publicClient.waitForTransactionReceipt({ hash })
console.log(`ReactiveDecisionFactory deployed at ${receipt.contractAddress}`)
console.log(`Set VITE_AGENT_FACTORY_ADDRESS=${receipt.contractAddress}`)
