// Servidor mínimo que imita la API RPC de Supabase (PostgREST) contra un
// Postgres real. Ejecuta las funciones con el rol "anon", igual que la
// clave pública en Supabase, para probar también los permisos.
import http from 'node:http';
import pg from 'pg';

pg.types.setTypeParser(1082, (v) => v); // date → "AAAA-MM-DD", como PostgREST

const ALLOWED = new Set(['start_run', 'submit_score', 'get_leaderboard', 'create_league', 'get_league']);
export const TEST_KEY = 'sb_publishable_integration';

export async function startRestServer(databaseUrl) {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'apikey, authorization, content-type');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }
    const reply = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
    };
    const fn = (req.url.match(/^\/rest\/v1\/rpc\/(\w+)$/) || [])[1];
    if (req.method !== 'POST' || !ALLOWED.has(fn)) return reply(404, { message: 'no encontrado' });
    if (req.headers.apikey !== TEST_KEY) return reply(401, { message: 'clave inválida' });

    let raw = '';
    for await (const chunk of req) raw += chunk;
    let args;
    try {
      args = JSON.parse(raw || '{}');
    } catch {
      return reply(400, { message: 'JSON inválido' });
    }
    const names = Object.keys(args);
    if (!names.every((n) => /^p_[a-z_]+$/.test(n))) return reply(400, { message: 'parámetros inválidos' });

    const sql = `select * from public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')})`;
    const client = await pool.connect();
    try {
      await client.query('set role anon');
      const result = await client.query(sql, names.map((n) => args[n]));
      reply(200, result.rows);
    } catch (e) {
      reply(400, { message: e.message, code: e.code });
    } finally {
      await client.query('reset role').catch(() => {});
      client.release();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    query: (text, params) => pool.query(text, params),
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await pool.end();
    },
  };
}
