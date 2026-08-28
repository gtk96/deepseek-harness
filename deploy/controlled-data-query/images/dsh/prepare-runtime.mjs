#!/usr/bin/env node

import { cp, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDir, '../../../..');
const deployRoot = join(scriptDir, 'runtime');
const target = resolve(process.argv[2] ?? '/runtime');
const targetModules = join(target, 'node_modules');

function withoutNestedModules(source) {
  const nested = join(source, 'node_modules');
  return path => path !== nested && !path.startsWith(nested + sep);
}

async function restoreDirectDependencies() {
  const manifest = JSON.parse(await readFile(join(deployRoot, 'package.json'), 'utf8'));
  for (const dependency of Object.keys(manifest.dependencies ?? {})) {
    const destination = join(targetModules, dependency);
    try {
      await lstat(destination);
      continue;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    const source = join(deployRoot, 'node_modules', dependency);
    await mkdir(dirname(destination), { recursive: true });
    await cp(source, destination, {
      recursive: true,
      dereference: true,
      filter: withoutNestedModules(source),
    });
  }
}

async function firstSymbolicLink(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) return path;
    if (metadata.isDirectory()) {
      const nested = await firstSymbolicLink(path);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
}

async function materializeLinks() {
  for (const bin of await findNamedDirectories(targetModules, new Set(['.bin']))) {
    await rm(bin, { recursive: true, force: true });
  }
  let link = await firstSymbolicLink(targetModules);
  while (link !== undefined) {
    const source = await realpath(link);
    await rm(link, { recursive: true, force: true });
    await cp(source, link, {
      recursive: true,
      dereference: true,
      filter: withoutNestedModules(source),
    });
    link = await firstSymbolicLink(targetModules);
  }
}

async function findNamedDirectories(directory, names) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(directory, entry.name);
    if (names.has(entry.name)) {
      found.push(path);
      continue;
    }
    found.push(...await findNamedDirectories(path, names));
  }
  return found;
}

async function installCli() {
  const cliRoot = join(target, 'apps', 'cli');
  await mkdir(join(cliRoot, 'config', 'agent-presets'), { recursive: true });
  await cp(join(repositoryRoot, 'apps', 'cli', 'lib'), join(cliRoot, 'lib'), { recursive: true });
  await cp(
    join(repositoryRoot, 'apps', 'cli', 'config', 'agent-presets', 'data-aid'),
    join(cliRoot, 'config', 'agent-presets', 'data-aid'),
    { recursive: true },
  );
  const manifest = JSON.parse(await readFile(join(deployRoot, 'package.json'), 'utf8'));
  manifest.name = '@deepseek-ai/dsh';
  manifest.bin = { dsh: 'lib/bin.js' };
  await writeFile(join(cliRoot, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

async function removeDevelopmentTrees() {
  const ownedRoot = join(targetModules, '@deepseek-ai');
  for (const directory of await findNamedDirectories(ownedRoot, new Set(['src', 'test', 'tests', '__tests__']))) {
    await rm(directory, { recursive: true, force: true });
  }
  for (const directory of await findNamedDirectories(targetModules, new Set(['test', 'tests', '__tests__']))) {
    await rm(directory, { recursive: true, force: true });
  }
}

await restoreDirectDependencies();
await materializeLinks();
await installCli();
await removeDevelopmentTrees();
