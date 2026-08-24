/** Local, deterministic MaxCompute MCP fixture for DSH data-aid Gateway smoke tests. */

import { McpServer } from '../../../../packages/mcp/mcp-client/node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js'
import { StdioServerTransport } from '../../../../packages/mcp/mcp-client/node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js'
import { z } from '../../../../packages/mcp/mcp-client/node_modules/zod/index.js'

const EXPECTED_PROJECT = 'giikin'
const EXPECTED_USER = '014815142220899789'
const EXPECTED_DT = '20260819'
const EXPECTED_HT = '14'

const server = new McpServer(
  { name: 'dsh-data-aid-maxcompute-fixture', version: '1.0.0' },
  { capabilities: { tools: {} } },
)

server.registerTool('execute_sql', {
  description: 'Returns the fixed complete MaxCompute authority row for the loopback DSH smoke test.',
  inputSchema: {
    project: z.string(),
    sql: z.string(),
    async: z.boolean(),
    maxCU: z.number(),
    timeout: z.number(),
  },
}, async ({ project, sql, async, maxCU, timeout }) => {
  const valid = project === EXPECTED_PROJECT
    && async === false
    && Number.isFinite(maxCU) && maxCU > 0
    && Number.isInteger(timeout) && timeout > 0
    && sql.includes('ods_pl_gimp__gk_dingtalk_user_hourly')
    && sql.includes('dmr_pty_staff_attribute_authority_hourly')
    && sql.includes(`i.dd_userid = '${EXPECTED_USER}'`)
    && sql.includes(`i.dt = '${EXPECTED_DT}'`)
    && sql.includes(`i.ht = '${EXPECTED_HT}'`)
    && sql.includes(`a.dt = '${EXPECTED_DT}'`)
    && sql.includes(`a.ht = '${EXPECTED_HT}'`)
  if (!valid) {
    return {
      isError: true,
      content: [{ type: 'text', text: 'fixture rejected an unexpected authority query' }],
    }
  }
  const data = [{
    gk_userid: '1016',
    gimp_staff_id: '1016',
    dd_userid: EXPECTED_USER,
    dd_staff_id: EXPECTED_USER,
    data_role: '10',
    team_codes: '1001,1002',
    data_org_code: '1053',
  }]
  return {
    content: [{ type: 'text', text: 'one complete fixture authority row' }],
    structuredContent: {
      success: true,
      truncated: false,
      rowCount: data.length,
      rowsReturned: data.length,
      data,
    },
  }
})

await server.connect(new StdioServerTransport())
