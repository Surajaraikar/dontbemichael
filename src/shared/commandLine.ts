/** Split a command string into argv, respecting double/single quotes so a model
 *  value with spaces (agy's `--model "Gemini 3.1 Pro (High)"`) stays one token.
 *  Quotes are stripped from the result.
 *
 *  Shared because BOTH sides split command lines: the renderer's spawn flows
 *  (AddAgentModal, restore, command center) and main's god-hired-worker path
 *  (processSpawnRequest). They used to carry byte-identical copies, which is an
 *  invitation for the two to drift — and a worker whose command line splits
 *  differently from the renderer's is exactly the class of silent breakage the
 *  spawn-request fix exists to prevent. */
export function tokenizeCommand(command: string): string[] {
  const out: string[] = [];
  // Adjacent quoted/unquoted segments belong to one argument (--model="a b").
  // Backslashes are literal: these are stored argv, not shell source, and a
  // Windows path must survive without needing shell-specific escaping.
  const re = /(?:"[^"]*"|'[^']*'|[^\s"']+|["'])+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(command)) !== null) {
    out.push(m[0].replace(/"([^"]*)"|'([^']*)'/g, (_match, double: string | undefined, single: string | undefined) => double ?? single ?? ''));
  }
  return out;
}

/** Encode for tokenizeCommand, NOT for execution by a shell. */
export function formatCommand(args: readonly string[]): string {
  return args.map((arg) => {
    if (arg && !/[\s"']/.test(arg)) return arg;
    // A literal double quote is a single-quoted segment between double-quoted
    // pieces. This also preserves arguments containing both kinds of quote.
    return '"' + arg.split('"').join('"\'"\'"') + '"';
  }).join(' ');
}

/** Only inspect options before the CLI's end-of-options delimiter. */
export function hasCommandOption(args: readonly string[], flag: string): boolean {
  const name = flag.split('=')[0];
  if (!name) return false;
  for (const arg of args) {
    if (arg === '--') break;
    if (arg === name || arg.startsWith(`${name}=`)) return true;
  }
  return false;
}

/** Defaults must remain options even when a positional prompt follows `--`. */
export function appendCommandOptions(args: readonly string[], extra: readonly string[]): string[] {
  const end = args.indexOf('--');
  const at = end < 0 ? args.length : end;
  return [...args.slice(0, at), ...extra, ...args.slice(at)];
}
