/* eslint-env node, jest */

/**
 * Unit tests for EPMRPP-122057:
 *   Update CodeceptJS and dev tools to the latest 3.x.
 *
 * This is a pure tooling / metadata update ticket. The tests here are
 * deterministic file-system inspections of the repo state (package.json,
 * eslint / prettier config, .gitignore, deleted test/ directory). They do
 * not invoke the agent runtime and do not depend on wall-clock time,
 * network, or randomness.
 *
 * Acceptance criteria covered:
 *   AC #1  peerDependencies.codeceptjs = ">=3.7.5 <4"
 *   AC #2  devDependencies.codeceptjs on a 3.7.x patch; puppeteer removed
 *   AC #3  eslint on a supported major version; `lint` script exists;
 *          mocha and chai removed from devDependencies
 *   AC #4  production audit cleanliness is verified by the pipeline
 *          (npm audit --omit=dev); here we only assert the dev-tool
 *          surface the AC pins down
 *   AC #5  pipeline's example run is covered by the examples phase;
 *          here we only assert that the agent is installable against
 *          CodeceptJS 3.7.x (devDep pin + peerDep declaration)
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const PKG_PATH = path.join(REPO_ROOT, 'package.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

/**
 * Pull the minimum version admitted by an npm spec string of the form
 * `^1.2.3`, `~1.2.3`, `1.2.3`, or `>=1.2.3 <2`. We intentionally avoid
 * a `semver` dep here — it is not declared in package.json for this
 * package, and the shapes we need to compare are narrow and deterministic.
 */
function minVersionFromSpec(spec) {
  // Match x.y.z, x.y, or x — in that order so the longest form wins.
  const full = /(\d+)\.(\d+)\.(\d+)/.exec(spec);
  if (full) {
    return { major: Number(full[1]), minor: Number(full[2]), patch: Number(full[3]) };
  }
  const minor = /(\d+)\.(\d+)/.exec(spec);
  if (minor) {
    return { major: Number(minor[1]), minor: Number(minor[2]), patch: 0 };
  }
  const major = /(\d+)/.exec(spec);
  if (major) {
    return { major: Number(major[1]), minor: 0, patch: 0 };
  }
  throw new Error(`Cannot parse version spec: ${spec}`);
}

/**
 * Minimal `>=X.Y.Z <A` range membership check — sufficient for the two
 * ranges this file asserts against (the peer range from AC #1 and the
 * dev range we pin in step 1). Supports: ">=x.y.z <A", "^x.y.z",
 * "~x.y.z", "x.y.z". Not a general-purpose semver implementation.
 */
function satisfiesSimpleRange(version, range) {
  const v = minVersionFromSpec(version);
  const asTuple = v.major * 1_000_000 + v.minor * 1_000 + v.patch;

  // Form: ">=a.b.c <d" or ">=a.b.c <d.e.f"
  const gtLtMatch = /^>=\s*(\d+)\.(\d+)\.(\d+)\s+<\s*(\d+)(?:\.(\d+)\.(\d+))?$/.exec(
    range.trim(),
  );
  if (gtLtMatch) {
    const lowTuple =
      Number(gtLtMatch[1]) * 1_000_000 +
      Number(gtLtMatch[2]) * 1_000 +
      Number(gtLtMatch[3]);
    const upMajor = Number(gtLtMatch[4]);
    const upMinor = gtLtMatch[5] !== undefined ? Number(gtLtMatch[5]) : 0;
    const upPatch = gtLtMatch[6] !== undefined ? Number(gtLtMatch[6]) : 0;
    const upTuple = upMajor * 1_000_000 + upMinor * 1_000 + upPatch;
    return asTuple >= lowTuple && asTuple < upTuple;
  }

  // Form: "~a.b.c" — >= a.b.c and < a.(b+1).0
  const tildeMatch = /^~\s*(\d+)\.(\d+)\.(\d+)$/.exec(range.trim());
  if (tildeMatch) {
    const a = Number(tildeMatch[1]);
    const b = Number(tildeMatch[2]);
    const c = Number(tildeMatch[3]);
    const lowTuple = a * 1_000_000 + b * 1_000 + c;
    const upTuple = a * 1_000_000 + (b + 1) * 1_000;
    return asTuple >= lowTuple && asTuple < upTuple;
  }

  throw new Error(`Unsupported range form in tests: ${range}`);
}

describe('EPMRPP-122057 — CodeceptJS + dev tool update', () => {
  let pkg;

  beforeAll(() => {
    pkg = readJson(PKG_PATH);
  });

  // ------------------------------------------------------------------------
  // AC #1 — peerDependencies declares CodeceptJS 3.7.5+ / < 4
  // ------------------------------------------------------------------------

  describe('AC #1 — peerDependencies declaration', () => {
    test('peerDependencies block exists in package.json', () => {
      expect(pkg.peerDependencies).toBeDefined();
      expect(typeof pkg.peerDependencies).toBe('object');
    });

    test('peerDependencies.codeceptjs is exactly ">=3.7.5 <4"', () => {
      expect(pkg.peerDependencies.codeceptjs).toBe('>=3.7.5 <4');
    });

    test('peerDependencies.codeceptjs range admits 3.7.5 and 3.7.9 but rejects 3.7.4 and 4.0.0', () => {
      const range = pkg.peerDependencies.codeceptjs;
      expect(satisfiesSimpleRange('3.7.5', range)).toBe(true);
      expect(satisfiesSimpleRange('3.7.9', range)).toBe(true);
      expect(satisfiesSimpleRange('3.7.4', range)).toBe(false);
      expect(satisfiesSimpleRange('4.0.0', range)).toBe(false);
      expect(satisfiesSimpleRange('2.5.0', range)).toBe(false);
    });

    test('codeceptjs is not declared as a runtime dependency (peer only)', () => {
      const runtime = pkg.dependencies || {};
      expect(runtime.codeceptjs).toBeUndefined();
    });
  });

  // ------------------------------------------------------------------------
  // AC #2 — devDep moves to the latest CodeceptJS 3.7.x; puppeteer removed
  // ------------------------------------------------------------------------

  describe('AC #2 — devDependency on CodeceptJS 3.7.x; puppeteer removed', () => {
    test('devDependencies.codeceptjs is pinned with a tilde range on 3.7.x', () => {
      const spec = pkg.devDependencies.codeceptjs;
      expect(spec).toMatch(/^~3\.7\.\d+$/);
    });

    test('devDep codeceptjs range satisfies the peerDependency range', () => {
      const devRange = pkg.devDependencies.codeceptjs;
      const peerRange = pkg.peerDependencies.codeceptjs;
      // The minimum version of the dev range must satisfy the peer range —
      // otherwise the installed dev copy would violate our declared peer.
      const devMin = minVersionFromSpec(devRange);
      const devMinStr = `${devMin.major}.${devMin.minor}.${devMin.patch}`;
      expect(satisfiesSimpleRange(devMinStr, peerRange)).toBe(true);
    });

    test('puppeteer is not in devDependencies', () => {
      expect(pkg.devDependencies.puppeteer).toBeUndefined();
    });

    test('puppeteer is not in dependencies either', () => {
      const runtime = pkg.dependencies || {};
      expect(runtime.puppeteer).toBeUndefined();
    });
  });

  // ------------------------------------------------------------------------
  // AC #3 — eslint supported major + lint script; mocha/chai removed
  // ------------------------------------------------------------------------

  describe('AC #3 — eslint on a supported major, lint script, mocha/chai removed', () => {
    test('devDependencies.eslint is on a modern major (>= 8)', () => {
      const spec = pkg.devDependencies.eslint;
      expect(spec).toBeDefined();
      expect(minVersionFromSpec(spec).major).toBeGreaterThanOrEqual(8);
    });

    test('eslint-config-airbnb-base is on major >= 15', () => {
      const spec = pkg.devDependencies['eslint-config-airbnb-base'];
      expect(spec).toBeDefined();
      expect(minVersionFromSpec(spec).major).toBeGreaterThanOrEqual(15);
    });

    test('eslint-config-prettier is declared', () => {
      expect(pkg.devDependencies['eslint-config-prettier']).toBeDefined();
    });

    test('eslint-plugin-import is declared', () => {
      expect(pkg.devDependencies['eslint-plugin-import']).toBeDefined();
    });

    test('prettier is declared as a devDependency', () => {
      expect(pkg.devDependencies.prettier).toBeDefined();
      expect(minVersionFromSpec(pkg.devDependencies.prettier).major).toBeGreaterThanOrEqual(3);
    });

    test('scripts.lint exists and invokes eslint', () => {
      expect(pkg.scripts.lint).toBeDefined();
      expect(pkg.scripts.lint).toMatch(/eslint/);
    });

    test('scripts.format exists and invokes prettier', () => {
      expect(pkg.scripts.format).toBeDefined();
      expect(pkg.scripts.format).toMatch(/prettier/);
    });

    test('scripts.test still invokes jest', () => {
      expect(pkg.scripts.test).toBeDefined();
      expect(pkg.scripts.test).toMatch(/jest/);
    });

    test('scripts["test:acceptance"] is removed', () => {
      expect(pkg.scripts['test:acceptance']).toBeUndefined();
    });

    test('mocha is not in devDependencies', () => {
      expect(pkg.devDependencies.mocha).toBeUndefined();
    });

    test('chai is not in devDependencies', () => {
      expect(pkg.devDependencies.chai).toBeUndefined();
    });

    test('lodash (unused root package) is not in devDependencies or dependencies', () => {
      expect(pkg.devDependencies.lodash).toBeUndefined();
      const runtime = pkg.dependencies || {};
      expect(runtime.lodash).toBeUndefined();
    });

    test('.eslintrc.js exists at the repo root', () => {
      expect(fs.existsSync(path.join(REPO_ROOT, '.eslintrc.js'))).toBe(true);
    });

    test('.eslintignore exists at the repo root', () => {
      expect(fs.existsSync(path.join(REPO_ROOT, '.eslintignore'))).toBe(true);
    });

    test('.prettierrc exists at the repo root and is valid JSON', () => {
      const prettierrcPath = path.join(REPO_ROOT, '.prettierrc');
      expect(fs.existsSync(prettierrcPath)).toBe(true);
      // Must parse as JSON (fleet-standard prettierrc is JSON-shaped).
      expect(() => readJson(prettierrcPath)).not.toThrow();
    });

    test('.eslintrc.js targets the node environment (not browser)', () => {
      // Require() the config file — it is a CommonJS module.
      // Resolve a fresh copy each time via jest.isolateModules to avoid
      // require-cache side-effects between tests.
      let config;
      jest.isolateModules(() => {
        // eslint-disable-next-line global-require, import/no-dynamic-require
        config = require(path.join(REPO_ROOT, '.eslintrc.js'));
      });
      expect(config).toBeDefined();
      expect(config.env).toBeDefined();
      expect(config.env.node).toBe(true);
      // The old config had env.browser=true which was wrong for this repo.
      expect(config.env.browser).not.toBe(true);
    });

    test('.eslintrc.js extends airbnb-base and prettier (in that order)', () => {
      let config;
      jest.isolateModules(() => {
        // eslint-disable-next-line global-require, import/no-dynamic-require
        config = require(path.join(REPO_ROOT, '.eslintrc.js'));
      });
      expect(Array.isArray(config.extends)).toBe(true);
      expect(config.extends).toContain('airbnb-base');
      expect(config.extends).toContain('prettier');
      // prettier must come after airbnb-base so it can turn off conflicting
      // formatting rules.
      expect(config.extends.indexOf('prettier')).toBeGreaterThan(
        config.extends.indexOf('airbnb-base'),
      );
    });
  });

  // ------------------------------------------------------------------------
  // Clean-up: test/ directory deleted; .gitignore trimmed
  // ------------------------------------------------------------------------

  describe('legacy test/ directory removal and .gitignore clean-up', () => {
    test('legacy test/ directory no longer exists', () => {
      expect(fs.existsSync(path.join(REPO_ROOT, 'test'))).toBe(false);
    });

    test('.gitignore does not contain a test/output reference', () => {
      const gitignore = readText(path.join(REPO_ROOT, '.gitignore'));
      expect(gitignore).not.toMatch(/test\/output/);
    });

    test('.gitignore still ignores node_modules', () => {
      const gitignore = readText(path.join(REPO_ROOT, '.gitignore'));
      // Match whole line to avoid partial matches.
      const lines = gitignore.split(/\r?\n/).map((l) => l.trim());
      expect(lines).toContain('node_modules');
    });
  });

  // ------------------------------------------------------------------------
  // Runtime surface: index.js is the only shipped file + still loads
  // ------------------------------------------------------------------------

  describe('runtime surface preserved (AC #5 — installable against 3.7.x)', () => {
    test('package.json "files" ships only index.js', () => {
      expect(pkg.files).toEqual(['index.js']);
    });

    test('package.json "main" is index.js', () => {
      expect(pkg.main).toBe('index.js');
    });

    test('index.js exists at the repo root', () => {
      expect(fs.existsSync(path.join(REPO_ROOT, 'index.js'))).toBe(true);
    });

    test('index.js does not require the removed lodash root package', () => {
      const source = readText(path.join(REPO_ROOT, 'index.js'));
      // The AC removes the unused `lodash` root dep. `lodash.clonedeep` is a
      // separate single-function package and is still a runtime dep —
      // match word-boundary require('lodash') only.
      expect(source).not.toMatch(/require\(\s*['"]lodash['"]\s*\)/);
    });

    test('index.js does not require the removed puppeteer package', () => {
      const source = readText(path.join(REPO_ROOT, 'index.js'));
      expect(source).not.toMatch(/require\(\s*['"]puppeteer['"]\s*\)/);
    });

    test('engines.node floor is >= 16 (CodeceptJS 3.7.x minimum)', () => {
      expect(pkg.engines).toBeDefined();
      expect(pkg.engines.node).toBeDefined();
      expect(minVersionFromSpec(pkg.engines.node).major).toBeGreaterThanOrEqual(16);
    });
  });
});
