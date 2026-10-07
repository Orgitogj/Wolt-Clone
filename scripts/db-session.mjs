import { spawn, spawnSync } from 'node:child_process';

export class PsqlSession {
  constructor(container, database, name) {
    this.name = name;
    this.buffer = '';
    this.waiters = [];

    this.process = spawn(
      'docker',
      [
        'exec', '-i', container, 'sh', '-c',
        `psql -U postgres -d ${database} -At 2>&1`,
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] }
    );

    const onData = (chunk) => {
      this.buffer += chunk.toString();
      this.waiters = this.waiters.filter((waiter) => {
        const index = this.buffer.indexOf(waiter.marker);
        if (index === -1) return true;
        const output = this.buffer.slice(0, index);
        this.buffer = this.buffer.slice(index + waiter.marker.length);
        waiter.resolve(output.trim());
        return false;
      });
    };

    this.process.stdout.on('data', onData);
    this.process.stderr.on('data', onData);
  }

  send(sql) {
    const marker = `__DONE_${Math.random().toString(36).slice(2)}__`;
    const promise = new Promise((resolve) => {
      this.waiters.push({ marker, resolve });
    });
    this.process.stdin.write(`${sql}\n\\echo ${marker}\n`);
    return promise;
  }

  close() {
    try {
      this.process.stdin.end();
      this.process.kill();
    } catch {
      return;
    }
  }
}

export const query = (container, database, sql) => {
  const result = spawnSync(
    'docker',
    [
      'exec', '-i', container, 'psql', '-U', 'postgres', '-d', database,
      '-At', '-v', 'ON_ERROR_STOP=1', '-f', '-',
    ],
    { input: sql, encoding: 'utf8' }
  );
  if (result.status !== 0) {
    throw new Error(`query failed: ${result.stderr || result.stdout}`);
  }
  return (result.stdout ?? '').trim();
};

export const waitForBlockedSessions = async (
  container,
  database,
  expected = 1,
  timeoutMs = 30000
) => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const blocked = Number(
      query(container, database, 'select count(*) from pg_locks where not granted;')
    );
    if (blocked >= expected) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`no session became blocked within ${timeoutMs}ms`);
};
