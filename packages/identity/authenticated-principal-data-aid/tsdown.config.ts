import { defineConfig } from 'tsdown'

const entries = [
  'lib/types/index.js',
  'lib/types/invariant.js',
  'lib/types/mse-gateway.js',
  'lib/types/data-aid-health.js',
  'lib/types/dic-be-turn-ingress.js',
  'lib/types/loopback-test.js',
  'lib/types/turn-principal.js',
  'lib/types/data-query-tool.js',
  'lib/types/direct-query-tools.js',
]

/** Build each published Loader entry as a self-contained ESM artifact. */
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
