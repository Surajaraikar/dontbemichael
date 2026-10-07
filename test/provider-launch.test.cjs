'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');
const { buildProviderLaunchArgs, providerPreset, inferAgentProvider, BUILD_ENGINES } = loadTs('src/shared/agentProvider.ts');
const { tokenizeCommand, formatCommand } = loadTs('src/shared/commandLine.ts');
const { buildWorkerLaunch } = loadTs('src/main/workerLaunch.ts');
const { buildSpawnCommand } = loadTs('src/renderer/src/store/config.ts');

test('explicit models and permission stances survive both option forms and repeated construction', () => {
  for (const [provider, stance] of [['claude', '--permission-mode'], ['codex', '--sandbox'], ['gemini', '--approval-mode']]) {
    for (const args of [
      ['--model', 'chosen', stance, 'explicit'],
      ['--model=chosen', `${stance}=explicit`],
      ['--model=', `${stance}=explicit`]
    ]) {
      const original = [...args];
      const built = buildProviderLaunchArgs(provider, args, { model: 'fallback', autoMode: true });
      assert.deepEqual(built, original);
      assert.deepEqual(buildProviderLaunchArgs(provider, built, { model: 'fallback', autoMode: true }), original);
      assert.deepEqual(args, original, 'input is not mutated');
    }
  }
});

test('model syntax and support come from the existing preset', () => {
  const preset = providerPreset('custom');
  const saved = { supportsModel: preset.supportsModel, modelFlag: preset.modelFlag };
  try {
    // A future provider need only describe its syntax; no builder branch needed.
    preset.supportsModel = true;
    preset.modelFlag = '--engine-model';
    assert.deepEqual(buildProviderLaunchArgs('custom', [], { model: 'local/a', autoMode: true }), ['--engine-model', 'local/a']);
    assert.deepEqual(buildProviderLaunchArgs('custom', ['--engine-model=chosen'], { model: 'other', autoMode: false }), ['--engine-model=chosen']);
    assert.deepEqual(buildWorkerLaunch({ requestCommand: 'wrapper', requestProvider: 'custom', requestModel: 'local/a', autoMode: false }).args, ['--engine-model', 'local/a']);
  } finally {
    preset.supportsModel = saved.supportsModel;
    if (saved.modelFlag === undefined) delete preset.modelFlag;
    else preset.modelFlag = saved.modelFlag;
  }
  assert.deepEqual(buildProviderLaunchArgs('custom', ['--user-option'], { model: 'ignored', autoMode: true }), ['--user-option']);
});

test('default argv is identical through renderer and workers for Claude, Codex and Gemini', () => {
  for (const [provider, defaults] of [
    ['claude', ['--permission-mode', 'bypassPermissions']],
    ['codex', ['-a', 'never', '-s', 'workspace-write']],
    ['gemini', ['--approval-mode=yolo']]
  ]) {
    for (const autoMode of [true, false]) {
      const rendered = buildSpawnCommand({ defaultCommand: provider, autoMode }, 'chosen', provider);
      const worker = buildWorkerLaunch({ requestCommand: provider, requestModel: 'chosen', autoMode });
      const expected = ['--model', 'chosen', ...(autoMode ? defaults : [])];
      assert.deepEqual(tokenizeCommand(rendered), [provider, ...expected]);
      assert.deepEqual(worker.args, expected);
      assert.deepEqual(tokenizeCommand(worker.command), [worker.bin, ...worker.args], 'persisted command matches actual launch');
      assert.deepEqual(buildProviderLaunchArgs(provider, worker.args, { model: 'fallback', autoMode }), expected, 'main/restore augmentation is idempotent');
    }
  }
  assert.deepEqual(BUILD_ENGINES, ['claude']);
});

test('renderer respects explicit choices in the configured Claude command', () => {
  const command = 'claude --model=chosen --permission-mode=plan';
  const config = { defaultCommand: command, autoMode: true };
  assert.equal(buildSpawnCommand(config, 'fallback'), command);
  const worker = buildWorkerLaunch({ requestCommand: command, requestModel: 'fallback', autoMode: true });
  assert.deepEqual(tokenizeCommand(buildSpawnCommand(config, 'fallback')), [worker.bin, ...worker.args]);
});

test('alternative and partial permission stances never acquire conflicting defaults', () => {
  for (const [provider, args] of [
    ['claude', ['--dangerously-skip-permissions']],
    ['codex', ['--ask-for-approval=on-request']],
    ['codex', ['-s', 'read-only']],
    ['codex', ['--full-auto']],
    ['gemini', ['--yolo']],
    ['copilot', ['--allow-all-tools']],
    ['cursor', ['--trust']]
  ]) {
    assert.deepEqual(buildProviderLaunchArgs(provider, args, { autoMode: true }), args);
  }
  assert.deepEqual(buildProviderLaunchArgs('claude', ['--permission-mode-extra=plan'], { autoMode: true }),
    ['--permission-mode-extra=plan', '--permission-mode', 'bypassPermissions']);
});

test('quoted executable paths retain their provider and argv on all platforms', () => {
  for (const [command, provider, bin] of [
    ['"C:\\Program Files\\Agent CLI\\codex.exe" --model=chosen', 'codex', 'C:\\Program Files\\Agent CLI\\codex.exe'],
    ["'/Applications/Agent CLI/bin/gemini' --model=chosen", 'gemini', '/Applications/Agent CLI/bin/gemini'],
    ['"C:\\Program Files\\Agent CLI\\agent.exe" --foo', 'cursor', 'C:\\Program Files\\Agent CLI\\agent.exe'],
    ['/usr/local/bin/claude --foo', 'claude', '/usr/local/bin/claude'],
    ['codex --foo', 'codex', 'codex']
  ]) {
    assert.equal(inferAgentProvider(command), provider);
    const launch = buildWorkerLaunch({ requestCommand: command, autoMode: false });
    assert.equal(launch.bin, bin);
    assert.equal(inferAgentProvider(formatCommand([launch.bin])), provider, 'main receives one already parsed executable');
    assert.deepEqual(tokenizeCommand(launch.command), [launch.bin, ...launch.args]);
  }
  assert.equal(inferAgentProvider('wrapper', 'gemini'), 'gemini');
  assert.equal(inferAgentProvider('unrecognized-tool'), 'custom');
});

test('command serialization preserves whitespace, quotes, empty values and Windows backslashes', () => {
  const args = ['C:\\Program Files\\Agent CLI\\claude.exe', '--model', 'a "quoted" model\'s name', '', 'C:\\trailing\\', '$HOME; echo literal', 'line\nbreak'];
  assert.deepEqual(tokenizeCommand(formatCommand(args)), args);
  assert.deepEqual(tokenizeCommand('claude --model="a b"'), ['claude', '--model=a b']);
  const rendered = buildSpawnCommand({ defaultCommand: formatCommand([args[0]]), autoMode: false }, args[2], 'claude');
  assert.deepEqual(tokenizeCommand(rendered), args.slice(0, 3));
});

test('end-of-options separates prompt text from options and defaults stay before it', () => {
  const args = ['--', '--model=prompt-text', '--permission-mode=prompt-text'];
  assert.deepEqual(buildProviderLaunchArgs('claude', args, { model: 'chosen', autoMode: true }),
    ['--model', 'chosen', '--permission-mode', 'bypassPermissions', ...args]);
});

test('resume subcommands, ids and prompts retain their relative order', () => {
  for (const [provider, args] of [
    ['codex', ['resume', 'session-id', '--model=chosen', '-a', 'never', 'continue the task']],
    ['claude', ['--resume', 'session-id', '--model', 'chosen', '--permission-mode=plan']],
    ['gemini', ['--resume', 'session-id', '--model=chosen', '--approval-mode=plan']]
  ]) {
    assert.deepEqual(buildProviderLaunchArgs(provider, args, { model: 'fallback', autoMode: true }), args);
  }
});

test('worker input guards retain defaults and do not synthesize custom model flags', () => {
  const launch = buildWorkerLaunch({ requestCommand: 42, requestModel: {}, requestProvider: 'invalid', defaultCommand: 'gemini', autoMode: false });
  assert.equal(launch.bin, 'gemini');
  assert.deepEqual(launch.args, []);
  assert.deepEqual(buildWorkerLaunch({ requestCommand: 'wrapper', requestModel: 'ignored', autoMode: true }).args, []);
  // An incomplete explicit option is still explicit. Leave validation to the
  // CLI rather than silently replacing a user's malformed configuration.
  assert.deepEqual(buildProviderLaunchArgs('claude', ['--model'], { model: 'fallback', autoMode: false }), ['--model']);
});
