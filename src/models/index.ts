// Side-effect type import: pulls in the ambient `CodeceptJS` namespace
// (declared globally by CodeceptJS's bundled `typings/index.d.ts`), so
// `CodeceptJS.Test`, `CodeceptJS.Suite`, and `CodeceptJS.Step` are available
// project-wide without listing `"codeceptjs"` under
// `tsconfig.compilerOptions.types` (there is no `@types/codeceptjs`).
// The `type` keyword ensures this does not compile to a runtime require.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type * as _codeceptjs from 'codeceptjs';

// `global.output_dir` is already declared in CodeceptJS's bundled typings
// (`typings/index.d.ts`) as `declare const output_dir: string`; we re-use that
// ambient declaration from `src/plugin.ts` by referencing the identifier
// directly (without the `global.` prefix) to stay compatible with
// `typeof globalThis`, which does not carry the CodeceptJS augmentation.

/**
 * CodeceptJS's Test with the ad-hoc fields the agent writes onto it at runtime
 * (tempId, retriedTitle, startTime/endTime, _retries/_currentRetry, ctx.test).
 * CodeceptJS's own `Test` doesn't declare them, so `strict: true` / `noImplicitAny: true`
 * would reject the assignments without this extension.
 */
export interface RpTest extends CodeceptJS.Test {
  tempId?: string;
  retriedTitle?: string;
  endTime?: number;
  startTime?: number;
  _retries?: number;
  _currentRetry?: number;
  ctx?: { test?: RpTest };
}

export interface RpSuite extends CodeceptJS.Suite {
  tempId?: string;
  endTime?: number;
}

export interface RpStep extends CodeceptJS.Step {
  tempId?: string;
  startTime?: number;
  endTime?: number;
  // `status`, `args`, and `metaStep` are inherited from CodeceptJS's `Step`
  // (declared on the base class as `string`, `any[]`, and `any` respectively);
  // we don't redeclare them to avoid a variance conflict with the base type.
}

/** Raw plugin configuration as handed in by the user. */
export interface PluginConfig {
  apiKey?: string;
  endpoint?: string;
  project?: string;
  launch?: string;
  description?: string;
  attributes?: unknown[];
  mode?: string;
  debug?: boolean;
  rerun?: boolean;
  rerunOf?: string;
  restClientConfig?: unknown;
  // Deprecated aliases — still accepted, warned about by `withLegacyOptions`.
  token?: string;
  projectName?: string;
  launchName?: string;
  launchDescription?: string;
  launchAttributes?: unknown[];
  // Open-shape fallback for forward-compat options not listed above.
  [key: string]: unknown;
}

/** Result of `resolveConfig` — only the modern option surface, with defaults filled in. */
export interface ResolvedConfig {
  apiKey: string | undefined;
  endpoint: string | undefined;
  project: string | undefined;
  launch: string;
  description: string;
  attributes: unknown[];
  mode: string;
  debug: boolean;
  rerun: boolean | undefined;
  rerunOf: string | undefined;
  restClientConfig: unknown;
}

/** Screenshot payload passed back to the client's `sendLog`. */
export interface ScreenshotFile {
  name: string;
  type: string;
  content: Buffer;
}
