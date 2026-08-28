#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const deploymentRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

export function assertPinnedImage(image) {
  invariant(typeof image === 'string', 'container image must be a string');
  invariant(!/(?:^|:)latest$/u.test(image), `latest image is forbidden: ${image}`);
  invariant(
    /@sha256:(?:\$\{[A-Z][A-Z0-9_]*_IMAGE_DIGEST\}|[0-9a-f]{64})$/u.test(image),
    `image must use an offline digest placeholder or resolved 64-hex digest: ${image}`,
  );
}

export function assertResolvedImage(image) {
  invariant(
    typeof image === 'string' && /^[^@\s]+@sha256:[0-9a-f]{64}$/u.test(image),
    `resolved image must end in @sha256:<64 lowercase hex>: ${image}`,
  );
}

function documentsFrom(text, path) {
  const documents = [];
  yaml.loadAll(text, value => {
    if (value && typeof value === 'object') documents.push({ ...value, __path: path });
  });
  return documents;
}

function containersOf(document) {
  const podSpec = ['Deployment', 'Job'].includes(document.kind) ? document.spec?.template?.spec : undefined;
  return podSpec?.containers ?? [];
}

function envValue(workload, name) {
  return containersOf(workload).flatMap(container => container.env ?? []).find(item => item.name === name)?.value;
}

function sorted(values) {
  return [...values].sort();
}

function secretRefsOf(workload) {
  const refs = {};
  for (const container of containersOf(workload)) {
    for (const source of container.envFrom ?? []) {
      invariant(source.secretRef === undefined, `${workload.metadata.name}: secretRef envFrom is forbidden`);
    }
    for (const item of container.env ?? []) {
      const ref = item.valueFrom?.secretKeyRef;
      if (ref !== undefined) refs[item.name] = `${ref.name}/${ref.key}`;
    }
  }
  return refs;
}

function assertExact(actual, expected, message) {
  try {
    assert.deepStrictEqual(actual, expected);
  } catch {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function selector(name) {
  return { matchLabels: { 'app.kubernetes.io/name': name } };
}

const tidbPeer = {
  namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'data-platform' } },
  podSelector: selector('tidb'),
};

const expectedPolicySpecs = {
  'default-deny': { podSelector: {}, policyTypes: ['Ingress', 'Egress'] },
  'allow-dns-egress': {
    podSelector: {}, policyTypes: ['Egress'],
    egress: [{
      to: [{
        namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'kube-system' } },
        podSelector: { matchLabels: { 'k8s-app': 'kube-dns' } },
      }],
      ports: [{ protocol: 'UDP', port: 53 }, { protocol: 'TCP', port: 53 }],
    }],
  },
  'broker-ingress-from-dsh': {
    podSelector: selector('dic-be-broker'), policyTypes: ['Ingress'],
    ingress: [{ from: [{ podSelector: selector('dsh') }], ports: [{ protocol: 'TCP', port: 8000 }] }],
  },
  'dsh-ingress-from-public': {
    podSelector: selector('dsh'), policyTypes: ['Ingress'],
    ingress: [{ from: [{ podSelector: selector('dic-be-public') }], ports: [{ protocol: 'TCP', port: 3081 }] }],
  },
  'public-ingress-from-controller': {
    podSelector: selector('dic-be-public'), policyTypes: ['Ingress'],
    ingress: [{
      from: [{
        namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'ingress-nginx' } },
        podSelector: { matchLabels: { 'app.kubernetes.io/component': 'controller' } },
      }],
      ports: [{ protocol: 'TCP', port: 8000 }],
    }],
  },
  'frontend-ingress-from-controller': {
    podSelector: selector('dic-fe'), policyTypes: ['Ingress'],
    ingress: [{
      from: [{
        namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'ingress-nginx' } },
        podSelector: { matchLabels: { 'app.kubernetes.io/component': 'controller' } },
      }],
      ports: [{ protocol: 'TCP', port: 8080 }],
    }],
  },
  'public-egress': {
    podSelector: selector('dic-be-public'), policyTypes: ['Egress'],
    egress: [
      { to: [{ podSelector: selector('dsh') }], ports: [{ protocol: 'TCP', port: 3081 }] },
      { to: [tidbPeer], ports: [{ protocol: 'TCP', port: 4000 }] },
    ],
  },
  'dsh-egress': {
    podSelector: selector('dsh'), policyTypes: ['Egress'],
    egress: [
      { to: [{ podSelector: selector('dic-be-broker') }], ports: [{ protocol: 'TCP', port: 8000 }] },
      { to: [{ ipBlock: { cidr: '0.0.0.0/0' } }], ports: [{ protocol: 'TCP', port: 443 }] },
    ],
  },
  'broker-egress': {
    podSelector: selector('dic-be-broker'), policyTypes: ['Egress'],
    egress: [
      { to: [tidbPeer], ports: [{ protocol: 'TCP', port: 4000 }] },
      { to: [{ ipBlock: { cidr: '0.0.0.0/0' } }], ports: [{ protocol: 'TCP', port: 443 }] },
    ],
  },
  'ddl-egress': {
    podSelector: selector('dic-be-ddl'), policyTypes: ['Egress'],
    egress: [{ to: [tidbPeer], ports: [{ protocol: 'TCP', port: 4000 }] }],
  },
};

const expectedDshRuntimeDirectDependencies = [
  '@deepseek-ai/cordis-plugin-hmr',
  '@deepseek-ai/cordis-plugin-timer',
  '@deepseek-ai/dsh-authenticated-principal-data-aid',
  '@deepseek-ai/dsh-persona',
];

const expectedSecrets = {
  'dsh-runtime': [
    'DEEPSEEK_API_KEY',
    'DATA_AID_QUERY_ASSERTION_KEY_RING',
    'DATA_AID_QUERY_ASSERTION_ACTIVE_KID',
    'DATA_AID_INGRESS_SERVICE_TOKEN',
    'DATA_AID_TURN_CALLBACK_SERVICE_TOKEN',
  ],
  'dic-be-public-runtime': ['JWT_SECRET', 'TIDB_PASSWORD', 'DSH_TURN_SERVICE_TOKEN'],
  'dic-be-broker-runtime': [
    'TIDB_PASSWORD',
    'DSH_ASSERTION_KEY_RING',
    'DSH_ASSERTION_ACTIVE_KID',
    'DSH_ASSERTION_ACCEPTED_KIDS',
    'DSH_TURN_CALLBACK_SERVICE_TOKEN',
    'MAXCOMPUTE_AK',
    'MAXCOMPUTE_SK',
  ],
  'dic-be-ddl-runtime': ['TIDB_PASSWORD'],
};

const expectedWorkloadSecretRefs = {
  dsh: Object.fromEntries(expectedSecrets['dsh-runtime'].map(key => [key, `dsh-runtime/${key}`])),
  'dic-be-public': Object.fromEntries(expectedSecrets['dic-be-public-runtime'].map(key => [key, `dic-be-public-runtime/${key}`])),
  'dic-be-broker': Object.fromEntries(expectedSecrets['dic-be-broker-runtime'].map(key => [key, `dic-be-broker-runtime/${key}`])),
  'dic-be-ddl': Object.fromEntries(expectedSecrets['dic-be-ddl-runtime'].map(key => [key, `dic-be-ddl-runtime/${key}`])),
};

export async function validateDeploymentArtifacts(root = deploymentRoot) {
  const base = join(root, 'base');
  const files = (await readdir(base)).filter(file => extname(file) === '.yaml');
  const loaded = await Promise.all(files.map(async file => {
    const path = join(base, file);
    return documentsFrom(await readFile(path, 'utf8'), path);
  }));
  const documents = loaded.flat();
  const resources = documents.filter(document => document.kind !== 'Kustomization');
  const byKindName = new Map(resources.map(document => [`${document.kind}/${document.metadata?.name}`, document]));

  invariant(!resources.some(document => document.kind === 'Secret'), 'literal Kubernetes Secret resources are forbidden');
  for (const document of resources) {
    invariant(document.stringData === undefined, `${document.__path}: stringData is forbidden`);
    for (const container of containersOf(document)) {
      assertPinnedImage(container.image);
      const invocation = JSON.stringify([container.command ?? [], container.args ?? []]);
      invariant(!/(?:--seed|--reference|seed_reference|seed_mock)/u.test(invocation), `${document.metadata.name}: seed/reference invocation is forbidden`);
      invariant(container.resources?.requests && container.resources?.limits, `${document.metadata.name}: resources are required`);
      invariant(container.securityContext?.allowPrivilegeEscalation === false, `${document.metadata.name}: privilege escalation must be disabled`);
      invariant(container.securityContext?.readOnlyRootFilesystem === true, `${document.metadata.name}: root filesystem must be read-only`);
      invariant(container.securityContext?.capabilities?.drop?.includes('ALL'), `${document.metadata.name}: all capabilities must be dropped`);
    }
    if (['Deployment', 'Job'].includes(document.kind)) {
      const podSpec = document.spec.template.spec;
      invariant(podSpec.automountServiceAccountToken === false, `${document.metadata.name}: service account token must be disabled`);
      invariant(podSpec.securityContext?.runAsNonRoot === true, `${document.metadata.name}: pod must run as non-root`);
    }
    if (document.kind === 'Deployment') {
      for (const container of containersOf(document)) {
        invariant(container.livenessProbe && container.readinessProbe, `${document.metadata.name}: both probes are required`);
      }
    }
  }

  for (const [name, keys] of Object.entries(expectedSecrets)) {
    const external = byKindName.get(`ExternalSecret/${name}`);
    invariant(external, `ExternalSecret/${name} is required`);
    invariant(external.spec?.target?.name === name, `ExternalSecret/${name} must target Secret/${name}`);
    invariant(external.data === undefined && external.stringData === undefined, `${name}: top-level secret data is forbidden`);
    invariant(Array.isArray(external.spec?.data), `${name}: remote references are required`);
    assertExact(sorted(external.spec.data.map(item => item.secretKey)), sorted(keys), `${name}: secret key allowlist mismatch`);
    for (const item of external.spec.data) {
      invariant(item.remoteRef?.key && item.remoteRef?.property, `${name}: every item must use remoteRef key/property`);
      invariant(Object.keys(item).every(key => ['secretKey', 'remoteRef'].includes(key)), `${name}: items may contain only secretKey and remoteRef`);
    }
  }
  invariant(resources.filter(document => document.kind === 'ExternalSecret').length === Object.keys(expectedSecrets).length, 'unexpected ExternalSecret resource');

  for (const name of ['dsh', 'dic-be-public', 'dic-be-broker', 'dic-fe']) {
    invariant(byKindName.has(`Deployment/${name}`), `Deployment/${name} is required`);
    invariant(byKindName.has(`Service/${name}`), `Service/${name} is required`);
  }
  for (const [name, refs] of Object.entries(expectedWorkloadSecretRefs)) {
    const kind = name === 'dic-be-ddl' ? 'Job' : 'Deployment';
    assertExact(secretRefsOf(byKindName.get(`${kind}/${name}`)), refs, `${name}: workload secret references`);
  }
  invariant(Object.keys(secretRefsOf(byKindName.get('Deployment/dic-fe'))).length === 0, 'dic-fe must not receive secrets');

  const databaseConfig = byKindName.get('ConfigMap/dic-be-database-config');
  invariant(databaseConfig?.data?.TIDB_HOST === 'tidb.data-platform.svc.cluster.local', 'TiDB host must match the selected data-platform service');
  const brokerConfig = byKindName.get('ConfigMap/dic-be-broker-config');
  for (const key of ['MAXCOMPUTE_ENDPOINT', 'MAXCOMPUTE_PROJECT', 'DATA_QUERY_MAXCOMPUTE_QUOTA']) {
    invariant(brokerConfig?.data?.[key] === `\${${key}}`, `${key} must be a non-secret ConfigMap render placeholder`);
    invariant(!Object.values(expectedSecrets).flat().includes(key), `${key} cannot be an ExternalSecret key`);
  }

  const publicDeployment = byKindName.get('Deployment/dic-be-public');
  const brokerDeployment = byKindName.get('Deployment/dic-be-broker');
  invariant(envValue(publicDeployment, 'APP_SURFACE') === undefined, 'surface must come from the public ConfigMap');
  invariant(byKindName.get('ConfigMap/dic-be-public-config')?.data?.APP_SURFACE === 'public', 'public ConfigMap must select public');
  invariant(brokerConfig?.data?.APP_SURFACE === 'broker', 'broker ConfigMap must select broker');
  for (const deployment of [publicDeployment, brokerDeployment]) {
    invariant(JSON.stringify(containersOf(deployment)[0].command) === '["gunicorn"]', `${deployment.metadata.name} must bypass the image entrypoint`);
  }

  const dsh = byKindName.get('Deployment/dsh');
  const dshContainer = containersOf(dsh)[0];
  invariant(JSON.stringify(dshContainer.command) === '["node"]', 'DSH must run Node directly');
  invariant(JSON.stringify(dshContainer.args) === '["--expose-internals","apps/cli/lib/bin.js","--profile","data-aid"]', 'DSH must run the built data-aid CLI with HMR internals enabled');
  invariant(dshContainer.ports?.length === 1 && dshContainer.ports[0].containerPort === 3081, 'DSH container must expose only 3081');
  invariant(!JSON.stringify(dshContainer).includes('tsx'), 'DSH production command cannot use tsx');

  const ddl = byKindName.get('Job/dic-be-ddl');
  invariant(ddl, 'pure DDL Job is required');
  const ddlContainer = containersOf(ddl)[0];
  invariant(JSON.stringify(ddlContainer.command) === '["python","-m","app.core.init_db"]', 'DDL Job command must be exactly python -m app.core.init_db');
  invariant(ddlContainer.args === undefined, 'DDL Job must have no arguments');
  invariant(envValue(ddl, 'DSH_TURN_WORKER_ENABLED') === 'false', 'DDL Job must disable the DSH turn worker');
  invariant(envValue(ddl, 'DATA_QUERY_MAXCOMPUTE_ENABLED') === 'false', 'DDL Job must disable the query executor');

  for (const [name, expected] of Object.entries(expectedPolicySpecs)) {
    const policy = byKindName.get(`NetworkPolicy/${name}`);
    invariant(policy, `NetworkPolicy/${name} is required`);
    assertExact(policy.spec, expected, `NetworkPolicy/${name} must match the exact selector/peer/port allowlist`);
  }
  invariant(resources.filter(document => document.kind === 'NetworkPolicy').length === Object.keys(expectedPolicySpecs).length, 'unexpected NetworkPolicy resource');

  const runtimeManifest = JSON.parse(await readFile(join(root, 'images', 'dsh', 'runtime', 'package.json'), 'utf8'));
  invariant(runtimeManifest !== null && typeof runtimeManifest === 'object'
    && runtimeManifest.dependencies !== null && typeof runtimeManifest.dependencies === 'object',
  'DSH runtime manifest dependencies are required');
  for (const dependency of expectedDshRuntimeDirectDependencies) {
    invariant(runtimeManifest.dependencies[dependency] === 'workspace:^',
      `DSH runtime manifest must directly depend on ${dependency}`);
  }

  const dockerfile = await readFile(join(root, 'images', 'dsh', 'Dockerfile'), 'utf8');
  const runtimeStage = dockerfile.slice(dockerfile.lastIndexOf('\nFROM '));
  invariant(dockerfile.includes('deploy --legacy --prod'), 'DSH build must create a pnpm production deploy closure');
  invariant(dockerfile.includes('prepare-runtime.mjs /runtime'), 'DSH build must prepare and smoke the runtime closure');
  invariant(dockerfile.includes('node --expose-internals /runtime/apps/cli/lib/bin.js --profile data-aid --dump-config'), 'DSH build smoke must enable HMR internals');
  invariant(runtimeStage.includes('node --expose-internals apps/cli/lib/bin.js --profile data-aid --dump-config'), 'DSH final-user smoke must enable HMR internals');
  invariant(runtimeStage.includes('CMD ["node", "--expose-internals", "apps/cli/lib/bin.js", "--profile", "data-aid"]'), 'DSH default command must enable HMR internals');
  invariant(runtimeStage.includes('COPY --from=build --chown=10001:10001 /runtime /runtime'), 'DSH runtime stage must copy only /runtime');
  invariant(!/COPY\s+--from=build[^\n]*\/workspace/u.test(runtimeStage), 'DSH runtime stage cannot copy /workspace');

  const testOverlay = await readFile(join(root, 'overlays', 'test', 'kustomization.yaml'), 'utf8');
  invariant(testOverlay.includes('../../base'), 'test overlay must include the base');
  return { resourceCount: resources.length, networkPolicyCount: Object.keys(expectedPolicySpecs).length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  validateDeploymentArtifacts().then(result => {
    console.log(`controlled-data-query manifest gate passed: ${result.resourceCount} resources, ${result.networkPolicyCount} exact policies`);
  }).catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
