#!/usr/bin/env node
/**
 * Local CORS workaround for `POST https://app.silo.finance/api/earn-silos`.
 * The browser talks to this process (same-origin enough: localhost → localhost),
 * and this script forwards the body server-side (no CORS there).
 *
 * Usage:
 *   1. Terminal A: `npm run dev:proxy-earn-silos`
 *   2. Create `.env.local` with:
 *        NEXT_PUBLIC_EARN_SILOS_URL=http://127.0.0.1:3041/api/earn-silos
 *   3. Terminal B: `npm run dev`
 *
 * Env:
 *   EARN_SILOS_PROXY_PORT — listen port (default 3041)
 *   EARN_SILOS_UPSTREAM   — override upstream URL
 */
import http from 'node:http'

const PORT = Number(process.env.EARN_SILOS_PROXY_PORT || 3041)
const UPSTREAM = (process.env.EARN_SILOS_UPSTREAM || 'https://app.silo.finance/api/earn-silos').replace(
  /\/$/,
  ''
)
const ALLOWED_ORIGINS = new Set([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://localhost:3000',
  'https://127.0.0.1:3000',
])

function corsHeaders(origin) {
  /** @type {Record<string, string>} */
  const h = {}
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    h['Access-Control-Allow-Origin'] = origin
    h['Vary'] = 'Origin'
    h['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
    h['Access-Control-Allow-Headers'] = 'Content-Type'
    h['Access-Control-Max-Age'] = '86400'
  }
  return h
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin ?? null
  const ch = corsHeaders(origin)
  for (const [k, v] of Object.entries(ch)) {
    res.setHeader(k, v)
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  if (req.method !== 'POST' || req.url !== '/api/earn-silos') {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Not found — POST only to /api/earn-silos')
    return
  }

  const chunks = []
  for await (const chunk of req) {
    chunks.push(chunk)
  }
  const body = Buffer.concat(chunks)

  try {
    const r = await fetch(UPSTREAM, {
      method: 'POST',
      headers: {
        'Content-Type': req.headers['content-type'] || 'application/json',
      },
      body,
    })
    const buf = Buffer.from(await r.arrayBuffer())
    const ct = r.headers.get('content-type') || 'application/json'
    const outH = { ...corsHeaders(origin), 'Content-Type': ct }
    res.writeHead(r.status, outH)
    res.end(buf)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    res.writeHead(502, { ...corsHeaders(origin), 'Content-Type': 'text/plain; charset=utf-8' })
    res.end(`Upstream error: ${msg}`)
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(
    `[earn-silos dev proxy] http://127.0.0.1:${PORT}/api/earn-silos  →  ${UPSTREAM}\n` +
      `Set NEXT_PUBLIC_EARN_SILOS_URL=http://127.0.0.1:${PORT}/api/earn-silos in .env.local, then npm run dev`
  )
})
