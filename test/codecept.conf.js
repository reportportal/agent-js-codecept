const { setHeadlessWhen } = require('@codeceptjs/configure');

// turn on headless mode when running with HEADLESS=true environment variable
// HEADLESS=true npx codecept run
setHeadlessWhen(process.env.HEADLESS);

exports.config = {
  tests: './*_test.js',
  output: './output',
  timeout: 10000,
  helpers: {
    Puppeteer: {
      url: 'https://www.google.de/',
      show: false
    }
  },
  bootstrap: null,
  mocha: {},
  name: 'codeceptjs-rphelper',
  plugins: {
    retryFailedStep: {
      enabled: false
    },
    screenshotOnFail: {
      enabled: true
    },
    reportportal: {
      require: '../index',
      apiKey: process.env['RP_API_KEY'],
      endpoint: 'https://web.demo.reportportal.io/api/v1',
      launch: 'This is demo launch',
      description: 'This is a description of your launch',
      attributes: [{ key: 'yourKey', value: 'yourValue' }],
      project: 'peterngtr_personal',
      rerun: false,
      debug: false,
      enabled: true
    }
  }
}