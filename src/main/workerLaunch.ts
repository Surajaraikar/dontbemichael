/**
 * How a god-hired worker's spawn request becomes an executable + argv, as a
 * pure function: this exact translation silently killed real workers for days
 * while reporting success, which is what earned it a unit test.
 */
import { buildProviderLaunchArgs, inferAgentProvider } from '../shared/agentProvider';
import { formatCommand, tokenizeCommand } from '../shared/commandLine';

export interface WorkerLaunch {
  /** The executable name alone — what the PTY layer resolves and spawns. */
  bin: string;
  /** Everything else, in argv form, model flag included when applicable. */
  args: string[];
  /** The full effective command line, for display and floor cards. */
  command: string;
}

export function buildWorkerLaunch(opts: {
  /** `command` from the spawn request — god authors a full command LINE. */
  requestCommand?: unknown;
  requestProvider?: unknown;
  /** Separate `model` field from the request, if any. */
  requestModel?: unknown;
  defaultCommand?: string;
  /** The app's auto (skip-permissions) setting. */
  autoMode: boolean;
}): WorkerLaunch {
  const command =
    typeof opts.requestCommand === 'string' && opts.requestCommand.trim()
      ? opts.requestCommand.trim()
      : (opts.defaultCommand ?? 'claude');
  const provider = inferAgentProvider(command, opts.requestProvider);
  const [bin = '', ...existingArgs] = tokenizeCommand(command);
  const model = typeof opts.requestModel === 'string' ? opts.requestModel.trim() : undefined;
  const args = buildProviderLaunchArgs(provider, existingArgs, { model, autoMode: opts.autoMode });
  // Persist exactly what will be launched so restore does not lose a separately
  // supplied model or disagree with the original worker's permission posture.
  return { bin, args, command: formatCommand([bin, ...args]) };
}
