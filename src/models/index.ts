/// <reference types="codeceptjs" />
import type { ReportPortalConfig } from '@reportportal/client-javascript/models';

// Omit drops Mocha's private `_retries`/`_currentRetry`, which the agent reads at runtime.
export interface RpTest extends Omit<CodeceptJS.Test, 'ctx'> {
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
}

type ClientOptions = Pick<
  ReportPortalConfig,
  | 'apiKey'
  | 'endpoint'
  | 'project'
  | 'launch'
  | 'description'
  | 'attributes'
  | 'mode'
  | 'debug'
  | 'restClientConfig'
>;

// Partial: apiKey, endpoint and project may come from RP_* env vars instead.
export interface PluginConfig extends Partial<ClientOptions> {
  rerun?: boolean;
  rerunOf?: string;
}

export type ResolvedConfig = PluginConfig &
  Required<Pick<PluginConfig, 'launch' | 'description' | 'attributes' | 'mode' | 'debug'>>;
