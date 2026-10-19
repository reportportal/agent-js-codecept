const RPClient = require('@reportportal/client-javascript');
const fs = require('fs');
const path = require('path');
const debug = require('debug')('codeceptjs:reportportal');
const { event, recorder, output, container } = codeceptjs;
const deepClone = require('lodash.clonedeep');

const helpers = container.helpers();
let helper;

const rp_FAILED = 'FAILED';
const rp_PASSED = 'PASSED';
const rp_SUITE = 'SUITE';
const rp_TEST = 'TEST';
const rp_STEP = 'STEP';

const screenshotHelpers = [
  'WebDriver',
  'Protractor',
  'Appium',
  'Nightmare',
  'Puppeteer',
  'TestCafe',
  'Playwright',
];

for (const helperName of screenshotHelpers) {
  if (Object.keys(helpers).indexOf(helperName) > -1) {
    helper = helpers[helperName];
  }
}

const ENV_FALLBACKS = {
  apiKey: 'RP_API_KEY',
  endpoint: 'RP_ENDPOINT',
  project: 'RP_PROJECT',
  launch: 'RP_LAUNCH',
};

// Deprecated option names and their replacements.
const LEGACY_OPTIONS = {
  token: 'apiKey',
  projectName: 'project',
  launchName: 'launch',
  launchDescription: 'description',
  launchAttributes: 'attributes',
};

const requiredFields = ['apiKey', 'endpoint', 'project'];

const isSet = (value) => value !== undefined && value !== '';

// Explicit config wins; the env var is a fallback; empty strings count as unset.
function pick(explicit, envVar, defaultValue) {
  if (isSet(explicit)) return explicit;
  if (envVar && isSet(process.env[envVar])) return process.env[envVar];
  return defaultValue;
}

// Maps deprecated names onto their replacements (a new name wins) and warns.
function withLegacyOptions(config) {
  const merged = { ...config };
  Object.keys(LEGACY_OPTIONS).forEach((legacy) => {
    if (config[legacy] === undefined) return;
    const modern = LEGACY_OPTIONS[legacy];
    console.warn(`Option '${legacy}' is deprecated. Use '${modern}' instead.`);
    if (merged[modern] === undefined) merged[modern] = config[legacy];
  });
  return merged;
}

function resolveConfig(rawConfig = {}) {
  const config = withLegacyOptions(rawConfig);
  return {
    apiKey: pick(config.apiKey, ENV_FALLBACKS.apiKey, undefined),
    endpoint: pick(config.endpoint, ENV_FALLBACKS.endpoint, undefined),
    project: pick(config.project, ENV_FALLBACKS.project, undefined),
    launch: pick(config.launch, ENV_FALLBACKS.launch, 'codeceptjs tests'),
    description: config.description !== undefined ? config.description : '',
    attributes: config.attributes !== undefined ? config.attributes : [],
    mode: config.mode !== undefined ? config.mode : 'DEFAULT',
    debug: config.debug !== undefined ? config.debug : false,
    rerun: config.rerun,
    rerunOf: config.rerunOf,
    restClientConfig: config.restClientConfig,
  };
}


module.exports = (config) => {
  const resolved = resolveConfig(config);

  for (let field of requiredFields) {
    if (!resolved[field]) throw new Error(`ReportPortal config is invalid. Key ${field} is missing in config.\nRequired fields: ${requiredFields} `)
  }

  let reportUrl;
  let launchObj;
  let suiteObj;
  let testObj;
  let stepObj;
  let failedStep;
  let rpClient;

  let suiteStatus = rp_PASSED;
  let launchStatus = rp_PASSED;
  let currentMetaSteps = [];

  function logCurrent(data, file) {
    const obj = stepObj || testObj;
    if (obj) rpClient.sendLog(obj.tempId, data, file); 
  }

  event.dispatcher.on(event.all.before, async () => {
    launchObj = startLaunch();
    try {
      await launchObj.promise;
    } catch (err) {
      output.error(`❌ Can't connect to ReportPortal, exiting...`);
      output.error(err);
      process.exit(1);
    }
    output.print(`📋 Writing results to ReportPortal: ${resolved.project} > ${resolved.endpoint}`);

    const outputLog = output.log;
    const outputDebug = output.debug;
    const outputError = output.error;

    output.log = (message) => {
      outputLog(message);
      logCurrent({ level: 'trace', message });
    }

    output.debug = (message) => {
      outputDebug(message);
      logCurrent({ level: 'debug', message });
    }  
    
    output.error = (message) => {
      outputError(message);
      logCurrent({ level: 'error', message });
    }

  });

  event.dispatcher.on(event.suite.before, (suite) => {
    recorder.add(async () => {
      suiteObj = startTestItem(suite.title, rp_TEST);
      debug(`${suiteObj.tempId}: The suiteId '${suite.title}' is started.`);
      suite.tempId = suiteObj.tempId;
      suiteStatus = rp_PASSED;
    });
  });

  event.dispatcher.on(event.test.before, (test) => {
    recorder.add(async () => {
      if (test._retries > 0) {
        if (test._currentRetry > 0) {
          test.retriedTitle = test.title + ' [⟳' + test._currentRetry + ']'
        }
      }
      currentMetaSteps = [];
      stepObj = null;
      testObj = startTestItem(test.retriedTitle || test.title, rp_STEP, suiteObj.tempId, true);
      test.tempId = testObj.tempId;
      failedStep = null;
      debug(`${testObj.tempId}: The testId '${test.title}' is started.`);
    })
  });

  event.dispatcher.on(event.step.before, (step) => {
    recorder.add(async () => {      
      const parent = await startMetaSteps(step);
      stepObj = startTestItem(step.toString().slice(0, 300), rp_STEP, parent.tempId);
      step.tempId = stepObj.tempId;
    })
  });

  event.dispatcher.on(event.step.after, (step) => {
    recorder.add(() => finishStep(step));
  });

  event.dispatcher.on(event.step.failed, (step) => {
    for (const metaStep of currentMetaSteps) {
      if (metaStep) metaStep.status = 'failed';
    }
    if (step && step.tempId) failedStep = Object.assign({}, step);
  });

  event.dispatcher.on(event.step.passed, (step, err) => {
    for (const metaStep of currentMetaSteps) {
      metaStep.status = 'passed';
    }
    failedStep = null;
  });

  event.dispatcher.on(event.test.failed, async (test, err) => {
    launchStatus = rp_FAILED;
    suiteStatus = rp_FAILED;

    let retriedTempId;
    if (test.ctx && test.ctx.test && test.ctx.test.retriedTitle && test.ctx.test._currentRetry > 0 ) {
      debug(`Retried run of test`);
      retriedTempId = test.ctx.test.tempId
    }

    if (failedStep && failedStep.tempId) {

      const step = failedStep;

      debug(`Attaching screenshot & error to failed step`);
  
      const screenshot = await attachScreenshot();      

      resp = await rpClient.sendLog(step.tempId, {
        level: 'ERROR',
        message: `${err.stack}`,
        time: step.startTime,
      }, screenshot).promise; 

    }

    if (!test.tempId) return;
    const testTempId = retriedTempId ? retriedTempId : test.tempId

    debug(`${testTempId}: Test '${test.title}' failed.`);

    if (!failedStep) {
      await rpClient.sendLog(testTempId, {
        level: 'ERROR',
        message: `${err.stack}`,
      }).promise;      
    }

    rpClient.finishTestItem(testTempId, {
      endTime: test.endTime || rpClient.helpers.now(),
      status: rp_FAILED,
      message: `${err.stack}`,
    });  
  });

  event.dispatcher.on(event.test.passed, (test, err) => {
    debug(`${test.tempId}: Test '${test.title}' passed.`);
    rpClient.finishTestItem(test.tempId, {
      endTime: test.endTime || rpClient.helpers.now(),
      status: rp_PASSED,
    });    
  });

  event.dispatcher.on(event.test.after, (test) => {
    recorder.add(async () => {
      debug(`closing ${currentMetaSteps.length} metasteps for failed test`);
      if (failedStep) await finishStep(failedStep);
      await Promise.all(currentMetaSteps.reverse().map(m => finishStep(m)));
      stepObj = null;
      testObj = null;
    });
  });

  event.dispatcher.on(event.suite.after, (suite) => {
    recorder.add(async () => {
      debug(`${suite.tempId}: Suite '${suite.title}' finished ${suiteStatus}.`);
      return rpClient.finishTestItem(suite.tempId, {
        endTime: suite.endTime || rpClient.helpers.now(),
        status: rpStatus(suiteStatus)
      });
    });
  });

  function startTestItem(testTitle, method, parentId = null, stats = null) {
    try {
      const hasStats = stats || (method !== rp_STEP);
      return rpClient.startTestItem({
        name: testTitle,
        type: method,
        hasStats,
      }, launchObj.tempId, parentId);
    } catch (error) {
      output.err(error);
    }

  }

  event.dispatcher.on(event.all.result, async () => {
    // await recorder.promise;
    debug('Finishing launch...');
    if (suiteObj) {
      rpClient.finishTestItem(suiteObj.tempId, {
        status: suiteStatus,
      }).promise;
    }
    if (!process.env.RP_LAUNCH_ID) await finishLaunch();
  });

  function startLaunch(suiteTitle) {
    rpClient = new RPClient({
      apiKey: resolved.apiKey,
      endpoint: resolved.endpoint,
      project: resolved.project,
      launch: resolved.launch,
      debug: resolved.debug,
      restClientConfig: resolved.restClientConfig,
    });

    const options = {
      name: resolved.launch || suiteTitle,
      description: resolved.description,
      attributes: resolved.attributes,
      rerun: resolved.rerun,
      rerunOf: resolved.rerunOf,
      mode: resolved.mode,
    }

    if (process.env.RP_LAUNCH_ID) {
      options.id = process.env.RP_LAUNCH_ID
    }

    return rpClient.startLaunch(options);
  }

  async function attachScreenshot() {
    if (!helper) return undefined;
    
    const fileName = `${rpClient.helpers.now()}.png`;
    try {
      await helper.saveScreenshot(fileName);
    } catch (err) {
      output.error(`Couldn't save screenshot`);
      return undefined;
    }

    const content = fs.readFileSync(path.join(global.output_dir, fileName));
    fs.unlinkSync(path.join(global.output_dir, fileName));

    return {
      name: 'failed.png',
      type: 'image/png',
      content,
    }
  }

  async function finishLaunch() {
    try {
      debug(`${launchObj.tempId} Finished launch: ${launchStatus}`)
      const launch = rpClient.finishLaunch(launchObj.tempId, {
        status: launchStatus,
      });

      const response = await launch.promise;

      reportUrl = response.link;
      output.print(` 📋 Report #${response.number} saved ➡`, response.link);
      event.emit('reportportal.result', response);
    } catch (error) {
      console.log(error);
      debug(error);
    }
  }

  async function startMetaSteps(step) {
    let metaStepObj = {};
    const metaSteps = metaStepsToArray(step.metaStep);

    // close current metasteps
    for (let j = currentMetaSteps.length-1; j >= metaSteps.length; j--) {
      await finishStep(currentMetaSteps[j]);
    }

    for (const i in metaSteps) {
      const metaStep = metaSteps[i];
      if (isEqualMetaStep(metaStep, currentMetaSteps[i])) {
        metaStep.tempId = currentMetaSteps[i].tempId;
        continue;
      } 
      // close metasteps other than current
      for (let j = currentMetaSteps.length-1; j >= i; j--) {
        await finishStep(currentMetaSteps[j]);
        delete currentMetaSteps[j];
      }

      metaStepObj = currentMetaSteps[i-1] || metaStepObj;

      const isNested = !!metaStepObj.tempId;
      metaStepObj = startTestItem(metaStep.toString(), rp_STEP , metaStepObj.tempId || testObj.tempId, false);
      metaStep.tempId = metaStepObj.tempId;
      debug(`${metaStep.tempId}: The stepId '${metaStep.toString()}' is started. Nested: ${isNested}`);
    }

    currentMetaSteps = deepClone(metaSteps);
    return currentMetaSteps[currentMetaSteps.length - 1] || testObj;
  }

  function finishStep(step) {
    if (!step) return;
    if (!step.tempId) {
      debug(`WARNING: '${step.toString()}' step can't be closed, it has no tempId`);
      return;
    }
    debug(`Finishing '${step.toString()}' step`);

    return rpClient.finishTestItem(step.tempId, {
      endTime: rpClient.helpers.now(),
      status: rpStatus(step.status),
    });
  }

  return {
    addLog: logCurrent,
  };
};

function metaStepsToArray(step) {
  let metaSteps = [];
  iterateMetaSteps(step, metaStep => metaSteps.push(metaStep));
  return metaSteps;
}

function iterateMetaSteps(step, fn) {
  if (step && step.metaStep) iterateMetaSteps(step.metaStep, fn);
  if (step) fn(step);
}


const isEqualMetaStep = (metastep1, metastep2) => {
  if (!metastep1 && !metastep2) return true;
  if (!metastep1 || !metastep2) return false;
  return metastep1.actor === metastep2.actor 
    && metastep1.name === metastep2.name 
    && metastep1.args.join(',') === metastep2.args.join(',');
};


function rpStatus(status) {
  if (status === 'success') return rp_PASSED;
  if (status === 'failed') return rp_FAILED;
  return status;
}

