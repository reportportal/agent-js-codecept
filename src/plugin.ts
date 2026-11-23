import * as fs from 'fs';
import * as path from 'path';
import createDebug from 'debug';
import deepClone from 'lodash.clonedeep';
import RPClient from '@reportportal/client-javascript';
import { STATUSES, TEST_ITEM_TYPES, LAUNCH_MODES } from '@reportportal/client-javascript/constants';
import type {
  Attribute,
  StartLaunchOptions,
  StartTestItemOptions,
  FinishTestItemOptions,
  LogOptions,
  Attachment,
  ClientResponse,
} from '@reportportal/client-javascript/models';

import { resolveConfig, requiredFields } from './config';
import { metaStepsToArray, isEqualMetaStep, rpStatus } from './utils';
import type {
  PluginConfig,
  ResolvedConfig,
  RpTest,
  RpSuite,
  RpStep,
  ScreenshotFile,
} from './models';

const debug = createDebug('codeceptjs:reportportal');
const { event, recorder, output, container } = codeceptjs;

const helpers = container.helpers() as Record<string, any>;
let helper: any;

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

function plugin(config: PluginConfig) {
  const resolved: ResolvedConfig = resolveConfig(config);

  for (const field of requiredFields) {
    if (!resolved[field]) {
      throw new Error(
        `ReportPortal config is invalid. Key ${field} is missing in config.\nRequired fields: ${requiredFields} `,
      );
    }
  }

  let launchObj: ClientResponse<unknown> | undefined;
  let suiteObj: ClientResponse<unknown> | undefined;
  let testObj: ClientResponse<unknown> | null = null;
  let stepObj: ClientResponse<unknown> | null = null;
  let failedStep: RpStep | null = null;
  let rpClient: RPClient;

  let suiteStatus: string = STATUSES.PASSED;
  let launchStatus: string = STATUSES.PASSED;
  let currentMetaSteps: RpStep[] = [];

  function logCurrent(data: LogOptions, file?: Attachment): void {
    const obj = stepObj || testObj;
    if (obj) rpClient.sendLog(obj.tempId, data, file);
  }

  event.dispatcher.on(event.all.before, async () => {
    launchObj = startLaunch();
    try {
      await launchObj.promise;
    } catch (err) {
      output.error("❌ Can't connect to ReportPortal, exiting...");
      output.error(err as any);
      process.exit(1);
    }
    // `output.print` exists at runtime in CodeceptJS 3.x but is not in the
    // bundled `namespace output` declaration — cast once to reach it.
    (output as any).print(`📋 Writing results to ReportPortal: ${resolved.project} > ${resolved.endpoint}`);

    const outputLog = output.log;
    const outputDebug = output.debug;
    const outputError = output.error;

    output.log = (message: string) => {
      outputLog(message);
      logCurrent({ level: 'trace' as any, message });
    };

    output.debug = (message: string) => {
      outputDebug(message);
      logCurrent({ level: 'debug' as any, message });
    };

    output.error = (message: string) => {
      outputError(message);
      logCurrent({ level: 'error' as any, message });
    };
  });

  event.dispatcher.on(event.suite.before, (suite: RpSuite) => {
    recorder.add(async () => {
      suiteObj = startTestItem(suite.title, TEST_ITEM_TYPES.TEST);
      debug(`${suiteObj?.tempId}: The suiteId '${suite.title}' is started.`);
      if (suiteObj) suite.tempId = suiteObj.tempId;
      suiteStatus = STATUSES.PASSED;
    });
  });

  event.dispatcher.on(event.test.before, (test: RpTest) => {
    recorder.add(async () => {
      if ((test._retries || 0) > 0) {
        if ((test._currentRetry || 0) > 0) {
          test.retriedTitle = `${test.title} [⟳${test._currentRetry}]`;
        }
      }
      currentMetaSteps = [];
      stepObj = null;
      testObj = startTestItem(
        test.retriedTitle || test.title,
        TEST_ITEM_TYPES.STEP,
        suiteObj?.tempId,
        true,
      );
      if (testObj) test.tempId = testObj.tempId;
      failedStep = null;
      debug(`${testObj?.tempId}: The testId '${test.title}' is started.`);
    });
  });

  event.dispatcher.on(event.step.before, (step: RpStep) => {
    recorder.add(async () => {
      const parent = await startMetaSteps(step);
      stepObj = startTestItem(step.toString().slice(0, 300), TEST_ITEM_TYPES.STEP, parent.tempId);
      if (stepObj) step.tempId = stepObj.tempId;
    });
  });

  event.dispatcher.on(event.step.after, (step: RpStep) => {
    recorder.add(() => finishStep(step));
  });

  event.dispatcher.on(event.step.failed, (step: RpStep) => {
    for (const metaStep of currentMetaSteps) {
      if (metaStep) metaStep.status = 'failed';
    }
    if (step && step.tempId) failedStep = Object.assign({}, step) as RpStep;
  });

  event.dispatcher.on(event.step.passed, (_step: RpStep, _err: Error) => {
    for (const metaStep of currentMetaSteps) {
      metaStep.status = 'passed';
    }
    failedStep = null;
  });

  event.dispatcher.on(event.test.failed, async (test: RpTest, err: Error) => {
    launchStatus = STATUSES.FAILED;
    suiteStatus = STATUSES.FAILED;

    let retriedTempId: string | undefined;
    if (
      test.ctx
      && test.ctx.test
      && test.ctx.test.retriedTitle
      && (test.ctx.test._currentRetry || 0) > 0
    ) {
      debug('Retried run of test');
      retriedTempId = test.ctx.test.tempId;
    }

    if (failedStep && failedStep.tempId) {
      const step = failedStep;

      debug('Attaching screenshot & error to failed step');

      const screenshot = await attachScreenshot();

      await rpClient.sendLog(
        step.tempId as string,
        {
          level: 'ERROR' as any,
          message: `${err.stack}`,
          time: step.startTime,
        },
        screenshot,
      ).promise;
    }

    if (!test.tempId) return;
    const testTempId = retriedTempId ? retriedTempId : test.tempId;

    debug(`${testTempId}: Test '${test.title}' failed.`);

    if (!failedStep) {
      await rpClient.sendLog(testTempId, {
        level: 'ERROR' as any,
        message: `${err.stack}`,
      }).promise;
    }

    rpClient.finishTestItem(testTempId, {
      endTime: test.endTime || rpClient.helpers.now(),
      status: STATUSES.FAILED,
      // `message` is not declared on FinishTestItemOptions but the current JS
      // code sends it unchanged — keep it for byte-equivalence.
      ...( { message: `${err.stack}` } as Record<string, unknown> ),
    } as FinishTestItemOptions);
  });

  event.dispatcher.on(event.test.passed, (test: RpTest, _err: Error) => {
    debug(`${test.tempId}: Test '${test.title}' passed.`);
    rpClient.finishTestItem(test.tempId as string, {
      endTime: test.endTime || rpClient.helpers.now(),
      status: STATUSES.PASSED,
    });
  });

  event.dispatcher.on(event.test.after, (_test: RpTest) => {
    recorder.add(async () => {
      debug(`closing ${currentMetaSteps.length} metasteps for failed test`);
      if (failedStep) await finishStep(failedStep);
      await Promise.all(currentMetaSteps.reverse().map((m) => finishStep(m)));
      stepObj = null;
      testObj = null;
    });
  });

  event.dispatcher.on(event.suite.after, (suite: RpSuite) => {
    recorder.add(async () => {
      debug(`${suite.tempId}: Suite '${suite.title}' finished ${suiteStatus}.`);
      return rpClient.finishTestItem(suite.tempId as string, {
        endTime: suite.endTime || rpClient.helpers.now(),
        status: rpStatus(suiteStatus) as any,
      });
    });
  });

  function startTestItem(
    testTitle: string,
    method: string,
    parentId: string | null | undefined = null,
    stats: boolean | null = null,
  ): ClientResponse<unknown> | undefined {
    try {
      const hasStats = stats || (method !== TEST_ITEM_TYPES.STEP);
      return rpClient.startTestItem(
        {
          name: testTitle,
          type: method as any,
          hasStats,
        } as StartTestItemOptions,
        launchObj?.tempId as string,
        parentId as string,
      ) as ClientResponse<unknown>;
    } catch (error) {
      // Fixes legacy typo `output.err(error)`; see design Risks §.
      output.error(error as any);
      return undefined;
    }
  }

  event.dispatcher.on(event.all.result, async () => {
    // await recorder.promise;
    debug('Finishing launch...');
    if (suiteObj) {
      rpClient.finishTestItem(suiteObj.tempId, {
        status: suiteStatus as any,
      }).promise;
    }
    if (!process.env.RP_LAUNCH_ID) await finishLaunch();
  });

  function startLaunch(suiteTitle?: string): ClientResponse<unknown> {
    rpClient = new RPClient({
      apiKey: resolved.apiKey,
      endpoint: resolved.endpoint,
      project: resolved.project,
      launch: resolved.launch,
      debug: resolved.debug,
      restClientConfig: resolved.restClientConfig,
    } as any);

    const options: StartLaunchOptions & { id?: string } = {
      name: resolved.launch || suiteTitle,
      description: resolved.description,
      attributes: resolved.attributes as Attribute[],
      rerun: resolved.rerun,
      rerunOf: resolved.rerunOf,
      mode: resolved.mode as LAUNCH_MODES,
    };

    if (process.env.RP_LAUNCH_ID) {
      options.id = process.env.RP_LAUNCH_ID;
    }

    return rpClient.startLaunch(options) as ClientResponse<unknown>;
  }

  async function attachScreenshot(): Promise<ScreenshotFile | undefined> {
    if (!helper) return undefined;

    const fileName = `${rpClient.helpers.now()}.png`;
    try {
      await helper.saveScreenshot(fileName);
    } catch (err) {
      output.error("Couldn't save screenshot");
      return undefined;
    }

    // `output_dir` is declared globally by CodeceptJS's bundled typings; the
    // runtime sets it on `global`, so referencing the ambient identifier
    // works under `typeof globalThis` without augmentation.
    const content = fs.readFileSync(path.join(output_dir, fileName));
    fs.unlinkSync(path.join(output_dir, fileName));

    return {
      name: 'failed.png',
      type: 'image/png',
      content,
    };
  }

  async function finishLaunch(): Promise<void> {
    try {
      debug(`${launchObj?.tempId} Finished launch: ${launchStatus}`);
      const launch = rpClient.finishLaunch(launchObj?.tempId as string, {
        status: launchStatus as any,
      });

      const response = (await launch.promise) as { number: number; link: string };

      (output as any).print(` 📋 Report #${response.number} saved ➡`, response.link);
      event.emit('reportportal.result', response);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.log(error);
      debug(error);
    }
  }

  async function startMetaSteps(step: RpStep): Promise<RpStep | ClientResponse<unknown>> {
    let metaStepObj: any = {};
    const metaSteps = metaStepsToArray(step.metaStep as RpStep | null | undefined);

    // close current metasteps
    for (let j = currentMetaSteps.length - 1; j >= metaSteps.length; j--) {
      await finishStep(currentMetaSteps[j]);
    }

    for (const i in metaSteps) {
      const metaStep = metaSteps[i];
      if (isEqualMetaStep(metaStep, currentMetaSteps[i])) {
        metaStep.tempId = currentMetaSteps[i].tempId;
        continue;
      }
      // close metasteps other than current
      for (let j = currentMetaSteps.length - 1; j >= Number(i); j--) {
        await finishStep(currentMetaSteps[j]);
        delete currentMetaSteps[j];
      }

      metaStepObj = currentMetaSteps[Number(i) - 1] || metaStepObj;

      const isNested = !!metaStepObj.tempId;
      metaStepObj = startTestItem(
        metaStep.toString(),
        TEST_ITEM_TYPES.STEP,
        metaStepObj.tempId || (testObj && testObj.tempId),
        false,
      );
      metaStep.tempId = metaStepObj?.tempId;
      debug(`${metaStep.tempId}: The stepId '${metaStep.toString()}' is started. Nested: ${isNested}`);
    }

    currentMetaSteps = deepClone(metaSteps);
    return currentMetaSteps[currentMetaSteps.length - 1] || (testObj as ClientResponse<unknown>);
  }

  function finishStep(step: RpStep | undefined | null): ClientResponse<unknown> | undefined {
    if (!step) return undefined;
    if (!step.tempId) {
      debug(`WARNING: '${step.toString()}' step can't be closed, it has no tempId`);
      return undefined;
    }
    debug(`Finishing '${step.toString()}' step`);

    return rpClient.finishTestItem(step.tempId, {
      endTime: rpClient.helpers.now(),
      status: rpStatus(step.status) as any,
    }) as ClientResponse<unknown>;
  }

  return {
    addLog: logCurrent,
  };
}

export = plugin;
