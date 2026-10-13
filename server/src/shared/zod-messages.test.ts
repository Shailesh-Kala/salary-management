import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import './zod-messages.ts';
import {
  changeEventSchema,
  exitSchema,
  listEmployeesQuery,
} from '../modules/employees/employee.schemas.ts';
import { createEmployeeSchema } from './employee-rules.ts';
import { insightsQuery } from '../modules/insights/insights.schemas.ts';
import { updateRateSchema } from '../modules/rates/rates.schemas.ts';

/** What the API would tell the user: the message for each failing field. */
function messages(schema: z.ZodType, input: unknown) {
  const issues = schema.safeParse(input).error?.issues ?? [];
  return Object.fromEntries(issues.map((i) => [i.path.join('.'), i.message]));
}

const valid = {
  employeeCode: 'EMP-1',
  firstName: 'Asha',
  lastName: 'Verma',
  email: 'asha@acme.com',
  jobTitle: 'Engineer',
  department: 'Engineering',
  countryCode: 'IN',
  hireDate: '2024-04-01',
  baseSalary: '1800000',
};

describe('readable validation messages', () => {
  it('says what type was expected and how long text may be', () => {
    expect(
      messages(createEmployeeSchema, { ...valid, firstName: 5, lastName: 'x'.repeat(101) }),
    ).toEqual({ firstName: 'Expected text', lastName: 'Use at most 100 characters' });
  });

  it('lists the allowed values of a choice', () => {
    expect(
      messages(changeEventSchema, {
        version: 1,
        changeType: 'bonus',
        effectiveDate: '2026-10-01',
        note: 'ok note',
      }),
    ).toEqual({
      changeType:
        'Choose one of: annual_review, promotion, market_adjustment, relocation, correction, other',
    });
  });

  it('gives limits for short notes and small numbers', () => {
    expect(
      messages(exitSchema, {
        version: 0,
        exitType: 'resigned',
        noticeDate: '2026-10-01',
        lastWorkingDay: '2026-10-31',
        note: 'abc',
      }),
    ).toEqual({ version: 'Must be at least 1', note: 'Use at least 5 characters' });
  });

  it('names unknown fields', () => {
    expect(messages(createEmployeeSchema, { ...valid, salary: 1 })).toEqual({
      '': 'Unknown field: salary',
    });
  });

  it('explains bad query parameters instead of showing regular expressions', () => {
    expect(
      messages(listEmployeesQuery, { country: 'India', currency: 'US', page: '0', pageSize: 'x' }),
    ).toEqual({
      country: 'Use a two-letter country code',
      currency: 'Use a three-letter currency code, like USD',
      page: 'Must be at least 1',
      pageSize: 'Expected a number',
    });
    expect(messages(insightsQuery, { currency: 'rupee' })).toEqual({
      currency: 'Use a three-letter currency code, like USD',
    });
  });

  it('explains a bad exchange rate', () => {
    expect(messages(updateRateSchema, { inrPerUnit: '88,75', asOf: 'today' })).toEqual({
      inrPerUnit: 'Use a rate like 88.75 (up to 6 decimals)',
      asOf: 'Enter a valid date as YYYY-MM-DD',
    });
  });
});
