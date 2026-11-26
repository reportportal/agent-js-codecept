/* eslint-env node, jest */
/* eslint-disable
   global-require,
   import/no-dynamic-require,
   import/extensions,
   no-restricted-syntax,
   no-await-in-loop,
   no-underscore-dangle
*/

jest.mock('@reportportal/client-javascript', () => jest.fn());

const ENV_KEYS = ['RP_API_KEY', 'RP_ENDPOINT', 'RP_PROJECT', 'RP_LAUNCH', 'RP_LAUNCH_ID'];

function clearRpEnv() {
  ENV_KEYS.forEach((key) => {
    delete process.env[key];
  });
}

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

function loadPlugin() {
  jest.resetModules();
  const ctx = makeCodeceptStub();
  global.codeceptjs = ctx.codeceptjs;

  // Re-require the mocked client AFTER resetModules so we grab the
  // fresh jest.fn() that will be used by the fresh plugin require.
  const RPClient = require('@reportportal/client-javascript');
  RPClient.mockImplementation(makeRpClientImpl());

  const factory = require('../src');
  return { ...ctx, RPClient, factory };
}

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

describe('config resolution', () => {
  beforeEach(() => {
    clearRpEnv();
  });

  afterAll(() => {
    clearRpEnv();
    delete global.codeceptjs;
  });

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
  });

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

    test('explicit apiKey takes precedence over RP_API_KEY', async () => {
      process.env.RP_API_KEY = 'env-key';
      const { RPClient } = await registerAndStart({
        apiKey: 'explicit-key',
        endpoint: 'https://rp/api/v1',
        project: 'proj',
      });
      expect(RPClient).toHaveBeenCalledTimes(1);
      expect(RPClient.mock.calls[0][0].apiKey).toBe('explicit-key');
    });

    test('explicit endpoint takes precedence over RP_ENDPOINT', async () => {
      process.env.RP_ENDPOINT = 'https://env.rp/api/v1';
      const { RPClient } = await registerAndStart({
        apiKey: 'k',
        endpoint: 'https://explicit.rp/api/v1',
        project: 'proj',
      });
      expect(RPClient.mock.calls[0][0].endpoint).toBe('https://explicit.rp/api/v1');
    });

    test('explicit project takes precedence over RP_PROJECT', async () => {
      process.env.RP_PROJECT = 'env-project';
      const { RPClient } = await registerAndStart({
        apiKey: 'k',
        endpoint: 'https://rp/api/v1',
        project: 'explicit-project',
      });
      expect(RPClient.mock.calls[0][0].project).toBe('explicit-project');
    });

    test('explicit launch takes precedence over RP_LAUNCH', async () => {
      process.env.RP_LAUNCH = 'env-launch';
      const { RPClient } = await registerAndStart({
        apiKey: 'k',
        endpoint: 'https://rp/api/v1',
        project: 'proj',
        launch: 'explicit-launch',
      });
      expect(RPClient.mock.calls[0][0].launch).toBe('explicit-launch');
    });

    test('RP_LAUNCH is used when no launch is configured', async () => {
      process.env.RP_LAUNCH = 'env-launch';
      const { RPClient } = await registerAndStart({
        apiKey: 'k',
        endpoint: 'https://rp/api/v1',
        project: 'proj',
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
      expect(args.restClientConfig).toBe(restClientConfig);
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

  describe('RPClient construction', () => {
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

  describe('config resolution is pure (no module-level mutation)', () => {
    test('attributes from one factory call do not leak into the next', async () => {
      const first = await registerAndStart({
        apiKey: 'k',
        endpoint: 'https://rp/api/v1',
        project: 'proj',
        attributes: [{ key: 'first', value: '1' }],
      });
      const firstOpts = first.RPClient.mock.results[0].value.startLaunch.mock.calls[0][0];
      expect(firstOpts.attributes).toEqual([{ key: 'first', value: '1' }]);

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
