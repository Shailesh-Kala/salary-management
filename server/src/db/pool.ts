import pg from 'pg';

// Calendar dates stay 'YYYY-MM-DD' strings; JS Date would shift them by the local offset (D-039).
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);

export function createPool(connectionString: string) {
  return new pg.Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 2000,
    statement_timeout: 5000,
    options: '-c TimeZone=UTC',
  });
}
