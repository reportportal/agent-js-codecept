import plugin = require('./plugin');

// `export =` matches CodeceptJS's `require:` plugin loader which calls the
// returned value as a function (`require('@reportportal/agent-js-codecept')(config)`).
// `export default` would compile to `module.exports.default = …` under
// `module: commonjs`, breaking that loader — see design §5.
export = plugin;
