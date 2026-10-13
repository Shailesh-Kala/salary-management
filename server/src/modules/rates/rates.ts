import { invalidField } from '../../lib/errors.ts';
import type { UpdateRateInput } from './rates.schemas.ts';

export type CurrentRate = { currencyCode: string; inrPerUnit: string; asOf: string };

/** Validates a rate update and returns the old → new values for the rate history. */
export function planRateChange(current: CurrentRate, input: UpdateRateInput, today: string) {
  if (current.currencyCode === 'INR') {
    throw invalidField('currency', 'INR is the base currency and is always 1');
  }
  if (input.asOf > today) throw invalidField('asOf', 'Rate date cannot be in the future');
  if (Number(input.inrPerUnit) === Number(current.inrPerUnit) && input.asOf === current.asOf) {
    throw invalidField('', 'Nothing changed: enter a new rate or date');
  }
  return {
    oldInrPerUnit: current.inrPerUnit,
    newInrPerUnit: input.inrPerUnit,
    oldAsOf: current.asOf,
    newAsOf: input.asOf,
  };
}

export type RateChange = ReturnType<typeof planRateChange>;
