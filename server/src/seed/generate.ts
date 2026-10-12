import { mulberry32 } from '../lib/prng.ts';
import type { EmployeeRow, NewEmployee } from '../modules/employees/employees.repository.ts';

export type SeedEmployee = NewEmployee &
  Pick<EmployeeRow, 'exitType' | 'noticeDate' | 'lastWorkingDay'>;

// Headcount share, local currency per USD (from the reference rate snapshot) and local pay level.
const COUNTRIES = [
  { code: 'IN', weight: 40, perUsd: 88.75, payLevel: 0.3 },
  { code: 'US', weight: 20, perUsd: 1, payLevel: 1 },
  { code: 'GB', weight: 10, perUsd: 88.75 / 118.4, payLevel: 0.8 },
  { code: 'DE', weight: 8, perUsd: 88.75 / 103.2, payLevel: 0.8 },
  { code: 'FR', weight: 7, perUsd: 88.75 / 103.2, payLevel: 0.75 },
  { code: 'SG', weight: 5, perUsd: 88.75 / 68.9, payLevel: 0.85 },
  { code: 'AU', weight: 5, perUsd: 88.75 / 58.3, payLevel: 0.85 },
  { code: 'CA', weight: 5, perUsd: 88.75 / 63.6, payLevel: 0.85 },
];

// Department → [job title, US base salary band min, max] in USD.
const DEPARTMENTS: Record<string, [string, number, number][]> = {
  Engineering: [
    ['Software Engineer', 90_000, 140_000],
    ['Senior Software Engineer', 130_000, 190_000],
    ['Engineering Manager', 170_000, 240_000],
  ],
  Product: [
    ['Product Manager', 110_000, 170_000],
    ['Senior Product Manager', 150_000, 210_000],
  ],
  Sales: [
    ['Account Executive', 60_000, 110_000],
    ['Sales Manager', 100_000, 160_000],
  ],
  Marketing: [
    ['Marketing Specialist', 55_000, 90_000],
    ['Marketing Manager', 90_000, 140_000],
  ],
  Finance: [
    ['Financial Analyst', 65_000, 100_000],
    ['Finance Manager', 100_000, 150_000],
  ],
  'Human Resources': [
    ['HR Generalist', 50_000, 80_000],
    ['HR Business Partner', 80_000, 120_000],
  ],
  Operations: [
    ['Operations Analyst', 55_000, 85_000],
    ['Operations Manager', 90_000, 130_000],
  ],
  'Customer Support': [
    ['Support Specialist', 40_000, 65_000],
    ['Support Team Lead', 60_000, 90_000],
  ],
};

const FIRST_NAMES = [
  'Aarav',
  'Aditi',
  'Ananya',
  'Arjun',
  'Asha',
  'Ben',
  'Carlos',
  'Chloe',
  'Daniel',
  'Dev',
  'Elena',
  'Emma',
  'Fatima',
  'Felix',
  'Grace',
  'Hana',
  'Ishaan',
  'Isla',
  'Jack',
  'Kavya',
  'Leon',
  'Lucas',
  'Maya',
  'Mei',
  'Mohammed',
  'Nina',
  'Noah',
  'Olivia',
  'Omar',
  'Priya',
  'Rahul',
  'Rohan',
  'Sara',
  'Sofia',
  'Tanvi',
  'Thomas',
  'Vikram',
  'Wei',
  'Yusuf',
  'Zoe',
];

const LAST_NAMES = [
  'Anderson',
  'Bauer',
  'Brown',
  'Carter',
  'Chen',
  'Dubois',
  'Fischer',
  'Garcia',
  'Gupta',
  'Hughes',
  'Iyer',
  'Jones',
  'Kapoor',
  'Khan',
  'Kumar',
  'Lambert',
  'Lee',
  'Martin',
  'Mehta',
  'Meyer',
  'Moreau',
  'Murphy',
  'Nair',
  'Nguyen',
  'Patel',
  'Reddy',
  'Rossi',
  'Schmidt',
  'Shah',
  'Singh',
  'Smith',
  'Tan',
  'Taylor',
  'Thomas',
  'Verma',
  'Walker',
  'Wang',
  'Wilson',
  'Wong',
  'Young',
];

/** Calendar arithmetic on 'YYYY-MM-DD' strings, in UTC so the local zone can't shift the day. */
export const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** Deterministic for a given (count, seed, today); dates are relative to `today`. */
export function generateEmployees({
  count,
  seed,
  today,
}: {
  count: number;
  seed: number;
  today: string;
}): SeedEmployee[] {
  const random = mulberry32(seed);
  const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
  const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)]!;
  const roundTo = (value: number, step: number) => Math.round(value / step) * step;
  const totalWeight = COUNTRIES.reduce((sum, c) => sum + c.weight, 0);
  const pickCountry = () => {
    let roll = random() * totalWeight;
    return COUNTRIES.find((c) => (roll -= c.weight) < 0) ?? COUNTRIES[0]!;
  };

  return Array.from({ length: count }, (_, i) => {
    const firstName = pick(FIRST_NAMES);
    const lastName = pick(LAST_NAMES);
    const country = pickCountry();
    const department = pick(Object.keys(DEPARTMENTS));
    const [jobTitle, min, max] = pick(DEPARTMENTS[department]!);
    const base = roundTo(int(min, max) * country.payLevel * country.perUsd, 1000);
    const allowances = roundTo(base * random() * 0.15, 100);
    const hireDate = addDays(today, -int(30, 365 * 11));

    // About 3% on notice (last working day still ahead) and 4% already exited.
    const roll = random();
    const onNotice = roll < 0.03;
    const noticeDate = onNotice ? addDays(today, -int(0, 30)) : addDays(today, -int(60, 400));
    const lastWorkingDay = addDays(noticeDate, onNotice ? int(30, 90) : int(30, 59));
    const leaves = roll < 0.07 && hireDate <= noticeDate;

    return {
      employeeCode: `EMP-${String(i + 1).padStart(5, '0')}`,
      firstName,
      lastName,
      email: `${firstName}.${lastName}.${i + 1}@acme.com`.toLowerCase(),
      jobTitle,
      department,
      countryCode: country.code,
      hireDate,
      baseSalary: String(base),
      allowances: String(allowances),
      exitType: leaves ? (onNotice || random() < 0.8 ? 'resigned' : 'terminated') : null,
      noticeDate: leaves ? noticeDate : null,
      lastWorkingDay: leaves ? lastWorkingDay : null,
    };
  });
}
