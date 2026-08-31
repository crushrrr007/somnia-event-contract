import { readFile } from 'node:fs/promises'
import solc from 'solc'
import { createPublicClient, createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { somniaShannon } from '@somnia-chain/markets-sdk/chains'

const privateKey = process.env.DEPLOYER_PRIVATE_KEY
if (!privateKey?.startsWith('0x')) throw new Error('DEPLOYER_PRIVATE_KEY must be a 0x-prefixed testnet private key.')

const source = await readFile(new URL('../contracts/DecisionRegistry.sol', import.meta.url), 'utf8')
const input = {
  language: 'Solidity',
  sources: { 'DecisionRegistry.sol': { content: source } },
  settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } },
}
const output = JSON.parse(solc.compile(JSON.stringify(input)))
const errors = (output.errors ?? []).filter((error: { severity: string }) => error.severity === 'error')
if (errors.length) throw new Error(errors.map((error: { formattedMessage: string }) => error.formattedMessage).join('\n'))

const artifact = output.contracts['DecisionRegistry.sol'].DecisionRegistry
const account = privateKeyToAccount(privateKey as `0x${string}`)
const transport = http()
const publicClient = createPublicClient({ chain: somniaShannon, transport })
const walletClient = createWalletClient({ account, chain: somniaShannon, transport })
const hash = await walletClient.deployContract({ abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}` })
const receipt = await publicClient.waitForTransactionReceipt({ hash })
console.log(`DecisionRegistry deployed at ${receipt.contractAddress}`)
console.log(`Set VITE_REGISTRY_ADDRESS=${receipt.contractAddress}`)
