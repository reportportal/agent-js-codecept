# ReportPortal Agent for CodeceptJS

📋Beautiful enterprise-grade test reports integrated with [CodeceptJS](https://codecept.io) testing framework.
This helpes you integrate the test results of CodeceptJS with ReportPortal

> Based on [CodeceptJS RPHelper by PeterNgTr](https://github.com/PeterNgTr/codeceptjs-rphelper).

![ReportPortal Test](https://i.ibb.co/Qm52G0n/Screenshot-2019-04-11-at-15-57-40.png)

`@reportportal/agent-js-codecept` is a [CodeceptJS](https://codecept.io/) plugin which can publish tests results on [ReportPortal](https://reportportal.io/) after execution.

When enabled this plugin sends information on test runs to ReportPortal server:

* ✅status for failed and passed tests
* 🔍step by step log
* 🖼screenshots on failure are attached

## Installation

```sh
npm i @reportportal/agent-js-codecept --save
```

**Requires Node.js `>=16`.**

## Configuration

> **⚠ Breaking change (major release).** The option surface has been renamed to
> match the rest of the ReportPortal JavaScript agent fleet (e.g.
> `agent-js-playwright`). The legacy names below are **removed** — they are not
> aliased and the agent emits no deprecation warning for them. Required-field
> validation will fail if you still use `token` / `projectName`.
>
> | Removed            | Replacement   |
> |--------------------|---------------|
> | `token`            | `apiKey`      |
> | `projectName`      | `project`     |
> | `launchName`       | `launch`      |
> | `launchDescription`| `description` |
> | `launchAttributes` | `attributes`  |

This plugin should be added in `codecept.conf.js`

Example:

```js
{
  //...
   plugins: {
    reportportal: {
      enabled: true,
      require: '@reportportal/agent-js-codecept',
      apiKey: 'YOUR_API_KEY',
      endpoint: 'http://localhost:8080/api/v1',
      launch: 'local launch',
      project: 'Awesome_project'
    }
  //...
}
```

To use this plugin you need to provide the following info:

- `apiKey` - required: user's token for ReportPortal. The API key can be found on the user profile page in the ReportPortal UI. It is used for authentication instead of a password so that data can be posted without a UI login.
- `endpoint` - required: your reportportal host + `api/v1` for instance: `http://localhost:8080/api/v1`
- `project` - required: the project that you created in the reportportal UI
- `launch`: (optional) the launch name you want. Defaults to `codeceptjs tests`. If not provided and the suite title is available, the suite title is used.
- `description`: (optional) the description of your launch, if not provided, the description will be empty
- `attributes`: (optional) the attributes of your launch, if not provided, the attributes will be empty (`[]`)
- `mode`: (optional) to specify visibility of launch, if set to `'DEBUG'`, then launch results will be only visible in the 'Debug' section of a project. Defaults to `'DEFAULT'`.
- `debug`: (optional) to turn on the debug for reportportal
- `rerun`: (optional) to enable [rerun](https://github.com/reportportal/documentation/blob/master/src/md/src/DevGuides/rerun.md)
- `rerunOf`: (optional) UUID of launch you want to rerun. If not specified, report portal will update the latest launch with the same name
- `restClientConfig`: (optional) opaque object forwarded verbatim to the ReportPortal HTTP client. Use it to configure HTTP transport such as proxy, timeout, retry, and custom headers. See [`@reportportal/client-javascript` README](https://github.com/reportportal/client-javascript#reportportal-advanced-configuration) for the accepted shape.

### Environment variables

Four options accept an environment-variable fallback. The following environment
variables are recognised:

| Env var        | Option     |
|----------------|------------|
| `RP_API_KEY`   | `apiKey`   |
| `RP_ENDPOINT`  | `endpoint` |
| `RP_PROJECT`   | `project`  |
| `RP_LAUNCH`    | `launch`   |

**Precedence (highest to lowest):**

1. Environment variable (where applicable)
2. Explicit value from `codecept.conf.js`
3. Default (if any)

An env var is considered "set" only when it is defined **and** non-empty, so a
blank shell variable (`RP_LAUNCH=""`) does not override a value committed to the
config file.

This lets CI/CD retarget a committed `codecept.conf.js` at runtime (switch
endpoint, inject a per-pipeline API key) without editing the file.

## Public API

### Add Log Message

You can send logs to ReportPortal to current step / test by accessing this plugin from your code:

```js
const reportPortal = codeceptjs.container.plugins('reportportal');
reportPortal.addLog({
  level: 'debug',
  message: 'your message'
});
```

To send attachment, use second parameter:

```js
const reportPortal = codeceptjs.container.plugins('reportportal');
reportPortal.addLog({
  level: 'debug',
  message: 'your message'
}, {
  name: 'screenshot.png',
  type: 'image/png',
  content: fs.readFileSync('output/screenshot.png')
});
```

See [`sendLog` method of ReportPortal JavaScript Client](https://github.com/reportportal/client-javascript#sendlog) for more oprtions.

### Get Report URL

Once report is posted a special `reportportal.result` event is created. 

You can use it to pass URL of a report into other plugins. For instance, you can use it to send Slack or Email notifications including a link to a report.

```js
// inside your custom plugin:
event.dispatcher.on('reportportal.result', (result) => {
  // use result.link as URL to report
  console.log('Report was published at', result.link);
})
```

## Todo

- [ ] Support `run-workers` command to aggregate all tests under one launch.

## Debugging Plugin

To debug this plugin run script enabing DEBUG env variable:

```
DEBUG="codeceptjs:reportportal"  npx codeceptjs run
```
