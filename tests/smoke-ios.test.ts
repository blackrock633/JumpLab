import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test, { type TestContext } from 'node:test';

const script = resolve('scripts/smoke-ios.sh');
const app = '.cache/DerivedData/Build/Products/Debug-iphonesimulator/JumpLab.app';
const result = '.cache/LaunchSmoke.xcresult';

function fixture(t: TestContext) {
  mkdirSync('.cache/tests', { recursive: true });
  const cwd = resolve(mkdtempSync('.cache/tests/smoke-'));
  t.after(() => rmSync(cwd, { recursive: true }));
  mkdirSync(`${cwd}/${app}`, { recursive: true });
  writeFileSync(`${cwd}/xcrun`, `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> calls
if [ "$2" = getenv ]; then
  test "$BOOTED" = yes
fi
`, { mode: 0o755 });
  writeFileSync(`${cwd}/xcodebuild`, `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> calls
test ! -e ${result}
mkdir ${result}
`, { mode: 0o755 });
  return {
    cwd,
    addBinary() {
      writeFileSync(`${cwd}/${app}/JumpLab`, '', { mode: 0o755 });
    },
    run(booted = 'yes') {
      return spawnSync('sh', [script], {
        cwd, encoding: 'utf8',
        env: { ...process.env, PATH: `${cwd}:${process.env.PATH}`, JUMPLAB_SIMULATOR_UDID: 'smoke-test', BOOTED: booted },
      });
    },
    calls() {
      return readFileSync(`${cwd}/calls`, 'utf8').trim().split('\n');
    },
  };
}

test('simulator smoke requires an executable app before calling simctl', t => {
  const smoke = fixture(t);
  const run = smoke.run();
  assert.equal(run.status, 2);
  assert.match(run.stderr, /npm run build:ios:simulator/);
  assert.equal(existsSync(`${smoke.cwd}/calls`), false);
});

test('simulator smoke rejects a directory in place of the app executable', t => {
  const smoke = fixture(t);
  mkdirSync(`${smoke.cwd}/${app}/JumpLab`);
  const run = smoke.run();
  assert.equal(run.status, 2);
  assert.match(run.stderr, /npm run build:ios:simulator/);
  assert.equal(existsSync(`${smoke.cwd}/calls`), false);
});

test('simulator smoke tells the user to boot the target before installing', t => {
  const smoke = fixture(t);
  smoke.addBinary();
  const run = smoke.run('no');
  assert.equal(run.status, 2);
  assert.match(run.stderr, /Boot simulator smoke-test/);
  assert.deepEqual(smoke.calls(), ['simctl getenv smoke-test HOME']);
});

test('simulator smoke replaces only its own result bundle on repeated runs', t => {
  const smoke = fixture(t);
  smoke.addBinary();
  const unrelated = `${smoke.cwd}/.cache/Other.xcresult`;
  mkdirSync(unrelated);
  const first = smoke.run();
  assert.equal(first.status, 0, first.stderr);
  writeFileSync(`${smoke.cwd}/${result}/prior-run`, '');
  const second = smoke.run();
  assert.equal(second.status, 0, second.stderr);
  assert.equal(existsSync(unrelated), true);
  assert.equal(existsSync(`${smoke.cwd}/${result}/prior-run`), false);
  const calls = [
    'simctl getenv smoke-test HOME',
    `simctl install smoke-test ${app}`,
    'simctl launch smoke-test app.jumplab.ios',
    `test -workspace ios/JumpLab.xcworkspace -scheme JumpLab -destination id=smoke-test -derivedDataPath .cache/DerivedData -resultBundlePath ${result} -only-testing:JumpLabUITests CODE_SIGNING_ALLOWED=NO`,
  ];
  assert.deepEqual(smoke.calls(), [...calls, ...calls]);
});
