import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

export function openDatabase(file = ':memory:') {
  const database = new DatabaseSync(file);
  database.exec(readFileSync(new URL('../drizzle/0000_requests.sql', import.meta.url), 'utf8'));
  return {
    prepare(sql) {
      const statement = database.prepare(sql);
      return {
        bind(...values) {
          return {
            async first() { return statement.get(...values) ?? null; },
            async run() { return statement.run(...values); }
          };
        }
      };
    },
    close() { database.close(); }
  };
}
