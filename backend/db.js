const hasPostgres = Boolean(process.env.DATABASE_URL);
const { AsyncLocalStorage } = require('async_hooks');
const transactionStore = new AsyncLocalStorage();

function normalizeRow(row) {
  if (!row) return row;
  const normalized = {};
  for (const [key, value] of Object.entries(row)) {
    if (typeof value === 'string' && /^-?\d+$/.test(value)) {
      const numeric = Number(value);
      normalized[key] = Number.isSafeInteger(numeric) ? numeric : value;
    } else {
      normalized[key] = value;
    }
  }
  return normalized;
}

function normalizeSql(sql, params) {
  let index = 0;
  let text = sql
    .replace(/\bMAX\(0,/gi, 'GREATEST(0,')
    .replace(/strftime\('%H',\s*created_at\)/gi, "TO_CHAR(created_at, 'HH24')")
    .replace(/datetime\('now',\s*'weekday 0',\s*'-7 days'\)/gi, "date_trunc('week', CURRENT_TIMESTAMP)")
    .replace(/datetime\('now',\s*'weekday 0',\s*'\+1 day'\)/gi, "date_trunc('week', CURRENT_TIMESTAMP) + INTERVAL '7 days'")
    .replace(/datetime\('now',\s*'weekday 1',\s*'-7 days'\)/gi, "date_trunc('week', CURRENT_TIMESTAMP)")
    .replace(/datetime\('now',\s*'weekday 1'\)/gi, "date_trunc('week', CURRENT_TIMESTAMP) + INTERVAL '7 days'")
    .replace(/created_at\s*>=\s*DATE\('now',\s*'-6 days'\)/gi, "created_at >= CURRENT_DATE - INTERVAL '6 days'")
    .replace(/created_at\s*>=\s*DATE\('now',\s*'-13 days'\)/gi, "created_at >= CURRENT_DATE - INTERVAL '13 days'")
    .replace(/\?/g, () => `$${++index}`);

  text = text.replace(/INSERT\s+OR\s+IGNORE\s+INTO\s+/i, 'INSERT INTO ');
  if (/^\s*INSERT\s+INTO\s+/i.test(text) && /ON\s+CONFLICT\s+DO\s+NOTHING/i.test(sql) === false && /INSERT\s+OR\s+IGNORE/i.test(sql)) {
    text += ' ON CONFLICT DO NOTHING';
  }

  if (/^\s*INSERT\s+INTO\s+(admins|admin_logs|bottles|bottle_replies|matches|user_picks|votes)\b/i.test(text) && !/\bRETURNING\b/i.test(text)) {
    text += ' RETURNING id';
  }

  return { text, values: params };
}

function createSqliteDb(sqliteDb) {
  return {
    prepare(sql) {
      const stmt = sqliteDb.prepare(sql);
      return {
        async all(...params) {
          return stmt.all(...params);
        },
        async get(...params) {
          return stmt.get(...params);
        },
        async run(...params) {
          return stmt.run(...params);
        }
      };
    },
    async exec(sql) {
      return sqliteDb.exec(sql);
    },
    transaction(fn) {
      return async (...args) => fn(...args);
    }
  };
}

function createPgDb(poolOrClient) {
  const api = {
    get queryable() {
      return transactionStore.getStore() || poolOrClient;
    },
    prepare(sql) {
      return {
        async all(...params) {
          const { text, values } = normalizeSql(sql, params);
          const result = await api.queryable.query(text, values);
          return result.rows.map(normalizeRow);
        },
        async get(...params) {
          const { text, values } = normalizeSql(sql, params);
          const result = await api.queryable.query(text, values);
          return normalizeRow(result.rows[0]);
        },
        async run(...params) {
          const { text, values } = normalizeSql(sql, params);
          const result = await api.queryable.query(text, values);
          const row = normalizeRow(result.rows[0]);
          return {
            changes: result.rowCount,
            lastInsertRowid: row?.id,
            rows: result.rows.map(normalizeRow)
          };
        }
      };
    },
    async exec(sql) {
      return api.queryable.query(sql);
    },
    transaction(fn) {
      return async (...args) => {
        if (!poolOrClient.connect) return fn(...args);
        const client = await poolOrClient.connect();
        try {
          await client.query('BEGIN');
          const result = await transactionStore.run(client, () => fn(...args));
          await client.query('COMMIT');
          return result;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      };
    }
  };
  return api;
}

if (hasPostgres) {
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false }
  });
  module.exports = createPgDb(pool);
} else {
  module.exports = createSqliteDb(require('./database'));
}
