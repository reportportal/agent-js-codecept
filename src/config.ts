import { LAUNCH_MODES } from '@reportportal/client-javascript/constants';
import type { PluginConfig, ResolvedConfig } from './models';

const ENV_FALLBACKS = {
  apiKey: 'RP_API_KEY',
  endpoint: 'RP_ENDPOINT',
  project: 'RP_PROJECT',
  launch: 'RP_LAUNCH',
} as const;

export const requiredFields: Array<keyof ResolvedConfig> = ['apiKey', 'endpoint', 'project'];

const isSet = (value: unknown): boolean => value !== undefined && value !== '';

// An empty string counts as unset, so `RP_LAUNCH=""` still falls through to the default.
function pick(explicit: string | undefined, envVar: string): string | undefined {
  if (isSet(explicit)) return explicit;
  if (isSet(process.env[envVar])) return process.env[envVar];
  return undefined;
}

export function resolveConfig(config: PluginConfig = {}): ResolvedConfig {
  return {
    apiKey: pick(config.apiKey, ENV_FALLBACKS.apiKey),
    endpoint: pick(config.endpoint, ENV_FALLBACKS.endpoint),
    project: pick(config.project, ENV_FALLBACKS.project),
    launch: pick(config.launch, ENV_FALLBACKS.launch) ?? 'codeceptjs tests',
    description: config.description ?? '',
    attributes: config.attributes ?? [],
    mode: config.mode ?? LAUNCH_MODES.DEFAULT,
    debug: config.debug ?? false,
    rerun: config.rerun,
    rerunOf: config.rerunOf,
    restClientConfig: config.restClientConfig,
  };
}
