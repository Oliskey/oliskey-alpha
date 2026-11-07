// Local database helper (Docker Postgres). Usage: node scripts/db.mjs <up|reset|test>
//   up    start (or create) the oliskey-alpha-app-db container
//   reset WIPE the local database and apply supabase/local + supabase/migrations in order
//   test  run supabase/tests/*.sql (each test rolls back its own changes)
//   admin <email>  give that user the admin role
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const CONTAINER = 'oliskey-alpha-app-db';
const DB = 'oliskey_alpha';
const ROOT = join(import.meta.dirname, '..');

function run(args, input) {
  const r = spawnSync('docker', args, { input, encoding: 'utf8', stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
  return { ok: r.status === 0, out: (r.stdout || '') + (r.stderr || '') };
}

function psql(db, sql, label) {
  const r = run(['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-q', '-f', '-'], sql);
  if (!r.ok) { console.error(`FAIL ${label}\n${r.out}`); process.exit(1); }
  return r.out;
}

function sqlFiles(dir) {
  return readdirSync(join(ROOT, dir)).filter((f) => f.endsWith('.sql')).sort().map((f) => join(dir, f));
}

const cmd = process.argv[2];

if (cmd === 'up') {
  const state = run(['inspect', '-f', '{{.State.Running}}', CONTAINER]);
  if (state.ok && state.out.trim() === 'true') console.log(`${CONTAINER} already running`);
  else if (state.ok) { run(['start', CONTAINER]); console.log(`${CONTAINER} started`); }
  else {
    const r = run(['run', '-d', '--name', CONTAINER,
      '-e', 'POSTGRES_PASSWORD=oliskey_alpha_local', '-e', `POSTGRES_DB=${DB}`,
      '-p', '127.0.0.1:54330:5432', '-v', 'oliskey-alpha-app-pgdata:/var/lib/postgresql/data',
      'postgres:17-alpine']);
    if (!r.ok) { console.error(r.out); process.exit(1); }
    console.log(`${CONTAINER} created on 127.0.0.1:54330`);
  }
  for (let i = 0; i < 30; i++) {
    if (run(['exec', CONTAINER, 'pg_isready', '-U', 'postgres', '-d', DB]).ok) { console.log('database ready'); process.exit(0); }
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.error('database did not become ready'); process.exit(1);
} else if (cmd === 'reset') {
  psql('postgres', `drop database if exists ${DB} with (force); create database ${DB};`, 'recreate database');
  for (const f of [...sqlFiles('supabase/local'), ...sqlFiles('supabase/migrations')]) {
    psql(DB, readFileSync(join(ROOT, f), 'utf8'), f);
    console.log(`applied ${f}`);
  }
} else if (cmd === 'test') {
  for (const f of sqlFiles('supabase/tests')) {
    process.stdout.write(psql(DB, readFileSync(join(ROOT, f), 'utf8'), f));
    console.log(`PASS ${f}`);
  }
} else if (cmd === 'admin') {
  const email = (process.argv[3] || '').toLowerCase();
  if (!/^[^\s@']+@[^\s@']+$/.test(email)) { console.error('usage: npm run db:admin -- <email>'); process.exit(1); }
  const out = psql(DB, `update profiles set is_admin = true where id = (select id from auth.users where email = '${email}') returning id;`, 'make admin');
  console.log(out.includes('(1 row)') ? `${email} is now an admin` : `no user with email ${email}`);
} else {
  console.error('usage: node scripts/db.mjs <up|reset|test|admin>'); process.exit(1);
}
