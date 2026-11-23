import type { PluginConfig, ResolvedConfig } from './models';

const ENV_FALLBACKS = {
  apiKey: 'RP_API_KEY',
  endpoint: 'RP_ENDPOINT',
  project: 'RP_PROJECT',
  launch: 'RP_LAUNCH',
} as const;

// Deprecated option names and their replacements.
const LEGACY_OPTIONS: Record<string, keyof PluginConfig> = {
  token: 'apiKey',
  projectName: 'project',
  launchName: 'launch',
  launchDescription: 'description',
  launchAttributes: 'attributes',
};

export const requiredFields: Array<keyof ResolvedConfig> = ['apiKey', 'endpoint', 'project'];

const isSet = (value: unknown): boolean => value !== undefined && value !== '';

// Explicit config wins; the env var is a fallback; empty strings count as unset.
function pick<T>(explicit: T, envVar: string | undefined, defaultValue: T): T | string {
  if (isSet(explicit)) return explicit;
  if (envVar && isSet(process.env[envVar])) return process.env[envVar] as string;
  return defaultValue;
}

// Maps deprecated names onto their replacements (a new name wins) and warns.
function withLegacyOptions(config: PluginConfig): PluginConfig {
  const merged: PluginConfig = { ...config };
  Object.keys(LEGACY_OPTIONS).forEach((legacy) => {
    if (config[legacy] === undefined) return;
    const modern = LEGACY_OPTIONS[legacy];
    // eslint-disable-next-line no-console
    console.warn(`Option '${legacy}' is deprecated. Use '${modern}' instead.`);
    if (merged[modern] === undefined) merged[modern] = config[legacy];
  });
  return merged;
}

export function resolveConfig(rawConfig: PluginConfig = {}): ResolvedConfig {
  const config = withLegacyOptions(rawConfig);
  return {
    apiKey: pick(config.apiKey, ENV_FALLBACKS.apiKey, undefined) as string | undefined,
    endpoint: pick(config.endpoint, ENV_FALLBACKS.endpoint, undefined) as string | undefined,
    project: pick(config.project, ENV_FALLBACKS.project, undefined) as string | undefined,
    launch: pick(config.launch, ENV_FALLBACKS.launch, 'codeceptjs tests') as string,
    description: config.description !== undefined ? config.description : '',
    attributes: config.attributes !== undefined ? (config.attributes as unknown[]) : [],
    mode: config.mode !== undefined ? config.mode : 'DEFAULT',
    debug: config.debug !== undefined ? (config.debug as boolean) : false,
    rerun: config.rerun as boolean | undefined,
    rerunOf: config.rerunOf as string | undefined,
    restClientConfig: config.restClientConfig,
  };
}
