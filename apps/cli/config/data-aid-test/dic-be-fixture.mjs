#!/usr/bin/env node
// Local fake dic-be query-broker fixture for the data-aid-test smoke overlay.
//
// Implements the minimum of the dic-be internal contract the DSH provider
// depends on: accepts a POST to /query carrying a non-empty
// `x-dsh-principal-assertion` JWT header, and returns one complete bounded
// tabular result. It does not verify assertion signatures or enforce
// authorization — it only proves composition and HTTP wiring.
//
// Run separately before `pnpm dsh --profile data-aid --patch apps/cli/config/data-aid-test/cordis.patch.yml`:
//   node apps/cli/config/data-aid-test/dic-be-fixture.mjs
//
// Binds to 127.0.0.1:3901 unless DIC_BE_FIXTURE_PORT is set.

import { createServer } from 'node:http'

const port = Number(process.env.DIC_BE_FIXTURE_PORT ?? 3901)

createServer((request, response) => {
  if (request.method !== 'POST' || request.url !== '/query') {
    response.writeHead(404).end()
    return
  }
  const assertion = request.headers['x-dsh-principal-assertion']
  if (typeof assertion !== 'string' || assertion.length === 0) {
    response.writeHead(401, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ success: false, error: 'missing assertion' }))
    return
  }
  let body = ''
  request.on('data', chunk => { body += chunk })
  request.on('end', () => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({
      columns: ['team_code', 'order_count'],
      rows: [['1001', 12], ['1002', 8]],
      rowCount: 2,
      complete: true,
      truncated: false,
    }))
  })
}).listen(port, '127.0.0.1', () => {
  console.log(`dic-be fixture listening on http://127.0.0.1:${port}`)
})
