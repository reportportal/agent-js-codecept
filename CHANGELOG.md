# 1.0.0

### Added
* `apiKey` option — primary authentication key (replaces the removed `token`).
* `restClientConfig` option — opaque passthrough to the ReportPortal HTTP
  client enabling proxy, timeout, retry, and custom header configuration.
* Environment-variable fallbacks: `RP_API_KEY`, `RP_ENDPOINT`, `RP_PROJECT`,
  `RP_LAUNCH`. Resolution precedence is: env var → explicit config → default.
  An empty-string env var is treated as unset.

### Changed
* Bumped `@reportportal/client-javascript` to `~5.6.0`.
* Bumped `engines.node` to `>=16` (client 5.6 drops Node 14).
* `debug` and `lodash.clonedeep` are now declared under `dependencies`
  (previously resolved via transitive hoisting).
* The default configuration object is no longer mutated across invocations.

### Breaking changes
* Removed legacy option names. There is no backward-compatibility alias or
  deprecation warning for these — passing them is silently ignored and
  required-field validation surfaces the missing modern names.
  * `token` → use `apiKey`
  * `projectName` → use `project`
  * `launchName` → use `launch`
  * `launchDescription` → use `description`
  * `launchAttributes` → use `attributes`
* `attributes` now defaults to `[]`.
* Required fields reported by configuration validation are now `apiKey`,
  `endpoint`, `project`.

# 0.2.3

* added `reportportal.result` event to notify when report was created

# 0.2.0

* Added debug messages logs
* Added public API for sending custom logs

# 0.1.0

* Added implementation for nested steps
* Gherkin support
* Migrated from [PeterNgTr/codeceptjs-rphelper](https://github.com/PeterNgTr/codeceptjs-rphelper)