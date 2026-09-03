const INDEXER_ENDPOINT = 'https://dev.smk.somnia.host/v1/graphql'
const MAX_BODY_BYTES = 64_000
const UPSTREAM_TIMEOUT_MS = 25_000

type ApiRequest = {
  method?: string
  body?: unknown
}

type ApiResponse = {
  status: (code: number) => ApiResponse
  setHeader: (name: string, value: string) => void
  send: (body: string) => void
  json: (body: unknown) => void
}

function parseBody(body: unknown): { query: string; variables?: unknown } | null {
  let parsed = body
  if (typeof body === 'string') {
    if (body.length > MAX_BODY_BYTES) return null
    try {
      parsed = JSON.parse(body)
    } catch {
      return null
    }
  }

  if (!parsed || typeof parsed !== 'object') return null
  const candidate = parsed as { query?: unknown; variables?: unknown }
  if (typeof candidate.query !== 'string' || candidate.query.length === 0) return null
  if (candidate.query.length > MAX_BODY_BYTES) return null

  return { query: candidate.query, variables: candidate.variables }
}

export default async function handler(request: ApiRequest, response: ApiResponse) {
  response.setHeader('Cache-Control', 'no-store')

  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    response.status(405).json({ error: 'Method not allowed' })
    return
  }

  const body = parseBody(request.body)
  if (!body) {
    response.status(400).json({ error: 'Invalid GraphQL request' })
    return
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)

  try {
    const upstream = await fetch(INDEXER_ENDPOINT, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: controller.signal,
    })

    const payload = await upstream.text()
    response.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/json; charset=utf-8')
    response.status(upstream.status).send(payload)
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'AbortError'
    response.status(timedOut ? 504 : 502).json({
      error: timedOut ? 'DreamDEX indexer timed out' : 'DreamDEX indexer unavailable',
    })
  } finally {
    clearTimeout(timeout)
  }
}
