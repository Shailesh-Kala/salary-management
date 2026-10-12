import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createEmployeeSchema } from '../modules/employees/employee.schemas.ts';
import { employeeStatus } from '../modules/employees/status.ts';
import { generateEmployees } from './generate.ts';

const TODAY = '2026-10-12';
const checksum = (rows: unknown) => createHash('sha256').update(JSON.stringify(rows)).digest('hex');
const rows = generateEmployees({ count: 2000, seed: 42, today: TODAY });

describe('generateEmployees', () => {
  it('is deterministic for the same seed and day', () => {
    const again = generateEmployees({ count: 2000, seed: 42, today: TODAY });

    expect(again[0]).toEqual(rows[0]);
    expect(again.at(-1)).toEqual(rows.at(-1));
    expect(checksum(again)).toBe(checksum(rows));
  });

  it('changes with the seed', () => {
    expect(checksum(generateEmployees({ count: 2000, seed: 7, today: TODAY }))).not.toBe(
      checksum(rows),
    );
  });

  it('numbers employee codes sequentially and keeps emails unique', () => {
    expect(rows[0]!.employeeCode).toBe('EMP-00001');
    expect(rows.at(-1)!.employeeCode).toBe('EMP-02000');
    expect(new Set(rows.map((e) => e.email)).size).toBe(rows.length);
  });

  it('produces rows the create-employee schema accepts unchanged', () => {
    for (const { exitType: _e, noticeDate: _n, lastWorkingDay: _l, ...fields } of rows) {
      expect(createEmployeeSchema.parse(fields)).toEqual(fields);
    }
  });

  it('keeps dates in order and never in the future', () => {
    for (const e of rows) {
      expect(e.hireDate <= TODAY).toBe(true);
      if (e.exitType) {
        expect(e.hireDate <= e.noticeDate! && e.noticeDate! <= e.lastWorkingDay!).toBe(true);
        expect(e.noticeDate! <= TODAY).toBe(true);
      }
    }
  });

  it('is mostly active, with some employees on notice and some exited', () => {
    const counts = { active: 0, on_notice: 0, exited: 0 };
    for (const e of rows) counts[employeeStatus(e.lastWorkingDay, TODAY)]++;

    expect(counts.active / rows.length).toBeGreaterThan(0.85);
    expect(counts.on_notice).toBeGreaterThan(0);
    expect(counts.exited).toBeGreaterThan(0);
  });

  it('spreads employees over all 8 countries and every department', () => {
    expect(new Set(rows.map((e) => e.countryCode))).toEqual(
      new Set(['IN', 'US', 'GB', 'DE', 'FR', 'SG', 'AU', 'CA']),
    );
    expect(new Set(rows.map((e) => e.department)).size).toBe(8);
  });
});
