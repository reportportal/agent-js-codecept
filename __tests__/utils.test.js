/* eslint-env node, jest */
/* eslint-disable
   global-require,
   import/no-dynamic-require,
   import/extensions,
   import/no-unresolved,
   no-restricted-syntax
*/

const { STATUSES } = require('@reportportal/client-javascript/constants');

const {
  iterateMetaSteps,
  metaStepsToArray,
  isEqualMetaStep,
  rpStatus,
} = require('../src/utils');

function makeMetaStep(overrides) {
  return {
    actor: 'I',
    name: 'noop',
    args: [],
    metaStep: undefined,
    tempId: undefined,
    ...overrides,
  };
}

describe('rpStatus', () => {
  test("maps the CodeceptJS 'success' status to STATUSES.PASSED from the client's /constants export", () => {
    expect(rpStatus('success')).toBe(STATUSES.PASSED);
  });

  test("maps the CodeceptJS 'failed' status to STATUSES.FAILED from the client's /constants export", () => {
    expect(rpStatus('failed')).toBe(STATUSES.FAILED);
  });

  test('returns an unmapped status unchanged', () => {
    expect(rpStatus('skipped')).toBe('skipped');
  });

  test('returns undefined when the input is undefined', () => {
    expect(rpStatus(undefined)).toBeUndefined();
  });

  test('does not match on a different casing (the helper is case-sensitive)', () => {
    expect(rpStatus('Success')).toBe('Success');
    expect(rpStatus('FAILED')).toBe('FAILED');
  });
});

describe('iterateMetaSteps', () => {
  test('does nothing when the step is null', () => {
    const visited = [];
    iterateMetaSteps(null, (s) => visited.push(s));
    expect(visited).toEqual([]);
  });

  test('does nothing when the step is undefined', () => {
    const visited = [];
    iterateMetaSteps(undefined, (s) => visited.push(s));
    expect(visited).toEqual([]);
  });

  test('visits a single step with no metaStep exactly once', () => {
    const step = makeMetaStep({ name: 'leaf' });
    const visited = [];
    iterateMetaSteps(step, (s) => visited.push(s.name));
    expect(visited).toEqual(['leaf']);
  });

  test('visits nested meta-steps depth-first, deepest first', () => {
    const inner = makeMetaStep({ name: 'inner' });
    const outer = makeMetaStep({ name: 'outer', metaStep: inner });
    const step = makeMetaStep({ name: 'step', metaStep: outer });

    const visited = [];
    iterateMetaSteps(step, (s) => visited.push(s.name));
    // Deepest meta-step first, then the step itself (preserves the
    // ordering the plugin relies on when diffing against currentMetaSteps).
    expect(visited).toEqual(['inner', 'outer', 'step']);
  });
});

describe('metaStepsToArray', () => {
  test('returns an empty array when the step is null', () => {
    expect(metaStepsToArray(null)).toEqual([]);
  });

  test('returns an empty array when the step is undefined', () => {
    expect(metaStepsToArray(undefined)).toEqual([]);
  });

  test('returns a single-item array for a step with no metaStep', () => {
    const step = makeMetaStep({ name: 'only' });
    const result = metaStepsToArray(step);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(step);
  });

  test('returns nested meta-steps in deepest-first order with the step last', () => {
    const inner = makeMetaStep({ name: 'inner' });
    const outer = makeMetaStep({ name: 'outer', metaStep: inner });
    const step = makeMetaStep({ name: 'step', metaStep: outer });

    const result = metaStepsToArray(step);
    expect(result.map((s) => s.name)).toEqual(['inner', 'outer', 'step']);
    // Preserves object identity — the plugin reads `tempId` off the same
    // instance after startTestItem writes it.
    expect(result[0]).toBe(inner);
    expect(result[1]).toBe(outer);
    expect(result[2]).toBe(step);
  });

  test('returns a new array on every call — does not share module-level state', () => {
    const step = makeMetaStep({ name: 'first' });
    const a = metaStepsToArray(step);
    const b = metaStepsToArray(step);
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

describe('isEqualMetaStep', () => {
  test('two undefined values are considered equal', () => {
    expect(isEqualMetaStep(undefined, undefined)).toBe(true);
  });

  test('one undefined value is never equal to a defined meta-step', () => {
    const step = makeMetaStep({ name: 'defined' });
    expect(isEqualMetaStep(undefined, step)).toBe(false);
    expect(isEqualMetaStep(step, undefined)).toBe(false);
  });

  test('two meta-steps with identical actor, name and args are equal', () => {
    const a = makeMetaStep({ actor: 'I', name: 'click', args: ['Login'] });
    const b = makeMetaStep({ actor: 'I', name: 'click', args: ['Login'] });
    expect(isEqualMetaStep(a, b)).toBe(true);
  });

  test('different actor makes meta-steps unequal', () => {
    const a = makeMetaStep({ actor: 'I', name: 'click', args: ['Login'] });
    const b = makeMetaStep({ actor: 'Guest', name: 'click', args: ['Login'] });
    expect(isEqualMetaStep(a, b)).toBe(false);
  });

  test('different name makes meta-steps unequal', () => {
    const a = makeMetaStep({ actor: 'I', name: 'click', args: ['Login'] });
    const b = makeMetaStep({ actor: 'I', name: 'fillField', args: ['Login'] });
    expect(isEqualMetaStep(a, b)).toBe(false);
  });

  test('different args make meta-steps unequal', () => {
    const a = makeMetaStep({ actor: 'I', name: 'click', args: ['Login'] });
    const b = makeMetaStep({ actor: 'I', name: 'click', args: ['Logout'] });
    expect(isEqualMetaStep(a, b)).toBe(false);
  });

  test('missing args on both sides are treated as equal (coerced to empty array)', () => {
    const a = makeMetaStep({ actor: 'I', name: 'click', args: undefined });
    const b = makeMetaStep({ actor: 'I', name: 'click', args: undefined });
    expect(isEqualMetaStep(a, b)).toBe(true);
  });

  test('empty args equal missing args', () => {
    const a = makeMetaStep({ actor: 'I', name: 'click', args: [] });
    const b = makeMetaStep({ actor: 'I', name: 'click', args: undefined });
    expect(isEqualMetaStep(a, b)).toBe(true);
  });

  test('args are compared as a joined string — order matters', () => {
    const a = makeMetaStep({ actor: 'I', name: 'send', args: ['a', 'b'] });
    const b = makeMetaStep({ actor: 'I', name: 'send', args: ['b', 'a'] });
    expect(isEqualMetaStep(a, b)).toBe(false);
  });
});
