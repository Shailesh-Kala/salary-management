import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createEmployeeSchema } from '../modules/employees/employee.schemas.ts';
import { employeeStatus } from '../modules/employees/status.ts';
import { addDays } from '../lib/dates.ts';
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
    for (const {
      exitType: _e,
      noticeDate: _n,
      lastWorkingDay: _l,
      hire: _h,
      changes: _c,
      ...fields
    } of rows) {
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

  const yearAgo = addDays(TODAY, -365);
  const stayers = rows.filter((e) => !e.exitType);
  const ofType = (type: string) =>
    rows.flatMap((e) => e.changes.filter((c) => c.type === type).map((c) => ({ e, c })));

  it('gives most current employees an annual review within the last year', () => {
    const reviewed = stayers.filter((e) => e.changes.some((c) => c.type === 'annual_review'));

    expect(reviewed.length / stayers.length).toBeGreaterThan(0.7);
    for (const { c } of ofType('annual_review')) expect(c.date >= yearAgo).toBe(true);
  });

  it('promotes some employees to a different title with a raise', () => {
    const promotions = ofType('promotion');

    expect(promotions.length).toBeGreaterThan(20);
    for (const { e, c } of promotions) {
      const before = e.changes[e.changes.indexOf(c) - 1] ?? e.hire;
      expect(c.jobTitle).not.toBe(before.jobTitle);
      expect(Number(c.baseSalary)).toBeGreaterThan(Number(before.baseSalary));
    }
  });

  it('relocates a few employees to another country with new pay', () => {
    const relocations = ofType('relocation');

    expect(relocations.length).toBeGreaterThan(5);
    for (const { e, c } of relocations) {
      const before = e.changes[e.changes.indexOf(c) - 1] ?? e.hire;
      expect(c.countryCode).not.toBe(before.countryCode);
    }
  });

  it('keeps each history after the hire, within the last year and in order, ending at the current values', () => {
    for (const e of rows) {
      const dates = e.changes.map((c) => c.date);
      expect(dates).toEqual([...dates].sort());
      for (const date of dates) {
        expect(date > e.hireDate && date >= yearAgo && date <= TODAY).toBe(true);
        if (e.noticeDate) expect(date < e.noticeDate).toBe(true);
      }
      const latest = e.changes.at(-1) ?? e.hire;
      expect({
        baseSalary: e.baseSalary,
        allowances: e.allowances,
        jobTitle: e.jobTitle,
        countryCode: e.countryCode,
      }).toEqual({
        baseSalary: latest.baseSalary,
        allowances: latest.allowances,
        jobTitle: latest.jobTitle,
        countryCode: latest.countryCode,
      });
    }
  });
});
