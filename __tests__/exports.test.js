/* eslint-env node, jest */
/* eslint-disable
   global-require,
   import/no-dynamic-require,
   import/extensions,
   no-underscore-dangle
*/

jest.mock('@reportportal/client-javascript', () => jest.fn());

function makeCodeceptStub() {
  const handlers = new Map();
  return {
    handlers,
    codeceptjs: {
      event: {
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
      },
      recorder: { add: (fn) => (typeof fn === 'function' ? fn() : undefined) },
      output: {
        log: () => {}, debug: () => {}, error: () => {}, print: () => {},
      },
      container: { helpers: () => ({}) },
    },
  };
}

function makeRpClientImpl() {
  return () => ({
    startLaunch: jest.fn(() => ({ tempId: 'launch-tmp', promise: Promise.resolve({}) })),
    finishLaunch: jest.fn(() => ({ promise: Promise.resolve({}) })),
    startTestItem: jest.fn(() => ({ tempId: 'item-tmp', promise: Promise.resolve({}) })),
    finishTestItem: jest.fn(() => ({ promise: Promise.resolve({}) })),
    sendLog: jest.fn(() => ({ promise: Promise.resolve({}) })),
    helpers: { now: () => 1700000000000 },
  });
}

function loadFromSrc() {
  jest.resetModules();
  const ctx = makeCodeceptStub();
  global.codeceptjs = ctx.codeceptjs;
  const RPClient = require('@reportportal/client-javascript');
  RPClient.mockImplementation(makeRpClientImpl());
  // eslint-disable-next-line import/no-unresolved
  const mod = require('../src');
  return { ...ctx, mod };
}

describe('src/index exported module (TS `export =` shape)', () => {
  afterEach(() => {
    delete global.codeceptjs;
    jest.resetModules();
  });

  test('the exported value is a plain function — the CodeceptJS plugin factory', () => {
    const { mod } = loadFromSrc();
    expect(typeof mod).toBe('function');
  });

  test('the exported value is NOT an ESM-style object with a .default property', () => {
    const { mod } = loadFromSrc();
    expect(mod).not.toHaveProperty('default');
    expect(mod.default).toBeUndefined();
  });

  test('src/index re-exports the exact same factory function as src/plugin', () => {
    jest.resetModules();
    const ctx = makeCodeceptStub();
    global.codeceptjs = ctx.codeceptjs;
    const RPClient = require('@reportportal/client-javascript');
    RPClient.mockImplementation(makeRpClientImpl());
    // eslint-disable-next-line import/no-unresolved
    const fromIndex = require('../src');
    // eslint-disable-next-line import/no-unresolved
    const fromPlugin = require('../src/plugin');
    expect(fromIndex).toBe(fromPlugin);
  });

  test('invoking the factory with valid config returns an object with addLog()', () => {
    const { mod } = loadFromSrc();
    const api = mod({
      apiKey: 'k',
      endpoint: 'https://rp/api/v1',
      project: 'proj',
    });
    expect(api).toBeDefined();
    expect(typeof api.addLog).toBe('function');
  });

  test('invoking the factory registers event-dispatcher handlers for the full lifecycle', () => {
    const ctx = loadFromSrc();
    ctx.mod({
      apiKey: 'k',
      endpoint: 'https://rp/api/v1',
      project: 'proj',
    });
    const expectedEvents = [
      'event.all.before',
      'event.all.result',
      'event.suite.before',
      'event.suite.after',
      'event.test.before',
      'event.test.after',
      'event.test.failed',
      'event.test.passed',
      'event.step.before',
      'event.step.after',
      'event.step.failed',
      'event.step.passed',
    ];
    for (const name of expectedEvents) {
      expect(ctx.handlers.get(name)).toBeDefined();
      expect(ctx.handlers.get(name).length).toBeGreaterThan(0);
    }
  });
});
