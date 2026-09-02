import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations');
const TESTS = path.join(ROOT, 'supabase', 'tests');

const CONTAINER = 'wolt-db-verify';
const IMAGE = 'postgres:16-alpine';
const PASSWORD = 'verify';
const DB = 'wolt_verify';

const docker = (args, options = {}) =>
  execFileSync('docker', args, { encoding: 'utf8', stdio: 'pipe', ...options });

const tryDocker = (args) => spawnSync('docker', args, { encoding: 'utf8' });

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

if (tryDocker(['version', '--format', '{{.Server.Version}}']).status !== 0) {
  fail('Docker is not running. Start Docker Desktop and re-run: npm run verify:db');
}

function cleanup() {
  tryDocker(['rm', '-f', CONTAINER]);
}

cleanup();
process.on('exit', cleanup);
process.on('SIGINT', () => process.exit(130));

console.log(`Starting throwaway ${IMAGE} container...`);
docker([
  'run', '--rm', '-d',
  '--name', CONTAINER,
  '-e', `POSTGRES_PASSWORD=${PASSWORD}`,
  '-e', `POSTGRES_DB=${DB}`,
  IMAGE,
]);

const deadline = Date.now() + 60000;
let ready = false;
while (Date.now() < deadline) {
  if (tryDocker(['exec', CONTAINER, 'pg_isready', '-U', 'postgres', '-d', DB]).status === 0) {
    ready = true;
    break;
  }
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
}
if (!ready) fail('Postgres did not become ready within 60s.');

function runSql(file) {
  const sql = fs.readFileSync(file, 'utf8');
  const label = path.basename(file);
  const result = spawnSync(
    'docker',
    ['exec', '-i', CONTAINER, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', DB, '-f', '-'],
    { input: sql, encoding: 'utf8' }
  );
  if (result.status !== 0) {
    console.error(result.stdout ?? '');
    console.error(result.stderr ?? '');
    fail(`FAILED: ${label}`);
  }
  return result.stderr ?? '';
}

console.log('Applying Supabase stubs...');
runSql(path.join(TESTS, '00_supabase_stubs.sql'));

const migrations = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
for (const file of migrations) {
  console.log(`Applying ${file}...`);
  runSql(path.join(MIGRATIONS, file));
}

const checks = fs.readdirSync(TESTS).filter((f) => f.endsWith('_checks.sql')).sort();

let passed = 0;
let failed = 0;

for (const check of checks) {
  console.log(`\n${check}`);
  const output = runSql(path.join(TESTS, check));
  const notices = output
    .split('\n')
    .filter((line) => line.includes('pass:') || line.includes('FAIL:'));
  notices.forEach((line) => console.log(line.replace(/^NOTICE:\s*/, '  ')));
  passed += notices.filter((line) => line.includes('pass:')).length;
  failed += notices.filter((line) => line.includes('FAIL:')).length;
}

console.log(`\n${passed} passed, ${failed} failed.`);

if (failed > 0) process.exit(1);
console.log('\nSchema, policies, order lifecycle and dispatch verified.\n');
