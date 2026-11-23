/* eslint-env node, jest */
/* eslint-disable
   global-require,
   import/no-dynamic-require,
   import/extensions,
   no-underscore-dangle
*/

/**
 * Unit tests for EPMRPP-122058:
 *   Migrate the agent to TypeScript.
 *
 * Covers the AC "No behaviour change for users" and the design's chief
 * migration risk: the compiled module.exports must stay a plain factory
 * function so CodeceptJS's `require:` plugin loader can invoke it
 * (`require('@reportportal/agent-js-codecept')(config)`). `export default`
 * in TS would compile to `module.exports.default = …` under
 * `module: commonjs` and break the loader (design §5 and Risks).
 *
 * All data is deterministic — the only side-effect is stubbing the
 * `codeceptjs` global (torn down in afterEach).
 */

jest.mock('@reportportal/client-javascript', () => jest.fn());

// --------------------------------------------------------------------------
// Deterministic mock factories (minimal — exports shape only)
// --------------------------------------------------------------------------

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

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

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
    // `export default` in TS under `module: commonjs` compiles to
    // `module.exports.default = …`, which breaks CodeceptJS's
    // `require:` plugin loader. Guard against that regression here.
    const { mod } = loadFromSrc();
    expect(mod).not.toHaveProperty('default');
    // The __esModule flag — present on TS `export default` output — must
    // also be absent (ts-jest sets it on ESM-emitted modules, not CJS).
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
    // `src/index.ts` is a one-liner: `export = require('./plugin')`.
    // Both requires must resolve to the identical function reference.
    expect(fromIndex).toBe(fromPlugin);
  });

  test('invoking the factory with valid config returns an object with addLog()', () => {
    // The factory's return value is the public plugin API consumed by
    // user code (`addLog`). Shape must survive the TS migration unchanged.
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
    // Guards against a transcription regression where the TS port
    // accidentally drops one of the handler registrations.
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
