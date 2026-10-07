# Provider-Aware Launch Construction

## Problem

The repository already has a provider registry in `src/shared/agentProvider.ts`.
The gap was inconsistent use of that registry: renderer launches appended model
and automatic permission flags unconditionally, workers hardcoded `--model`, and
main's Claude defaults did not recognize `--model=value`. Provider inference and
main's executable probes also split paths on whitespace.

## Enhancement

`buildProviderLaunchArgs` extends the existing shared provider module. Renderer
commands, background workers and main-process defaults reuse it. Explicit options
win over defaults, provider metadata controls model support and syntax, and
repeated construction is idempotent. Worker display/persisted commands now include
the separately supplied model, matching the executable arguments used at launch.

## Design Decisions

- Keep the existing registry and use `supportsModel`, `modelFlag`, `autoModeFlag`
  and `autoStanceTokens`; no new provider framework or dependencies.
- Keep quoting, tokenization and option matching in `shared/commandLine.ts`.
  The command format represents argv, not shell source: backslashes stay literal
  and no variable expansion, substitution or shell execution is introduced.
- Main receives an already parsed executable and probes it intact. The hidden
  Claude helper also uses shared tokenization when reading its configured command.
- Main applies permission defaults before hook/prompt augmentation, including
  restored and main-only agents. Claude keeps its existing role-model precedence
  and installed-CLI model fallback.
- Session lookup, resume ordering, hook installation, credentials, environment
  handling, executable detection and PTY implementation retain their owners.
- Recognize alternative permission names already supported by the CLI:
  Claude's `--dangerously-skip-permissions` and Gemini's `--yolo`. References:
  [Claude CLI](https://code.claude.com/docs/en/cli-reference) and
  [Gemini CLI](https://geminicli.com/docs/cli/cli-reference/).

## Edge Cases

- Both `--model value` and `--model=value` prevent a second model argument.
  Even an empty explicit value is retained for the CLI to validate.
- Split and equals-form permission options prevent automatic overrides. An
  existing part of a multi-option automatic preset prevents adding that preset
  again. Already contradictory user-supplied options are not rewritten.
- Quoted Windows/macOS/Linux executable paths preserve spaces. Command
  serialization round-trips empty values, embedded quotes and backslashes.
- Provider model support and flag names come from metadata, including providers
  with no model flag. CLI aliases absent from metadata are not inferred.
- `--` ends option detection; generated defaults are inserted before it.
- Resume arguments and positional session IDs/prompts retain their order. The
  main process still owns Claude transcript seeding and Codex home/session lookup.
  End-to-end authenticated resume was not exercised.
- Binary-selection policy stays with callers: renderer non-Claude presets use
  their preset binary; workers may supply explicit wrappers. Hidden Claude jobs
  retain their intentionally fixed model, permission and tool policy.

## Testing

`test/provider-launch.test.cjs` adds behavioral coverage for explicit models and
permissions, provider-specific metadata, renderer/worker parity, default argv for
Claude/Codex/Gemini, quoting, end-of-options, resume argument preservation and
malformed worker input. Existing provider and worker regressions remain in place.

Two existing test fixtures were adapted without removing assertions:
`agent-provider.test.cjs` includes the new shared import in its transpilation set;
`model-cli-floor.test.cjs` checks that the shared model builder precedes the
existing installed-CLI fallback.

Commands executed:

```text
npm ci --ignore-scripts
npm rebuild
npm run postinstall
npm run typecheck
node --test test/provider-launch.test.cjs test/provider-config.test.cjs test/worker-launch.test.cjs test/worker-permission-parity.test.cjs test/agent-provider.test.cjs test/model-cli-floor.test.cjs
npm run test:focused
npm run build
git diff --check
```

- Dependency download succeeded. Native setup was attempted separately:
  `npm rebuild` failed on better-sqlite3 and `npm run postinstall` failed rebuilding
  node-pty because a usable Visual Studio C++ toolchain was unavailable.
- Typecheck: both node and web checks passed.
- Focused behavioral/regression run: **49 passed, 0 failed** (10 new tests).
- Full `test:focused`: **1,832 passed, 101 failed, 24 skipped** (1,957 total).
  An untouched detached checkout at `c2427789`, using the same dependencies,
  produced **1,822 passed, 101 failed, 24 skipped** (1,947 total).
  The failing test-name sets were identical: **no new failures**. Existing
  failures include LF-specific source assertions on a CRLF checkout, Windows
  symlink permissions and unavailable native/Electron runtime dependencies.
  The full suite is not green; these failures were not suppressed or repaired
  as part of this scoped enhancement.
- Build: passed, including main, preload, renderer and copying main assets.
- Whitespace validation: `git diff --check` passed.
- Lint not run: repository does not define a lint script. There is no `test`
  script; `test:focused` is the repository's complete Node test runner.

## Compatibility

Claude retains its model defaults, permission default and CLI-version fallback;
explicit settings now win consistently. Codex retains its approval/sandbox
defaults and resume subcommand. Gemini retains its approval-mode default and
interactive/hook configuration. `BUILD_ENGINES` remains `['claude']`.

Validation ran on Windows with Node 24.17.0. Tests exercise Windows and POSIX path
strings without depending on the host platform. No live provider authentication,
Electron UI smoke test, or macOS/Linux runtime test is claimed.

## Future Improvements

Provider readiness diagnostics and deeper product-level integration parity are
separate follow-ups. Additional CLI aliases can be added to provider metadata as
their contracts are verified.
