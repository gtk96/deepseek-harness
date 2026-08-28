import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertPinnedImage,
  assertResolvedImage,
  validateDeploymentArtifacts,
} from '../deploy/controlled-data-query/scripts/validate-manifests.mjs'

const root = resolve(import.meta.dirname, '../deploy/controlled-data-query')
const temporaryRoots: string[] = []

async function mutatedRoot(relativePath: string, from: string, to: string): Promise<string> {
  const target = await mkdtemp(join(tmpdir(), 'controlled-query-manifest-'))
  temporaryRoots.push(target)
  await cp(root, target, {
    recursive: true,
    filter: source => basename(source) !== 'node_modules',
  })
  const path = join(target, relativePath)
  const source = await readFile(path, 'utf8')
  expect(source).toContain(from)
  await writeFile(path, source.replace(from, to))
  return target
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('controlled data-query deployment artifacts', () => {
  it('validate exact offline manifests without kubectl or kustomize installed', async () => {
    await expect(validateDeploymentArtifacts(root)).resolves.toEqual({
      resourceCount: 28,
      networkPolicyCount: 10,
    })
  })

  it('distinguishes offline placeholders from cluster-resolved digests', () => {
    const digest = 'a'.repeat(64)
    expect(() => { assertPinnedImage('registry.example.invalid/dsh:latest') }).toThrow('latest image is forbidden')
    expect(() => { assertPinnedImage('registry.example.invalid/dsh:release') }).toThrow('offline digest placeholder')
    expect(() => { assertPinnedImage('registry.example.invalid/dsh@sha256:${DSH_IMAGE_DIGEST}') }).not.toThrow()
    expect(() => { assertPinnedImage(`registry.example.invalid/dsh@sha256:${digest}`) }).not.toThrow()
    expect(() => { assertResolvedImage('registry.example.invalid/dsh@sha256:${DSH_IMAGE_DIGEST}') }).toThrow('64 lowercase hex')
    expect(() => { assertResolvedImage(`registry.example.invalid/dsh@sha256:${digest}`) }).not.toThrow()
  })

  it('keeps the DSH image secret-free and copies only the production closure at runtime', async () => {
    const [dockerfile, dockerIgnore, runtimeManifest] = await Promise.all([
      readFile(resolve(root, 'images/dsh/Dockerfile'), 'utf8'),
      readFile(resolve(root, '../..', '.dockerignore'), 'utf8'),
      readFile(resolve(root, 'images/dsh/runtime/package.json'), 'utf8'),
    ])

    expect(dockerfile).toContain('CMD ["node", "--expose-internals", "apps/cli/lib/bin.js", "--profile", "data-aid"]')
    expect(dockerfile).toContain('HOME=/home/dsh')
    expect(dockerfile).toContain('install -d -o 10001 -g 10001 /home/dsh')
    expect(dockerfile).toContain('USER 10001:10001')
    expect(dockerfile.slice(dockerfile.lastIndexOf('\nFROM '))).toContain('node --expose-internals apps/cli/lib/bin.js --profile data-aid --dump-config')
    expect(dockerfile).toContain('deploy --legacy --prod')
    expect(dockerfile).toContain('ARG DSH_CLIENT_COMMIT_HASH')
    expect(dockerfile).toContain('test -n "${DSH_CLIENT_COMMIT_HASH}"')
    expect(dockerfile).toContain('/runtime /runtime')
    expect(dockerfile).not.toMatch(/(?:DEEPSEEK_API_KEY|ASSERTION_KEY_RING|SERVICE_TOKEN)\s*=/u)
    expect(dockerfile.slice(dockerfile.lastIndexOf('\nFROM '))).not.toContain('/workspace')
    const parsedRuntimeManifest = JSON.parse(runtimeManifest) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    expect(parsedRuntimeManifest).not.toHaveProperty('devDependencies')
    expect(parsedRuntimeManifest.dependencies).toMatchObject({
      '@deepseek-ai/cordis-plugin-hmr': 'workspace:^',
      '@deepseek-ai/cordis-plugin-timer': 'workspace:^',
      '@deepseek-ai/dsh-persona': 'workspace:^',
    })
    expect(dockerIgnore).toContain('**/.env.local')
    expect(dockerIgnore).toContain('dic-be')
    expect(dockerIgnore).toContain('dic-fe')
  })

  it.each([
    ['network port', 'base/network-policies.yaml', 'port: 3081', 'port: 3082', 'exact selector/peer/port allowlist'],
    ['secret name', 'base/dsh.yaml', 'name: dsh-runtime, key: DEEPSEEK_API_KEY', 'name: dic-be-broker-runtime, key: DEEPSEEK_API_KEY', 'workload secret references'],
    ['secret key', 'base/dsh.yaml', 'key: DEEPSEEK_API_KEY', 'key: TIDB_PASSWORD', 'workload secret references'],
    ['TiDB peer replaced by ipBlock', 'base/network-policies.yaml', 'namespaceSelector:\n            matchLabels: {kubernetes.io/metadata.name: data-platform}\n          podSelector:\n            matchLabels: {app.kubernetes.io/name: tidb}', 'ipBlock: {cidr: 0.0.0.0/0}', 'exact selector/peer/port allowlist'],
    ['TiDB namespace selector', 'base/network-policies.yaml', 'kubernetes.io/metadata.name: data-platform', 'kubernetes.io/metadata.name: default', 'exact selector/peer/port allowlist'],
    ['image digest', 'base/dsh.yaml', '@sha256:${DSH_IMAGE_DIGEST}', '@sha256:abc123', 'offline digest placeholder'],
    ['DSH manifest HMR internals flag', 'base/dsh.yaml', 'args: ["--expose-internals", "apps/cli/lib/bin.js", "--profile", "data-aid"]', 'args: ["apps/cli/lib/bin.js", "--profile", "data-aid"]', 'HMR internals enabled'],
    ['DSH image build-smoke HMR internals flag', 'images/dsh/Dockerfile', 'node --expose-internals /runtime/apps/cli/lib/bin.js --profile data-aid --dump-config', 'node /runtime/apps/cli/lib/bin.js --profile data-aid --dump-config', 'build smoke must enable HMR internals'],
    ['DSH image final-user-smoke HMR internals flag', 'images/dsh/Dockerfile', 'RUN node --expose-internals apps/cli/lib/bin.js --profile data-aid --dump-config', 'RUN node apps/cli/lib/bin.js --profile data-aid --dump-config', 'final-user smoke must enable HMR internals'],
    ['DSH image HMR internals flag', 'images/dsh/Dockerfile', 'CMD ["node", "--expose-internals", "apps/cli/lib/bin.js", "--profile", "data-aid"]', 'CMD ["node", "apps/cli/lib/bin.js", "--profile", "data-aid"]', 'default command must enable HMR internals'],
    ['DSH preset persona runtime dependency', 'images/dsh/runtime/package.json', '    "@deepseek-ai/dsh-persona": "workspace:^",\n', '', 'runtime manifest must directly depend on @deepseek-ai/dsh-persona'],
    ['runtime workspace copy', 'images/dsh/Dockerfile', 'COPY --from=build --chown=10001:10001 /runtime /runtime', 'COPY --from=build --chown=10001:10001 /workspace /workspace', 'runtime stage must copy only /runtime'],
  ])('rejects the %s mutation', async (_label, path, from, to, message) => {
    const mutated = await mutatedRoot(path, from, to)
    await expect(validateDeploymentArtifacts(mutated)).rejects.toThrow(message)
  })
})
