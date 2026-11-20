import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const fromExpo = createRequire(require.resolve('expo/bin/autolinking'));
const fromCli = createRequire(fromExpo.resolve('@expo/cli/package.json'));
const autolinkingManifest = 'expo-modules-autolinking/package.json';

test('Expo CLI does not pull Zod into the production lock or resolve it at runtime', () => {
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8')) as {
    packages: Record<string, { dev?: boolean }>;
  };
  const productionZod = Object.entries(lock.packages).filter(
    ([path, entry]) => !entry.dev && /(?:^|\/)node_modules\/zod$/.test(path),
  );
  assert.deepEqual(productionZod, []);

  assert.equal(fromExpo('@expo/cli/package.json').dependencies?.zod, undefined);
  assert.throws(() => fromCli.resolve('zod'), { code: 'MODULE_NOT_FOUND' });
});

test('the iOS Podfile resolver uses root autolinking and finds the local module', () => {
  const fromPrebuild = createRequire(fromCli.resolve('@expo/prebuild-config/package.json'));
  assert.equal(fromExpo.resolve(autolinkingManifest), require.resolve(autolinkingManifest));
  assert.notEqual(fromPrebuild.resolve(autolinkingManifest), fromExpo.resolve(autolinkingManifest));

  const reactNativeConfig = JSON.parse(execFileSync(process.execPath, [
    '--no-warnings', '--eval', "require('expo/bin/autolinking')",
    'expo-modules-autolinking', 'react-native-config', '--json', '--platform', 'ios',
  ], { cwd: new URL('../ios/', import.meta.url), encoding: 'utf8' }));
  assert.equal(reactNativeConfig.reactNativePath, dirname(require.resolve('react-native/package.json')));

  const appleModules = JSON.parse(execFileSync(process.execPath, [
    '--no-warnings', '--eval', "require('expo/bin/autolinking')",
    'expo-modules-autolinking', 'resolve', '--json', '--platform', 'apple',
  ], { cwd: new URL('../ios/', import.meta.url), encoding: 'utf8' })) as {
    modules: { packageName: string; pods: { podName: string }[] }[];
  };
  const localModule = appleModules.modules.find(module => module.packageName === 'jump-analysis');
  assert.deepEqual(localModule?.pods.map(pod => pod.podName), ['JumpAnalysis']);
});
