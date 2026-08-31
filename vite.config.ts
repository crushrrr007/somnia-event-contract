import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

type ChallengePayload = {
  marketId: string
  asset: string
  interval: string | null
  question: string
  expiry: string
  side: 'UP' | 'DOWN'
  reason: string
  confidence: number
  amount: number
  wallet: string
}

type StoredChallenge = {
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

const challengeStore = new Map<string, StoredChallenge>()

function sendJson(response: any, status: number, body: unknown) {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json')
  response.end(JSON.stringify(body))
}

function readJson(request: any): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: string[] = []
    let size = 0
    request.on('data', (chunk: { toString: () => string }) => {
      const text = chunk.toString()
      size += text.length
      if (size <= 32000) chunks.push(text)
    })
    request.on('end', () => {
      if (size > 32000) {
        reject(new Error('Challenge payload is too large.'))
        return
      }
      try {
        const parsed: unknown = JSON.parse(chunks.join('') || '{}')
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          reject(new Error('Challenge payload must be an object.'))
          return
        }
        resolve(parsed as Record<string, unknown>)
      } catch {
        reject(new Error('Challenge payload was not valid JSON.'))
      }
    })
    request.on('error', reject)
  })
}

function readChallengePayload(body: Record<string, unknown>): ChallengePayload {
  const side = body.side === 'DOWN' ? 'DOWN' : body.side === 'UP' ? 'UP' : null
  const requiredStrings = ['marketId', 'asset', 'question', 'expiry', 'reason', 'wallet']
  if (!side || requiredStrings.some((key) => typeof body[key] !== 'string' || body[key] === '')) {
    throw new Error('A challenge needs a market, side, reason, expiry, and wallet.')
  }
  if (typeof body.confidence !== 'number' || typeof body.amount !== 'number') {
    throw new Error('A challenge needs numeric confidence and amount.')
  }
  if (body.confidence < 0 || body.confidence > 100 || body.amount <= 0 || body.amount > 10) {
    throw new Error('Confidence must be 0-100 and amount must be between 0 and 10.')
  }
  return {
    marketId: body.marketId as string,
    asset: body.asset as string,
    interval: typeof body.interval === 'string' ? body.interval : null,
    question: body.question as string,
    expiry: body.expiry as string,
    side,
    reason: body.reason as string,
    confidence: body.confidence,
    amount: body.amount,
    wallet: body.wallet as string,
  }
}

function createChallengeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function challengeApiPlugin() {
  const handler = async (request: any, response: any, next: () => void) => {
    const pathname = (request.url ?? '/').split('?')[0]
    const base = '/api/challenges'
    if (!pathname.startsWith(base)) {
      next()
      return
    }

    const segments = pathname.slice(base.length).split('/').filter(Boolean)
    try {
      if (request.method === 'POST' && segments.length === 0) {
        const creator = readChallengePayload(await readJson(request))
        const id = createChallengeId()
        const challenge: StoredChallenge = {
          id,
          createdAt: Date.now(),
          status: 'waiting',
          marketId: creator.marketId,
          asset: creator.asset,
          interval: creator.interval,
          question: creator.question,
          expiry: creator.expiry,
          creator,
          opponent: null,
        }
        challengeStore.set(id, challenge)
        sendJson(response, 201, challenge)
        return
      }

      if (request.method === 'GET' && segments.length === 0) {
        sendJson(response, 200, [...challengeStore.values()].sort((left, right) => right.createdAt - left.createdAt))
        return
      }

      if (segments.length !== 1 && !(segments.length === 2 && segments[1] === 'join')) {
        sendJson(response, 404, { error: 'Challenge route not found.' })
        return
      }

      const challenge = challengeStore.get(segments[0])
      if (!challenge) {
        sendJson(response, 404, { error: 'Challenge not found.' })
        return
      }

      if (request.method === 'GET') {
        sendJson(response, 200, challenge)
        return
      }

      if (request.method === 'POST') {
        if (segments[1] !== 'join') {
          sendJson(response, 404, { error: 'Challenge action not found.' })
          return
        }
        if (challenge.opponent) {
          sendJson(response, 409, { error: 'This challenge already has an opponent.' })
          return
        }
        const opponent = readChallengePayload(await readJson(request))
        if (opponent.marketId !== challenge.marketId) {
          sendJson(response, 400, { error: 'The opponent must use the same market.' })
          return
        }
        challenge.opponent = opponent
        challenge.status = 'joined'
        sendJson(response, 200, challenge)
        return
      }

      sendJson(response, 405, { error: 'Method not allowed.' })
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : 'Challenge request failed.' })
    }
  }

  return {
    name: 'signalsprint-challenge-api',
    configureServer(server: { middlewares: { use: (middleware: typeof handler) => void } }) {
      server.middlewares.use(handler)
    },
    configurePreviewServer(server: { middlewares: { use: (middleware: typeof handler) => void } }) {
      server.middlewares.use(handler)
    },
  }
}

export default defineConfig({
  plugins: [react(), challengeApiPlugin()],
})
