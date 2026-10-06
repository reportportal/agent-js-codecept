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
      token: process.env['RP_TOKEN'],
      endpoint: 'https://web.demo.reportportal.io/api/v1',
      launchName: 'This is demo launch',
      launchDescription: 'This is a description of your launch',
      launchAttributes: [{ key: 'yourKey', value: 'yourValue' }],
      projectName: 'peterngtr_personal',
      rerun: false,
      debug: false,
      enabled: true
    }
  }
}