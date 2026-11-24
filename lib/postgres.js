import pg from 'pg';

let ready;

export function database(connectionString) {
  ready ??= open(connectionString).catch(error => {
    ready = undefined;
    throw error;
  });
  return ready;
}

async function open(connectionString) {
  const pool = new pg.Pool({ connectionString, max: 3, connectionTimeoutMillis: 5000, idleTimeoutMillis: 5000, allowExitOnIdle: true });
  pool.on('error', () => console.error('AgreeMargin database connection failed'));
  try {
    await pool.query(`SELECT pg_advisory_xact_lock(1397047862);
    CREATE TABLE IF NOT EXISTS requests (
      id TEXT PRIMARY KEY, owner_hash TEXT NOT NULL, client_hash TEXT NOT NULL,
      details TEXT NOT NULL, created_at BIGINT NOT NULL, expires_at BIGINT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'decided', 'withdrawn')),
      choice TEXT, respondent TEXT, decided_at BIGINT
    );
    CREATE TABLE IF NOT EXISTS creation_limits (
      visitor TEXT PRIMARY KEY, window_end BIGINT NOT NULL, count INTEGER NOT NULL
    );`);
  } catch (error) {
    await pool.end();
    throw error;
  }
  return {
    prepare(sql) {
      let index = 0;
      const statement = sql.replaceAll('?', () => '$' + ++index).replace('count = count + 1', 'count = creation_limits.count + 1');
      return {
        bind(...values) {
          return {
            async first() {
              const { rows: [row] } = await pool.query(statement, values);
              if (!row) return null;
              for (const key of ['created_at', 'expires_at', 'decided_at']) {
                if (row[key] != null) row[key] = Number(row[key]);
              }
              return row;
            },
            run() { return pool.query(statement, values); }
          };
        }
      };
    }
  };
}
