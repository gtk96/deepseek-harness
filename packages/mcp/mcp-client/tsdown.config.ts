import { defineConfig } from 'tsdown'

const entries = [
  'lib/types/index.js',
  'lib/types/invariant.js',
  'lib/types/mcp-clients.js',
]

/** Build each published MCP entry as a self-contained ESM artifact. */
export default defineConfig(entries.map(entry => ({
  entry: [entry],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  outputOptions: { codeSplitting: false },
  dts: false,
  clean: false,
})))
