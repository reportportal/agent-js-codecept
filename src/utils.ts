import { STATUSES } from '@reportportal/client-javascript/constants';
import type { RpStep } from './models';

export function iterateMetaSteps(step: RpStep | null | undefined, fn: (metaStep: RpStep) => void): void {
  if (step && step.metaStep) iterateMetaSteps(step.metaStep, fn);
  if (step) fn(step);
}

export function metaStepsToArray(step: RpStep | null | undefined): RpStep[] {
  const metaSteps: RpStep[] = [];
  iterateMetaSteps(step, (metaStep) => metaSteps.push(metaStep));
  return metaSteps;
}

export function isEqualMetaStep(metastep1: RpStep | undefined, metastep2: RpStep | undefined): boolean {
  if (!metastep1 && !metastep2) return true;
  if (!metastep1 || !metastep2) return false;
  return (
    metastep1.actor === metastep2.actor
    && metastep1.name === metastep2.name
    && (metastep1.args || []).join(',') === (metastep2.args || []).join(',')
  );
}

export function rpStatus(status: string | undefined): string | undefined {
  if (status === 'success') return STATUSES.PASSED;
  if (status === 'failed') return STATUSES.FAILED;
  return status;
}
