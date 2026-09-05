import type { Context } from '@deepseek-ai/cordis';
import { parseCmdline } from '@deepseek-ai/dsh-cmdline';
import { Command } from 'commander';

export const name = 'open-design-startup';
export const inject = ['cmdlineArgs'];
export const OPEN_DESIGN_STARTUP_SERVICE = 'openDesignStartup';

export interface OpenDesignStartupValues {
  mode: 'models' | 'probe' | 'stdio';
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    openDesignStartup?: OpenDesignStartupValues;
  }
}

export function apply(ctx: Context): void {
  const program = new Command()
    .name('dsh --profile open-design')
    .description('Run the OpenDesign JSONL profile adapter.')
    .helpOption('-h, --help', 'show this help')
    .option('--models', 'print the Harness model catalog and exit')
    .option('--probe', 'print profile compatibility and exit')
    .option('--stdio', 'serve one OpenDesign run over JSONL stdio')
    .action((options: { models?: boolean; probe?: boolean; stdio?: boolean }) => {
      const modes = [options.models, options.probe, options.stdio].filter(Boolean);
      if (modes.length !== 1) {
        program.error('error: exactly one of --models, --probe, or --stdio is required');
      }
      let mode: OpenDesignStartupValues['mode'] = 'stdio';
      if (options.models) mode = 'models';
      else if (options.probe) mode = 'probe';
      ctx.provide(OPEN_DESIGN_STARTUP_SERVICE, { mode });
    });
  // SAFETY: dsh-cmdline's d.ts resolves a different commander major than the
  // one this package pins (its `Command.error` API requires >=9). The
  // structural option contract parsed here is version-independent; this
  // assertion records that cross-major seam explicitly instead of leaving it
  // to hoisting order.
  parseCmdline(ctx, program as unknown as Parameters<typeof parseCmdline>[1]);
}
