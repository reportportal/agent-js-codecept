/* eslint-env node, jest */
/* eslint-disable
   global-require,
   import/no-dynamic-require,
   no-restricted-syntax,
   no-await-in-loop,
   no-underscore-dangle
*/

/**
 * Unit tests for EPMRPP-122056:
 *   Update ReportPortal client to 5.6.0 and expose apiKey / proxy /
 *   timeout / retry settings via the modern config surface.
 *
 * These tests exercise the plugin factory (module.exports in index.js)
 * with a stubbed global `codeceptjs` and a mocked
 * `@reportportal/client-javascript`. Everything is deterministic — no
 * timers, no random values, no network.
 */

jest.mock('@reportportal/client-javascript', () => jest.fn());

// --------------------------------------------------------------------------
// Deterministic mock factories
// --------------------------------------------------------------------------

const ENV_KEYS = ['RP_API_KEY', 'RP_ENDPOINT', 'RP_PROJECT', 'RP_LAUNCH', 'RP_LAUNCH_ID'];

function clearRpEnv() {
  ENV_KEYS.forEach((key) => {
    delete process.env[key];
  });
}

/**
 * Build a fresh `codeceptjs` global stub that records every registered
 * dispatcher handler into a Map keyed by event name. Each test creates
 * its own instance so state cannot leak between cases.
 */
function makeCodeceptStub() {
  const handlers = new Map();
  const event = {
    dispatcher: {
      on: (name, listener) => {
        if (!handlers.has(name)) handlers.set(name, []);
        handlers.get(name).push(listener);
      },
    },
    all: { before: 'event.all.before', result: 'event.all.result' },
    suite: { before: 'event.suite.before', after: 'event.suite.after' },
    test: {
      before: 'event.test.before',
      after: 'event.test.after',
      failed: 'event.test.failed',
      passed: 'event.test.passed',
    },
    step: {
      before: 'event.step.before',
      after: 'event.step.after',
      failed: 'event.step.failed',
      passed: 'event.step.passed',
    },
  };

  const recorder = {
    add: (fn) => (typeof fn === 'function' ? fn() : undefined),
  };

  const output = {
    log: () => {},
    debug: () => {},
    error: () => {},
    print: () => {},
  };

  const container = { helpers: () => ({}) };

  return {
    handlers,
    codeceptjs: {
      event,
      recorder,
      output,
      container,
    },
  };
}

/**
 * Build a deterministic RPClient implementation whose instance records
 * every call to startLaunch / finishLaunch / etc. All promises resolve
 * synchronously so no fake timers are needed.
 */
function makeRpClientImpl() {
  const launchResponse = { id: 'launch-1', link: 'http://rp.local/launch/1', number: 1 };
  return (options) => ({
    options,
    startLaunch: jest.fn(() => ({
      tempId: 'launch-tmp',
      promise: Promise.resolve(launchResponse),
    })),
    finishLaunch: jest.fn(() => ({
      promise: Promise.resolve(launchResponse),
    })),
    startTestItem: jest.fn(() => ({
      tempId: 'item-tmp',
      promise: Promise.resolve({ id: 'item-1' }),
    })),
    finishTestItem: jest.fn(() => ({
      promise: Promise.resolve({}),
    })),
    sendLog: jest.fn(() => ({
      promise: Promise.resolve({}),
    })),
    helpers: { now: () => 1700000000000 },
  });
}

/**
 * Reset the module registry, install fresh codeceptjs + RPClient mocks,
 * then require() the plugin factory. Returns everything a test needs.
 */
function loadPlugin() {
  jest.resetModules();
  const ctx = makeCodeceptStub();
  global.codeceptjs = ctx.codeceptjs;

  // Re-require the mocked client AFTER resetModules so we grab the
  // fresh jest.fn() that will be used by the fresh plugin require.
  const RPClient = require('@reportportal/client-javascript');
  RPClient.mockImplementation(makeRpClientImpl());

  const factory = require('../index');
  return { ...ctx, RPClient, factory };
}

/**
 * Register the plugin against a fresh mock environment and (optionally)
 * fire the registered `event.all.before` handler so startLaunch runs.
 */
async function registerAndStart(config, { fireBefore = true } = {}) {
  const ctx = loadPlugin();
  const api = ctx.factory(config);
  if (fireBefore) {
    const handlers = ctx.handlers.get(ctx.codeceptjs.event.all.before) || [];
    for (const h of handlers) {
      await h();
    }
  }
  return { ...ctx, api };
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe('agent-js-codecept — EPMRPP-122056 config resolution', () => {
  beforeEach(() => {
    clearRpEnv();
  });

  afterAll(() => {
    clearRpEnv();
    delete global.codeceptjs;
  });

  // ------------------------------------------------------------------------
  // Required-field validation (AC #2, AC #6, breaking-rename behaviour)
  // ------------------------------------------------------------------------

  describe('required-field validation', () => {
    test('throws when apiKey is missing', () => {
      const { factory } = loadPlugin();
      expect(() => factory({ endpoint: 'https://rp/api/v1', project: 'proj' })).toThrow(/apiKey/);
    });

    test('throws when endpoint is missing', () => {
      const { factory } = loadPlugin();
      expect(() => factory({ apiKey: 'k', project: 'proj' })).toThrow(/endpoint/);
    });

    test('throws when project is missing', () => {
      const { factory } = loadPlugin();
      expect(() => factory({ apiKey: 'k', endpoint: 'https://rp/api/v1' })).toThrow(/project/);
    });

    test('error message lists exactly the three modern required names', () => {
      const { factory } = loadPlugin();
      let caught;
      try {
        factory({});
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(Error);
      expect(caught.message).toMatch(/apiKey/);
      expect(caught.message).toMatch(/endpoint/);
      expect(caught.message).toMatch(/project/);
    });

    test('does not throw when all three required fields are present', () => {
      const { factory } = loadPlugin();
      expect(() => factory({ apiKey: 'k', endpoint: 'https://rp/api/v1', project: 'proj' })).not.toThrow();
    });

    test('legacy "token" is NOT an alias for apiKey (hard break)', () => {
      const { factory } = loadPlugin();
      expect(() => factory({ token: 'legacy-token', endpoint: 'https://rp/api/v1', project: 'proj' })).toThrow(/apiKey/);
    });

    test('legacy "projectName" is NOT an alias for project (hard break)', () => {
      const { factory } = loadPlugin();
      expect(() => factory({ apiKey: 'k', endpoint: 'https://rp/api/v1', projectName: 'legacy-project' })).toThrow(/project/);
    });
  });

  // ------------------------------------------------------------------------
  // Env-variable precedence (AC #4)
  // ------------------------------------------------------------------------

  describe('environment-variable fallbacks', () => {
    test('RP_API_KEY alone satisfies the apiKey required-field check', () => {
      process.env.RP_API_KEY = 'env-key';
      const { factory } = loadPlugin();
      expect(() => factory({ endpoint: 'https://rp/api/v1', project: 'proj' })).not.toThrow();
    });

    test('RP_ENDPOINT alone satisfies the endpoint required-field check', () => {
      process.env.RP_ENDPOINT = 'https://env.rp/api/v1';
      const { factory } = loadPlugin();
      expect(() => factory({ apiKey: 'k', project: 'proj' })).not.toThrow();
    });

    test('RP_PROJECT alone satisfies the project required-field check', () => {
      process.env.RP_PROJECT = 'env-project';
      const { factory } = loadPlugin();
      expect(() => factory({ apiKey: 'k', endpoint: 'https://rp/api/v1' })).not.toThrow();
    });

    test('env var takes precedence over explicit apiKey', async () => {
      process.env.RP_API_KEY = 'env-key';
      const { RPClient } = await registerAndStart({
        apiKey: 'explicit-key',
        endpoint: 'https://rp/api/v1',
        project: 'proj',
      });
      expect(RPClient).toHaveBeenCalledTimes(1);
      expect(RPClient.mock.calls[0][0].apiKey).toBe('env-key');
    });

    test('env var takes precedence over explicit endpoint', async () => {
      process.env.RP_ENDPOINT = 'https://env.rp/api/v1';
      const { RPClient } = await registerAndStart({
        apiKey: 'k',
        endpoint: 'https://explicit.rp/api/v1',
        project: 'proj',
      });
      expect(RPClient.mock.calls[0][0].endpoint).toBe('https://env.rp/api/v1');
    });

    test('env var takes precedence over explicit project', async () => {
      process.env.RP_PROJECT = 'env-project';
      const { RPClient } = await registerAndStart({
        apiKey: 'k',
        endpoint: 'https://rp/api/v1',
        project: 'explicit-project',
      });
      expect(RPClient.mock.calls[0][0].project).toBe('env-project');
    });

    test('env var takes precedence over explicit launch', async () => {
      process.env.RP_LAUNCH = 'env-launch';
      const { RPClient } = await registerAndStart({
        apiKey: 'k',
        endpoint: 'https://rp/api/v1',
        project: 'proj',
        launch: 'explicit-launch',
      });
      expect(RPClient.mock.calls[0][0].launch).toBe('env-launch');
    });

    test('empty-string env var is treated as unset — explicit config wins', async () => {
      process.env.RP_LAUNCH = '';
      const { RPClient } = await registerAndStart({
        apiKey: 'k',
        endpoint: 'https://rp/api/v1',
        project: 'proj',
        launch: 'explicit-launch',
      });
      expect(RPClient.mock.calls[0][0].launch).toBe('explicit-launch');
    });

    test('empty-string env var does not satisfy a missing required field', () => {
      process.env.RP_API_KEY = '';
      const { factory } = loadPlugin();
      expect(() => factory({ endpoint: 'https://rp/api/v1', project: 'proj' })).toThrow(/apiKey/);
    });

    test('with no env and no explicit launch, default "codeceptjs tests" is used', async () => {
      const { RPClient } = await registerAndStart({
        apiKey: 'k',
        endpoint: 'https://rp/api/v1',
        project: 'proj',
      });
      expect(RPClient.mock.calls[0][0].launch).toBe('codeceptjs tests');
    });
  });

  // ------------------------------------------------------------------------
  // restClientConfig passthrough (AC #3)
  // ------------------------------------------------------------------------

  describe('restClientConfig passthrough', () => {
    test('is forwarded to RPClient as the same object (proxy/timeout/retry)', async () => {
      const restClientConfig = {
        proxy: 'http://corp-proxy:8080',
        timeout: 5000,
        retry: { retries: 3, retryDelay: 200 },
        noProxy: 'localhost',
      };
      const { RPClient } = await registerAndStart({
        apiKey: 'k',
        endpoint: 'https://rp/api/v1',
        project: 'proj',
        restClientConfig,
      });
      const args = RPClient.mock.calls[0][0];
      // Identity: no shaping / cloning / validation inside the agent.
      expect(args.restClientConfig).toBe(restClientConfig);
      // Value: nothing was dropped or renamed.
      expect(args.restClientConfig).toEqual({
        proxy: 'http://corp-proxy:8080',
        timeout: 5000,
        retry: { retries: 3, retryDelay: 200 },
        noProxy: 'localhost',
      });
    });

    test('restClientConfig defaults to undefined when the option is absent', async () => {
      const { RPClient } = await registerAndStart({
        apiKey: 'k',
        endpoint: 'https://rp/api/v1',
        project: 'proj',
      });
      expect(RPClient.mock.calls[0][0].restClientConfig).toBeUndefined();
    });
  });

  // ------------------------------------------------------------------------
  // RPClient construction surface (AC #2 / #6)
  // ------------------------------------------------------------------------

  describe('RPClient construction uses only the modern option surface', () => {
    test('legacy "token" passed by the user is never forwarded to the client', async () => {
      const { RPClient } = await registerAndStart({
        apiKey: 'modern-key',
        endpoint: 'https://rp/api/v1',
        project: 'proj',
        token: 'legacy-token-should-be-ignored',
      });
      const args = RPClient.mock.calls[0][0];
      expect(args).not.toHaveProperty('token');
      expect(args.apiKey).toBe('modern-key');
    });

    test('RPClient receives apiKey, endpoint, project, launch, debug and restClientConfig', async () => {
      const { RPClient } = await registerAndStart({
        apiKey: 'k',
        endpoint: 'https://rp/api/v1',
        project: 'proj',
        launch: 'my-launch',
        debug: true,
      });
      const args = RPClient.mock.calls[0][0];
      expect(args.apiKey).toBe('k');
      expect(args.endpoint).toBe('https://rp/api/v1');
      expect(args.project).toBe('proj');
      expect(args.launch).toBe('my-launch');
      expect(args.debug).toBe(true);
      expect(args).toHaveProperty('restClientConfig');
    });

    test('debug defaults to false when not provided', async () => {
      const { RPClient } = await registerAndStart({
        apiKey: 'k',
        endpoint: 'https://rp/api/v1',
        project: 'proj',
      });
      expect(RPClient.mock.calls[0][0].debug).toBe(false);
    });
  });

  // ------------------------------------------------------------------------
  // startLaunch options + defaults (AC #5 / #6)
  // ------------------------------------------------------------------------

  describe('startLaunch options and defaults', () => {
    test('attributes defaults to an empty array', async () => {
      const { RPClient } = await registerAndStart({
        apiKey: 'k',
        endpoint: 'https://rp/api/v1',
        project: 'proj',
      });
      const rp = RPClient.mock.results[0].value;
      expect(rp.startLaunch).toHaveBeenCalledTimes(1);
      expect(rp.startLaunch.mock.calls[0][0].attributes).toEqual([]);
    });

    test('legacy launchAttributes is ignored (not aliased onto attributes)', async () => {
      const { RPClient } = await registerAndStart({
        apiKey: 'k',
        endpoint: 'https://rp/api/v1',
        project: 'proj',
        launchAttributes: [{ key: 'legacy', value: 'yes' }],
      });
      const launchOpts = RPClient.mock.results[0].value.startLaunch.mock.calls[0][0];
      expect(launchOpts.attributes).toEqual([]);
    });

    test('attributes passed explicitly are forwarded unchanged', async () => {
      const attributes = [{ key: 'env', value: 'prod' }, { value: 'smoke' }];
      const { RPClient } = await registerAndStart({
        apiKey: 'k',
        endpoint: 'https://rp/api/v1',
        project: 'proj',
        attributes,
      });
      const launchOpts = RPClient.mock.results[0].value.startLaunch.mock.calls[0][0];
      expect(launchOpts.attributes).toEqual([{ key: 'env', value: 'prod' }, { value: 'smoke' }]);
    });

    test('legacy launchDescription is ignored — description defaults to ""', async () => {
      const { RPClient } = await registerAndStart({
        apiKey: 'k',
        endpoint: 'https://rp/api/v1',
        project: 'proj',
        launchDescription: 'legacy',
      });
      const launchOpts = RPClient.mock.results[0].value.startLaunch.mock.calls[0][0];
      expect(launchOpts.description).toBe('');
    });

    test('description, mode, rerun, rerunOf come from the resolved config', async () => {
      const { RPClient } = await registerAndStart({
        apiKey: 'k',
        endpoint: 'https://rp/api/v1',
        project: 'proj',
        description: 'my-desc',
        mode: 'DEBUG',
        rerun: true,
        rerunOf: 'uuid-abc',
      });
      const launchOpts = RPClient.mock.results[0].value.startLaunch.mock.calls[0][0];
      expect(launchOpts.description).toBe('my-desc');
      expect(launchOpts.mode).toBe('DEBUG');
      expect(launchOpts.rerun).toBe(true);
      expect(launchOpts.rerunOf).toBe('uuid-abc');
    });

    test('mode defaults to "DEFAULT"', async () => {
      const { RPClient } = await registerAndStart({
        apiKey: 'k',
        endpoint: 'https://rp/api/v1',
        project: 'proj',
      });
      const launchOpts = RPClient.mock.results[0].value.startLaunch.mock.calls[0][0];
      expect(launchOpts.mode).toBe('DEFAULT');
    });

    test('legacy launchName is ignored (not aliased onto launch)', async () => {
      const { RPClient } = await registerAndStart({
        apiKey: 'k',
        endpoint: 'https://rp/api/v1',
        project: 'proj',
        launchName: 'legacy-launch',
      });
      // Default must apply because legacy name is ignored.
      expect(RPClient.mock.calls[0][0].launch).toBe('codeceptjs tests');
    });

    test('RP_LAUNCH_ID env attaches id to the launch options (merge-launch wiring)', async () => {
      process.env.RP_LAUNCH_ID = 'external-launch-123';
      const { RPClient } = await registerAndStart({
        apiKey: 'k',
        endpoint: 'https://rp/api/v1',
        project: 'proj',
      });
      const launchOpts = RPClient.mock.results[0].value.startLaunch.mock.calls[0][0];
      expect(launchOpts.id).toBe('external-launch-123');
    });

    test('without RP_LAUNCH_ID the launch options do not carry an id key', async () => {
      const { RPClient } = await registerAndStart({
        apiKey: 'k',
        endpoint: 'https://rp/api/v1',
        project: 'proj',
      });
      const launchOpts = RPClient.mock.results[0].value.startLaunch.mock.calls[0][0];
      expect(launchOpts.id).toBeUndefined();
    });
  });

  // ------------------------------------------------------------------------
  // Non-mutation of module-level defaults (AC #5)
  // ------------------------------------------------------------------------

  describe('config resolution is pure (no module-level mutation)', () => {
    test('attributes from one factory call do not leak into the next', async () => {
      // First call: non-empty attributes.
      const first = await registerAndStart({
        apiKey: 'k',
        endpoint: 'https://rp/api/v1',
        project: 'proj',
        attributes: [{ key: 'first', value: '1' }],
      });
      const firstOpts = first.RPClient.mock.results[0].value.startLaunch.mock.calls[0][0];
      expect(firstOpts.attributes).toEqual([{ key: 'first', value: '1' }]);

      // Second call: no attributes — must get default [], not the first call's value.
      const second = await registerAndStart({
        apiKey: 'k',
        endpoint: 'https://rp/api/v1',
        project: 'proj',
      });
      const secondOpts = second.RPClient.mock.results[0].value.startLaunch.mock.calls[0][0];
      expect(secondOpts.attributes).toEqual([]);
    });

    test('user-supplied config object is not mutated by the factory', () => {
      const userConfig = {
        apiKey: 'k',
        endpoint: 'https://rp/api/v1',
        project: 'proj',
      };
      const snapshot = JSON.parse(JSON.stringify(userConfig));
      const { factory } = loadPlugin();
      factory(userConfig);
      expect(userConfig).toEqual(snapshot);
    });
  });
});
