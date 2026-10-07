import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PsqlSession, query, waitForBlockedSessions } from './db-session.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations');
const TESTS = path.join(ROOT, 'supabase', 'tests');

const CONTAINER = 'wolt-db-concurrent';
const IMAGE = 'postgres:16-alpine';
const DB = 'wolt_concurrent';

const tryDocker = (args) => spawnSync('docker', args, { encoding: 'utf8' });

let passed = 0;
let failed = 0;
const sessions = [];

const fail = (message) => {
  console.error(`\n${message}\n`);
  cleanup();
  process.exit(1);
};

function cleanup() {
  sessions.forEach((session) => session.close());
  tryDocker(['rm', '-f', CONTAINER]);
}

const assert = (condition, label) => {
  if (condition) {
    passed += 1;
    console.log(`  pass: ${label}`);
  } else {
    failed += 1;
    console.error(`  FAIL: ${label}`);
  }
};

const sql = (text) => query(CONTAINER, DB, text);

const openSession = (name) => {
  const session = new PsqlSession(CONTAINER, DB, name);
  sessions.push(session);
  return session;
};

const actAs = (userId) =>
  `select set_config('request.jwt.claims', json_build_object('sub','${userId}','role','authenticated','is_anonymous',false)::text, false);`;

const errored = (output) => /ERROR:/i.test(output);

const lastValue = (output) =>
  output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).pop() ?? '';

if (tryDocker(['version', '--format', '{{.Server.Version}}']).status !== 0) {
  fail('Docker is not running. Start Docker Desktop and re-run: npm run verify:db:concurrent');
}

cleanup();
process.on('exit', cleanup);
process.on('SIGINT', () => process.exit(130));

console.log(`Starting throwaway ${IMAGE} container...`);
execFileSync('docker', [
  'run', '--rm', '-d',
  '--name', CONTAINER,
  '-e', 'POSTGRES_PASSWORD=verify',
  '-e', `POSTGRES_DB=${DB}`,
  IMAGE,
]);

const deadline = Date.now() + 120000;
let stable = 0;
while (Date.now() < deadline && stable < 3) {
  const ok =
    tryDocker(['exec', CONTAINER, 'pg_isready', '-U', 'postgres', '-d', DB]).status === 0 &&
    tryDocker(['exec', CONTAINER, 'psql', '-U', 'postgres', '-d', DB, '-tAc', 'select 1']).status === 0;
  stable = ok ? stable + 1 : 0;
  if (stable < 3) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400);
}
if (stable < 3) fail('Postgres did not become ready.');

const applyFile = (file) => {
  const result = spawnSync(
    'docker',
    ['exec', '-i', CONTAINER, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', DB, '-f', '-'],
    { input: fs.readFileSync(file, 'utf8'), encoding: 'utf8' }
  );
  if (result.status !== 0) {
    console.error(result.stdout ?? '');
    console.error(result.stderr ?? '');
    fail(`FAILED to apply ${path.basename(file)}`);
  }
};

console.log('Applying Supabase stubs and migrations...');
applyFile(path.join(TESTS, '00_supabase_stubs.sql'));
fs.readdirSync(MIGRATIONS)
  .filter((file) => file.endsWith('.sql'))
  .sort()
  .forEach((file) => applyFile(path.join(MIGRATIONS, file)));

console.log('Seeding fixtures...');
sql(`
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'race-a@test.local'),
  ('22222222-2222-4222-8222-222222222222', 'race-b@test.local'),
  ('33333333-3333-4333-8333-333333333333', 'race-admin@test.local');

update public.profiles set role = 'admin' where id = '33333333-3333-4333-8333-333333333333';

insert into public.restaurants (id, name, min_order, is_open, latitude, longitude)
values ('44444444-4444-4444-8444-444444444444', 'Race Kitchen', 0, true, 51.9625, 7.6257);

insert into public.menu_categories (id, restaurant_id, name)
values ('55555555-5555-4555-8555-555555555555', '44444444-4444-4444-8444-444444444444', 'Mains');

insert into public.dishes (id, restaurant_id, menu_category_id, name, price, is_available)
values ('66666666-6666-4666-8666-666666666666', '44444444-4444-4444-8444-444444444444',
        '55555555-5555-4555-8555-555555555555', 'Race Dish', 10.00, true);

insert into public.addresses (id, user_id, label, address_line, latitude, longitude) values
  ('77777777-7777-4777-8777-777777777777', '11111111-1111-4111-8111-111111111111', 'Home', 'Racestreet 1', 51.9650, 7.6300),
  ('88888888-8888-4888-8888-888888888888', '22222222-2222-4222-8222-222222222222', 'Home', 'Racestreet 2', 51.9650, 7.6300);

insert into auth.users (id, email) values
  ('99999999-9999-4999-8999-999999999999', 'race-courier-a@test.local'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'race-courier-b@test.local');

insert into public.couriers (id, full_name, verification_status, availability) values
  ('99999999-9999-4999-8999-999999999999', 'Race Courier A', 'approved', 'online'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Race Courier B', 'approved', 'online');
`);

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const ADMIN = '33333333-3333-4333-8333-333333333333';
const RESTAURANT = '44444444-4444-4444-8444-444444444444';
const DISH = '66666666-6666-4666-8666-666666666666';
const ADDRESS_A = '77777777-7777-4777-8777-777777777777';
const ADDRESS_B = '88888888-8888-4888-8888-888888888888';

const createPromotion = (code, { maxRedemptions = null, maxPerCustomer = 1 } = {}) =>
  sql(`
    ${actAs(ADMIN)}
    select (public.admin_save_promotion(
      null, '${code}', 'race test', 'fixed', 2, null, 0, null, null, null,
      ${maxRedemptions === null ? 'null' : maxRedemptions}, ${maxPerCustomer}, true)).id;
  `);

const orderCall = (code, addressId, idempotencyKey) => `
select (public.create_order(
  '${RESTAURANT}'::uuid,
  jsonb_build_array(jsonb_build_object('dish_id','${DISH}','quantity',2,'addon_ids','[]'::jsonb)),
  'delivery', '${addressId}'::uuid, null, 0, 'cash', false, false,
  '${idempotencyKey}'::uuid, ${code === null ? 'null' : `'${code}'`})).id;`;

const uuid = () => crypto.randomUUID();

const redemptionCount = (code, states = "'reserved','consumed'") =>
  Number(
    sql(`select count(*) from public.promotion_redemptions pr
           join public.promotions p on p.id = pr.promotion_id
          where upper(p.code) = upper('${code}') and pr.state in (${states});`)
  );

const run = async () => {
  console.log('\nconcurrent: two customers race for the last global redemption');
  {
    createPromotion('RACEGLOBAL', { maxRedemptions: 1, maxPerCustomer: 5 });

    const a = openSession('a');
    const b = openSession('b');

    await a.send('begin;');
    await b.send('begin;');
    await a.send(actAs(USER_A));
    await b.send(actAs(USER_B));

    const aResult = await a.send(orderCall('RACEGLOBAL', ADDRESS_A, uuid()));
    assert(!errored(aResult), 'the first customer reserves the last redemption');

    const bPending = b.send(orderCall('RACEGLOBAL', ADDRESS_B, uuid()));
    await waitForBlockedSessions(CONTAINER, DB, 1);
    assert(true, 'the second customer blocks on the promotion row lock');

    await a.send('commit;');
    const bResult = await bPending;
    assert(errored(bResult), 'the second customer is refused once the cap is taken');
    await b.send('rollback;');

    assert(redemptionCount('RACEGLOBAL') === 1, 'exactly one redemption exists after the race');
    assert(
      Number(sql(`select count(*) from public.orders where promo_code = 'RACEGLOBAL';`)) === 1,
      'exactly one order carries the code'
    );

    a.close();
    b.close();
  }

  console.log('\nconcurrent: one customer races their own per-customer cap');
  {
    createPromotion('RACEPERCUST', { maxPerCustomer: 1 });

    const a = openSession('a2');
    const b = openSession('b2');

    await a.send('begin;');
    await b.send('begin;');
    await a.send(actAs(USER_A));
    await b.send(actAs(USER_A));

    const first = await a.send(orderCall('RACEPERCUST', ADDRESS_A, uuid()));
    assert(!errored(first), 'the first checkout reserves the code');

    const pending = b.send(orderCall('RACEPERCUST', ADDRESS_A, uuid()));
    await waitForBlockedSessions(CONTAINER, DB, 1);

    await a.send('commit;');
    const second = await pending;
    assert(errored(second), 'the same customer cannot use the code twice concurrently');
    await b.send('rollback;');

    assert(redemptionCount('RACEPERCUST') === 1, 'the per customer cap holds under a race');

    a.close();
    b.close();
  }

  console.log('\nconcurrent: simultaneous retries with one idempotency key');
  {
    createPromotion('RACEIDEM', { maxRedemptions: 5, maxPerCustomer: 5 });
    const key = uuid();

    const a = openSession('a3');
    const b = openSession('b3');

    await a.send('begin;');
    await b.send('begin;');
    await a.send(actAs(USER_A));
    await b.send(actAs(USER_A));

    const first = await a.send(orderCall('RACEIDEM', ADDRESS_A, key));
    assert(!errored(first), 'the first retry creates the order');

    const pending = b.send(orderCall('RACEIDEM', ADDRESS_A, key));
    await waitForBlockedSessions(CONTAINER, DB, 1);

    await a.send('commit;');
    const second = await pending;
    await b.send('commit;');

    const orderCount = Number(
      sql(`select count(*) from public.orders where idempotency_key = '${key}'::uuid;`)
    );
    assert(orderCount === 1, 'two simultaneous retries create exactly one order');
    assert(
      redemptionCount('RACEIDEM') === 1,
      'two simultaneous retries consume exactly one redemption'
    );
    assert(
      errored(second) || second.trim() === first.trim(),
      'the losing retry either returns the same order or is refused, never a second order'
    );

    a.close();
    b.close();
  }

  console.log('\nconcurrent: competing cancellations release exactly once');
  {
    createPromotion('RACECANCEL', { maxRedemptions: 5, maxPerCustomer: 5 });
    const key = uuid();
    sql(`${actAs(USER_A)} ${orderCall('RACECANCEL', ADDRESS_A, key)}`);
    const orderId = sql(
      `select id from public.orders where idempotency_key = '${key}'::uuid;`
    );

    const a = openSession('a4');
    const b = openSession('b4');

    await a.send('begin;');
    await b.send('begin;');
    await a.send(actAs(ADMIN));
    await b.send(actAs(ADMIN));

    const cancelA = await a.send(
      `select (public.transition_order_status('${orderId}'::uuid, 'cancelled'::public.order_status, 'race a')).id is not null;`
    );
    const pendingB = b.send(
      `select (public.transition_order_status('${orderId}'::uuid, 'cancelled'::public.order_status, 'race b')).id is not null;`
    );
    await waitForBlockedSessions(CONTAINER, DB, 1);

    await a.send('commit;');
    const cancelB = await pendingB;
    await b.send('commit;');

    assert(!errored(cancelA), 'the first cancellation succeeds');
    assert(
      !errored(cancelB),
      'the second cancellation is an idempotent no-op rather than an error'
    );
    assert(
      Number(
        sql(`select count(*) from public.order_status_history
              where order_id = '${orderId}'::uuid and to_status = 'cancelled';`)
      ) === 1,
      'a repeated cancellation writes only one history row'
    );

    const released = Number(
      sql(`select count(*) from public.promotion_redemptions
            where order_id = '${orderId}'::uuid and state = 'released';`)
    );
    assert(released === 1, 'the redemption is released exactly once');
    assert(redemptionCount('RACECANCEL') === 0, 'the released redemption frees the cap');

    a.close();
    b.close();
  }

  console.log('\nconcurrent: cancellation racing a successful payment');
  {
    sql(`update public.platform_settings set card_payments_enabled = true;`);
    createPromotion('RACEPAY', { maxRedemptions: 5, maxPerCustomer: 5 });
    const key = uuid();
    sql(`${actAs(USER_A)}
      select (public.create_order(
        '${RESTAURANT}'::uuid,
        jsonb_build_array(jsonb_build_object('dish_id','${DISH}','quantity',2,'addon_ids','[]'::jsonb)),
        'delivery', '${ADDRESS_A}'::uuid, null, 0, 'card', false, false,
        '${key}'::uuid, 'RACEPAY')).id;`);

    const orderId = sql(`select id from public.orders where idempotency_key = '${key}'::uuid;`);
    const status = sql(`select status from public.orders where id = '${orderId}'::uuid;`);
    assert(status === 'pending_payment', 'a discounted card order waits for payment');

    sql(`update public.payments set provider_intent_id = 'pi_race'
          where order_id = '${orderId}'::uuid;`);

    const a = openSession('a5');
    const b = openSession('b5');

    await a.send('begin;');
    await b.send('begin;');

    const confirmed = await a.send(
      `select (public.confirm_payment('pi_race', 'ch_race', 'evt_race', '{}'::jsonb)).id is not null;`
    );
    const pendingCancel = b.send(
      `${actAs(ADMIN)} select (public.transition_order_status('${orderId}'::uuid, 'cancelled'::public.order_status, 'race cancel')).id is not null;`
    );
    await waitForBlockedSessions(CONTAINER, DB, 1);

    await a.send('commit;');
    const cancelResult = await pendingCancel;
    await b.send('commit;');

    assert(!errored(confirmed), 'the webhook confirms the payment');

    const finalStatus = sql(`select status from public.orders where id = '${orderId}'::uuid;`);
    const redemptionState = sql(
      `select state from public.promotion_redemptions where order_id = '${orderId}'::uuid;`
    );

    const cancelWon = finalStatus === 'cancelled';
    assert(
      cancelWon ? redemptionState === 'released' : redemptionState !== 'released',
      'a paid order that stays valid keeps its redemption reserved, and a cancelled one releases it'
    );
    assert(
      !(finalStatus === 'placed' && redemptionState === 'released'),
      'a valid paid order never ends up with a released redemption'
    );

    if (!cancelWon) {
      assert(errored(cancelResult), 'cancelling a paid order after the webhook is rejected');
    }

    a.close();
    b.close();
  }

  console.log('\nconcurrent: abandoned pending card orders release their reservation');
  {
    createPromotion('RACEEXPIRE', { maxRedemptions: 1, maxPerCustomer: 5 });
    const key = uuid();
    sql(`${actAs(USER_A)}
      select (public.create_order(
        '${RESTAURANT}'::uuid,
        jsonb_build_array(jsonb_build_object('dish_id','${DISH}','quantity',2,'addon_ids','[]'::jsonb)),
        'delivery', '${ADDRESS_A}'::uuid, null, 0, 'card', false, false,
        '${key}'::uuid, 'RACEEXPIRE')).id;`);

    const orderId = sql(`select id from public.orders where idempotency_key = '${key}'::uuid;`);
    assert(redemptionCount('RACEEXPIRE') === 1, 'the abandoned order holds the cap while pending');

    sql(`update public.orders
            set created_at = now() - make_interval(mins => (
                  select payment_hold_minutes + 10 from public.platform_settings))
          where id = '${orderId}'::uuid;`);

    const expired = Number(sql('select public.expire_unpaid_orders();'));
    assert(expired >= 1, 'the expiry job picks up the abandoned order');

    assert(
      sql(`select status from public.orders where id = '${orderId}'::uuid;`) === 'payment_failed',
      'the abandoned order is marked payment_failed'
    );
    assert(
      sql(`select state from public.promotion_redemptions where order_id = '${orderId}'::uuid;`) ===
        'released',
      'expiring an abandoned order releases its redemption'
    );
    assert(redemptionCount('RACEEXPIRE') === 0, 'the freed cap is available again');
  }

  console.log('\nconcurrent: a late payment cannot revive an expired discounted order');
  {
    const orderId = sql(
      `select id from public.orders where promo_code = 'RACEEXPIRE' order by created_at desc limit 1;`
    );
    sql(`update public.payments set provider_intent_id = 'pi_late' where order_id = '${orderId}'::uuid;`);

    const late = spawnSync(
      'docker',
      ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', DB, '-At', '-f', '-'],
      {
        input: `select (public.confirm_payment('pi_late', 'ch_late', 'evt_late', '{}'::jsonb)).id is not null;`,
        encoding: 'utf8',
      }
    );
    const output = `${late.stdout ?? ''}${late.stderr ?? ''}`;

    const finalStatus = sql(`select status from public.orders where id = '${orderId}'::uuid;`);
    const redemptionState = sql(
      `select state from public.promotion_redemptions where order_id = '${orderId}'::uuid;`
    );

    assert(
      finalStatus !== 'placed',
      'a late payment never silently places an expired discounted order'
    );
    assert(
      redemptionState === 'released',
      'a late payment never re-reserves a released redemption behind the cap'
    );
    assert(
      /ERROR:/i.test(output) || finalStatus === 'payment_failed',
      'the late webhook is either rejected or leaves the failed order alone'
    );
  }

  console.log('\nconcurrent: two workers claim the refund queue');
  {
    sql(`update public.platform_settings set card_payments_enabled = true;`);

    const keys = [uuid(), uuid(), uuid()];
    keys.forEach((key) => {
      sql(`${actAs(USER_A)}
        select (public.create_order(
          '${RESTAURANT}'::uuid,
          jsonb_build_array(jsonb_build_object('dish_id','${DISH}','quantity',2,'addon_ids','[]'::jsonb)),
          'delivery', '${ADDRESS_A}'::uuid, null, 0, 'card', false, false,
          '${key}'::uuid, null)).id;`);
      const orderId = sql(`select id from public.orders where idempotency_key = '${key}'::uuid;`);
      sql(`
        update public.payments set provider_intent_id = 'pi_${key.slice(0, 8)}'
         where order_id = '${orderId}'::uuid;
        update public.orders set created_at = now() - make_interval(mins => (
          select payment_hold_minutes + 10 from public.platform_settings))
         where id = '${orderId}'::uuid;
      `);
    });

    sql(`select set_config('request.jwt.claims', '', false); select public.expire_unpaid_orders();`);

    sql(`update public.payment_reconciliations set state = 'resolved', resolved_at = now()
          where state <> 'resolved';`);

    keys.forEach((key) => {
      sql(`select set_config('request.jwt.claims', '', false);
           select (public.confirm_payment('pi_${key.slice(0, 8)}', 'ch_x', 'evt_${key.slice(0, 8)}', '{}'::jsonb)).id;`);
    });

    const queued = Number(
      sql(`select count(*) from public.payment_reconciliations where state = 'pending';`)
    );
    assert(queued === 3, `three abandoned card orders queue a refund each (got ${queued})`);

    const workerA = openSession('worker-a');
    const workerB = openSession('worker-b');

    await workerA.send('begin;');
    await workerB.send('begin;');

    const claimedA = await workerA.send(
      `select count(*) from public.claim_payment_reconciliations(2, 300);`
    );
    const pendingB = workerB.send(
      `select count(*) from public.claim_payment_reconciliations(5, 300);`
    );
    await workerA.send('commit;');
    const claimedB = await pendingB;
    await workerB.send('commit;');

    const totalA = Number((claimedA.match(/\d+/) ?? ['0'])[0]);
    const totalB = Number((claimedB.match(/\d+/) ?? ['0'])[0]);

    assert(totalA === 2, 'the first worker claims a bounded batch');
    assert(totalA + totalB === 3, 'two concurrent workers never claim the same job twice');

    assert(
      Number(
        sql(`select count(*) from public.payment_reconciliations where state = 'in_progress';`)
      ) === 3,
      'every claimed job is leased'
    );
    assert(
      Number(
        sql(`select count(*) from public.payment_reconciliations
              where state = 'in_progress' and next_attempt_at > now();`)
      ) === 3,
      'a claimed job is not visible again while its lease is live'
    );

    workerA.close();
    workerB.close();
  }

  console.log('\nconcurrent: a crashed worker releases its lease');
  {
    assert(
      Number(sql(`select count(*) from public.claim_payment_reconciliations(10, 300);`)) === 0,
      'leased jobs are not handed out again while the lease holds'
    );

    sql(`update public.payment_reconciliations
            set next_attempt_at = now() - interval '1 minute'
          where state = 'in_progress';`);

    const recovered = Number(sql(`select count(*) from public.claim_payment_reconciliations(10, 300);`));
    assert(recovered === 3, 'an expired lease makes a crashed job claimable again');

    assert(
      Number(
        sql(`select count(*) from public.payment_reconciliations where attempts >= 2;`)
      ) === 3,
      'recovering a crashed job counts another attempt'
    );
  }

  console.log('\nconcurrent: an admin retry never steals a live lease');
  {
    const recId = sql(
      `select id from public.payment_reconciliations where state = 'in_progress' limit 1;`
    );

    const blocked = spawnSync(
      'docker',
      ['exec', '-i', CONTAINER, 'sh', '-c', `psql -U postgres -d ${DB} -At 2>&1`],
      {
        input: `${actAs(ADMIN)}
          select (public.admin_retry_payment_reconciliation('${recId}'::uuid, 'manual recovery')).state;`,
        encoding: 'utf8',
      }
    );
    const blockedOutput = `${blocked.stdout ?? ''}${blocked.stderr ?? ''}`;
    assert(/ERROR/i.test(blockedOutput), 'an admin retry is refused while a worker lease is live');

    sql(`update public.payment_reconciliations
            set next_attempt_at = now() - interval '1 minute'
          where id = '${recId}'::uuid;`);

    const allowed = spawnSync(
      'docker',
      ['exec', '-i', CONTAINER, 'sh', '-c', `psql -U postgres -d ${DB} -At 2>&1`],
      {
        input: `${actAs(ADMIN)}
          select (public.admin_retry_payment_reconciliation('${recId}'::uuid, 'manual recovery')).state;`,
        encoding: 'utf8',
      }
    );
    const allowedOutput = `${allowed.stdout ?? ''}${allowed.stderr ?? ''}`;
    assert(
      !/ERROR/i.test(allowedOutput) && /pending/.test(allowedOutput),
      'an admin retry requeues a job whose lease expired'
    );

    assert(
      Number(
        sql(`select count(*) from public.payment_reconciliations where payment_id = (
               select payment_id from public.payment_reconciliations where id = '${recId}'::uuid);`)
      ) === 1,
      'an admin retry never creates a duplicate queue record'
    );
  }

  console.log('\nconcurrent: sending races a courier reassignment');
  {
    const key = uuid();
    sql(`${actAs(USER_A)} ${orderCall(null, ADDRESS_A, key)}`);
    const orderId = sql(`select id from public.orders where idempotency_key = '${key}'::uuid;`);

    sql(`
      insert into public.deliveries (order_id, restaurant_id, courier_id, status, assigned_at)
      values ('${orderId}'::uuid, '${RESTAURANT}'::uuid, '99999999-9999-4999-8999-999999999999'::uuid, 'assigned', now())
      on conflict (order_id) do update
        set courier_id = '99999999-9999-4999-8999-999999999999'::uuid, status = 'assigned', assigned_at = now();
    `);

    const courierSession = openSession('chat-a');
    const reassignSession = openSession('chat-b');

    await courierSession.send('begin;');
    await reassignSession.send('begin;');

    await reassignSession.send(
      `update public.deliveries set courier_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
        where order_id = '${orderId}'::uuid;`
    );

    await courierSession.send(actAs('99999999-9999-4999-8999-999999999999'));
    const pendingSend = courierSession.send(
      `select (public.send_order_message('${orderId}'::uuid, '${uuid()}'::uuid, 'I am outside')).id;`
    );
    await waitForBlockedSessions(CONTAINER, DB, 1);
    assert(true, 'the send blocks on the delivery row while a reassignment is open');

    await reassignSession.send('commit;');
    const sendResult = await pendingSend;
    await courierSession.send('rollback;');

    assert(
      errored(sendResult),
      'a courier losing the assignment mid send cannot write the message'
    );
    assert(
      Number(sql(`select count(*) from public.order_messages where order_id = '${orderId}'::uuid;`)) === 0,
      'no message is stored for the replaced courier'
    );
    assert(
      sql(`select courier_id from public.deliveries where order_id = '${orderId}'::uuid;`) ===
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'the reassignment wins the race'
    );

    courierSession.close();
    reassignSession.close();
  }

  console.log('\nconcurrent: duplicate sends with one client message id');
  {
    const key = uuid();
    sql(`${actAs(USER_A)} ${orderCall(null, ADDRESS_A, key)}`);
    const orderId = sql(`select id from public.orders where idempotency_key = '${key}'::uuid;`);

    sql(`
      insert into public.deliveries (order_id, restaurant_id, courier_id, status, assigned_at)
      values ('${orderId}'::uuid, '${RESTAURANT}'::uuid, '99999999-9999-4999-8999-999999999999'::uuid, 'assigned', now())
      on conflict (order_id) do update
        set courier_id = '99999999-9999-4999-8999-999999999999'::uuid, status = 'assigned';
    `);

    const clientId = uuid();
    const a = openSession('dup-a');
    const b = openSession('dup-b');

    await a.send('begin;');
    await b.send('begin;');
    await a.send(actAs(USER_A));
    await b.send(actAs(USER_A));

    const first = await a.send(
      `select (public.send_order_message('${orderId}'::uuid, '${clientId}'::uuid, 'Hello')).id;`
    );
    assert(!errored(first), 'the first send stores the message');

    const pending = b.send(
      `select (public.send_order_message('${orderId}'::uuid, '${clientId}'::uuid, 'Hello')).id;`
    );
    await waitForBlockedSessions(CONTAINER, DB, 1);

    await a.send('commit;');
    const second = await pending;
    await b.send('commit;');

    assert(
      Number(sql(`select count(*) from public.order_messages where order_id = '${orderId}'::uuid;`)) === 1,
      'two simultaneous sends with one client id store exactly one message'
    );
    assert(
      errored(second) || second.trim() === first.trim(),
      'the losing duplicate returns the original message or is refused'
    );
    assert(
      Number(
        sql(`select count(*) from public.notifications
              where order_id = '${orderId}'::uuid and kind = 'order_message';`)
      ) === 1,
      'a duplicate send never creates a second notification'
    );

    a.close();
    b.close();
  }

  const prepareChatOrder = (statusPath) => {
    const key = uuid();
    sql(`${actAs(USER_A)} ${orderCall(null, ADDRESS_A, key)}`);
    const orderId = sql(`select id from public.orders where idempotency_key = '${key}'::uuid;`);

    sql(`
      insert into public.deliveries (order_id, restaurant_id, courier_id, status, assigned_at)
      values ('${orderId}'::uuid, '${RESTAURANT}'::uuid, '99999999-9999-4999-8999-999999999999'::uuid, 'assigned', now())
      on conflict (order_id) do update
        set courier_id = '99999999-9999-4999-8999-999999999999'::uuid, status = 'assigned', assigned_at = now();
    `);

    statusPath.forEach((status) => {
      sql(`${actAs(ADMIN)}
        select (public.transition_order_status('${orderId}'::uuid, '${status}'::public.order_status)).id;`);
    });

    return orderId;
  };

  console.log('\nconcurrent: sending races delivery completion');
  {
    const orderId = prepareChatOrder([
      'accepted', 'preparing', 'ready_for_pickup', 'courier_assigned', 'picked_up', 'delivering',
    ]);

    const sender = openSession('chat-send-deliver');
    const closer = openSession('chat-close-deliver');

    await sender.send('begin;');
    await closer.send('begin;');

    await closer.send(actAs(ADMIN));
    await closer.send(
      `select (public.transition_order_status('${orderId}'::uuid, 'delivered'::public.order_status)).id;`
    );

    await sender.send(actAs(USER_A));
    const pendingSend = sender.send(
      `select (public.send_order_message('${orderId}'::uuid, '${uuid()}'::uuid, 'Are you close?')).id;`
    );
    await waitForBlockedSessions(CONTAINER, DB, 1);
    assert(true, 'the send blocks while the closing transaction holds the order');

    await closer.send('commit;');
    const sendResult = await pendingSend;
    await sender.send('commit;');

    assert(
      errored(sendResult),
      'a send that loses to delivery is rejected rather than accepted on stale state'
    );
    assert(
      Number(sql(`select count(*) from public.order_messages where order_id = '${orderId}'::uuid;`)) === 0,
      'no message is stored once delivery committed first'
    );
    assert(
      sql(`select status from public.orders where id = '${orderId}'::uuid;`) === 'delivered',
      'the order is delivered'
    );

    sender.close();
    closer.close();
  }

  console.log('\nconcurrent: sending races a cancellation');
  {
    const orderId = prepareChatOrder(['accepted']);

    const sender = openSession('chat-send-cancel');
    const closer = openSession('chat-close-cancel');

    await sender.send('begin;');
    await closer.send('begin;');

    await closer.send(actAs(ADMIN));
    await closer.send(
      `select (public.transition_order_status('${orderId}'::uuid, 'cancelled'::public.order_status, 'customer cancelled')).id;`
    );

    await sender.send(actAs(USER_A));
    const pendingSend = sender.send(
      `select (public.send_order_message('${orderId}'::uuid, '${uuid()}'::uuid, 'Still coming?')).id;`
    );
    await waitForBlockedSessions(CONTAINER, DB, 1);

    await closer.send('commit;');
    const sendResult = await pendingSend;
    await sender.send('commit;');

    assert(errored(sendResult), 'a send that loses to cancellation is rejected');
    assert(
      Number(sql(`select count(*) from public.order_messages where order_id = '${orderId}'::uuid;`)) === 0,
      'no message is stored once cancellation committed first'
    );

    sender.close();
    closer.close();
  }

  console.log('\nconcurrent: a send that wins is kept and stays retryable');
  {
    const orderId = prepareChatOrder([
      'accepted', 'preparing', 'ready_for_pickup', 'courier_assigned', 'picked_up', 'delivering',
    ]);
    const clientId = uuid();

    const sender = openSession('chat-send-wins');
    const closer = openSession('chat-close-after');

    await sender.send('begin;');
    await sender.send(actAs(USER_A));
    const accepted = await sender.send(
      `select (public.send_order_message('${orderId}'::uuid, '${clientId}'::uuid, 'I am at the door')).id;`
    );
    assert(!errored(accepted), 'the send is accepted before closure');

    await closer.send('begin;');
    await closer.send(actAs(ADMIN));
    const pendingClose = closer.send(
      `select (public.transition_order_status('${orderId}'::uuid, 'delivered'::public.order_status)).id;`
    );
    await waitForBlockedSessions(CONTAINER, DB, 1);
    assert(true, 'the closing transaction waits for the in flight send');

    await sender.send('commit;');
    await pendingClose;
    await closer.send('commit;');

    assert(
      Number(sql(`select count(*) from public.order_messages where order_id = '${orderId}'::uuid;`)) === 1,
      'a send that wins the race keeps its message after closure'
    );
    assert(
      sql(`select status from public.orders where id = '${orderId}'::uuid;`) === 'delivered',
      'the order still closes afterwards'
    );

    const retry = spawnSync(
      'docker',
      ['exec', '-i', CONTAINER, 'sh', '-c', `psql -U postgres -d ${DB} -At 2>&1`],
      {
        input: `${actAs(USER_A)}
          select (public.send_order_message('${orderId}'::uuid, '${clientId}'::uuid, 'I am at the door')).id;`,
        encoding: 'utf8',
      }
    );
    const retryOutput = `${retry.stdout ?? ''}${retry.stderr ?? ''}`;
    assert(
      !/ERROR/i.test(retryOutput),
      'retrying a message accepted before closure still returns that message'
    );
    assert(
      Number(sql(`select count(*) from public.order_messages where order_id = '${orderId}'::uuid;`)) === 1,
      'retrying after closure never inserts a second message'
    );

    const fresh = spawnSync(
      'docker',
      ['exec', '-i', CONTAINER, 'sh', '-c', `psql -U postgres -d ${DB} -At 2>&1`],
      {
        input: `${actAs(USER_A)}
          select (public.send_order_message('${orderId}'::uuid, '${uuid()}'::uuid, 'One more')).id;`,
        encoding: 'utf8',
      }
    );
    const freshOutput = `${fresh.stdout ?? ''}${fresh.stderr ?? ''}`;
    assert(/ERROR/i.test(freshOutput), 'a brand new message after closure is refused');

    sender.close();
    closer.close();
  }

  console.log('\nconcurrent: a failed transaction leaves nothing behind');
  {
    createPromotion('RACEROLLBACK', { maxRedemptions: 5, maxPerCustomer: 5 });
    const key = uuid();

    const a = openSession('a6');
    await a.send('begin;');
    await a.send(actAs(USER_A));
    const created = await a.send(orderCall('RACEROLLBACK', ADDRESS_A, key));
    assert(!errored(created), 'the order is created inside the transaction');
    await a.send('rollback;');

    assert(
      Number(sql(`select count(*) from public.orders where idempotency_key = '${key}'::uuid;`)) === 0,
      'a rolled back checkout leaves no order'
    );
    assert(redemptionCount('RACEROLLBACK') === 0, 'a rolled back checkout leaves no reservation');
    assert(
      Number(
        sql(`select count(*) from public.order_items oi
               join public.orders o on o.id = oi.order_id
              where o.idempotency_key = '${key}'::uuid;`)
      ) === 0,
      'a rolled back checkout leaves no order items'
    );

    a.close();
  }

  console.log('\nconcurrent: a refused code inside a transaction leaves no partial order');
  {
    const key = uuid();
    const a = openSession('a7');
    await a.send('begin;');
    await a.send(actAs(USER_A));
    const refused = await a.send(orderCall('NOSUCHCODE', ADDRESS_A, key));
    assert(errored(refused), 'an unknown code is refused');
    await a.send('rollback;');

    assert(
      Number(sql(`select count(*) from public.orders where idempotency_key = '${key}'::uuid;`)) === 0,
      'a refused code creates no order at all'
    );

    a.close();
  }

  const cardOrderCall = (addressId, idempotencyKey) => `
select (public.create_order(
  '${RESTAURANT}'::uuid,
  jsonb_build_array(jsonb_build_object('dish_id','${DISH}','quantity',3,'addon_ids','[]'::jsonb)),
  'delivery', '${addressId}'::uuid, null, 0, 'card', false, false,
  '${idempotencyKey}'::uuid, null)).id;`;

  let supportOrderSeq = 0;

  const prepareSupportOrder = ({ user = USER_A, address = ADDRESS_A, card = true } = {}) => {
    supportOrderSeq += 1;
    const tag = `sup${supportOrderSeq}`;
    const key = uuid();

    sql('update public.platform_settings set card_payments_enabled = true;');
    sql(`${actAs(user)} ${card ? cardOrderCall(address, key) : orderCall(null, address, key)}`);
    const orderId = sql(`select id from public.orders where idempotency_key = '${key}'::uuid;`);

    if (card) {
      sql(`update public.payments set provider_intent_id = 'pi_${tag}' where order_id = '${orderId}'::uuid;`);
      sql(`select (public.confirm_payment('pi_${tag}', 'ch_${tag}', 'evt_${tag}', '{}'::jsonb)).id;`);
    }

    ['accepted', 'preparing', 'ready_for_pickup', 'delivered'].forEach((status) => {
      sql(`${actAs(ADMIN)}
        select (public.transition_order_status('${orderId}'::uuid, '${status}'::public.order_status)).id;`);
    });

    return orderId;
  };

  const openTicket = (orderId, { user = USER_A, category = 'missing_items' } = {}) => {
    sql(`${actAs(user)}
      select (public.submit_support_ticket('${orderId}'::uuid, '${uuid()}'::uuid,
        '${category}', 'Something went wrong')).id;`);
    return sql(`select id from public.support_tickets where order_id = '${orderId}'::uuid;`);
  };

  const refundable = (orderId) =>
    Number(
      lastValue(
        sql(`${actAs(ADMIN)}
          select remaining_refundable from public.order_refund_summary('${orderId}'::uuid);`)
      )
    );

  console.log('\nconcurrent: one order, two first reports');
  {
    const orderId = prepareSupportOrder();
    const keyA = uuid();
    const keyB = uuid();

    const a = openSession('ticket-a');
    const b = openSession('ticket-b');

    await a.send('begin;');
    await b.send('begin;');
    await a.send(actAs(USER_A));
    await b.send(actAs(USER_A));

    const first = await a.send(
      `select (public.submit_support_ticket('${orderId}'::uuid, '${keyA}'::uuid,
        'missing_items', 'A dish was missing')).id;`
    );
    assert(!errored(first), 'the first report is accepted');

    const pending = b.send(
      `select (public.submit_support_ticket('${orderId}'::uuid, '${keyB}'::uuid,
        'late_delivery', 'It was also late')).id;`
    );
    await waitForBlockedSessions(CONTAINER, DB, 1);
    assert(true, 'the second report blocks on the order lock');

    await a.send('commit;');
    const second = await pending;
    assert(errored(second), 'the second report is refused while one is open');
    await b.send('rollback;');

    assert(
      Number(sql(`select count(*) from public.support_tickets where order_id = '${orderId}'::uuid;`)) === 1,
      'exactly one ticket exists after the race'
    );

    a.close();
    b.close();
  }

  console.log('\nconcurrent: one report submitted twice at once');
  {
    const orderId = prepareSupportOrder();
    const key = uuid();
    const call = `select (public.submit_support_ticket('${orderId}'::uuid, '${key}'::uuid,
      'missing_items', 'Submitted twice')).id;`;

    const results = [
      sql(`${actAs(USER_A)} ${call}`),
      sql(`${actAs(USER_A)} ${call}`),
    ];

    assert(results.every((row) => !errored(row)), 'both submissions of one report succeed');
    assert(lastValue(results[0]) === lastValue(results[1]), 'both submissions return the same ticket');
    assert(
      Number(sql(`select count(*) from public.support_tickets where order_id = '${orderId}'::uuid;`)) === 1,
      'a repeated report never creates a second ticket'
    );

    assert(
      Number(
        sql(`select count(*) from public.support_messages sm
               join public.support_tickets st on st.id = sm.ticket_id
              where st.order_id = '${orderId}'::uuid;`)
      ) === 1,
      'a repeated report never duplicates the opening message'
    );
  }

  console.log('\nconcurrent: two admins take the same ticket');
  {
    const orderId = prepareSupportOrder();
    const ticketId = openTicket(orderId);
    const revision = Number(
      sql(`select revision from public.support_tickets where id = '${ticketId}'::uuid;`)
    );

    const a = openSession('assign-a');
    const b = openSession('assign-b');

    await a.send('begin;');
    await b.send('begin;');
    await a.send(actAs(ADMIN));
    await b.send(actAs(ADMIN));

    const first = await a.send(
      `select (public.admin_assign_support_ticket('${ticketId}'::uuid, '${ADMIN}'::uuid, ${revision})).id;`
    );
    assert(!errored(first), 'the first admin takes the ticket');

    const pending = b.send(
      `select (public.admin_assign_support_ticket('${ticketId}'::uuid, null, ${revision})).id;`
    );
    await waitForBlockedSessions(CONTAINER, DB, 1);
    assert(true, 'the second admin blocks on the ticket lock');

    await a.send('commit;');
    const second = await pending;
    assert(errored(second), 'the second admin is refused with a stale revision');
    await b.send('rollback;');

    assert(
      sql(`select assigned_admin_id from public.support_tickets where id = '${ticketId}'::uuid;`) === ADMIN,
      'the winning assignment survives the race'
    );
    assert(
      Number(
        sql(`select count(*) from public.admin_actions
              where action = 'assign_support_ticket' and subject_id = '${ticketId}';`)
      ) === 1,
      'the race leaves one assignment in the audit log'
    );

    a.close();
    b.close();
  }

  console.log('\nconcurrent: two admins change the same status');
  {
    const orderId = prepareSupportOrder();
    const ticketId = openTicket(orderId);
    const revision = Number(
      sql(`select revision from public.support_tickets where id = '${ticketId}'::uuid;`)
    );

    const a = openSession('status-a');
    const b = openSession('status-b');

    await a.send('begin;');
    await b.send('begin;');
    await a.send(actAs(ADMIN));
    await b.send(actAs(ADMIN));

    const first = await a.send(
      `select (public.admin_set_support_status('${ticketId}'::uuid, 'in_review', ${revision})).status;`
    );
    assert(!errored(first), 'the first status change is accepted');

    const pending = b.send(
      `select (public.admin_set_support_status('${ticketId}'::uuid, 'resolved', ${revision})).status;`
    );
    await waitForBlockedSessions(CONTAINER, DB, 1);

    await a.send('commit;');
    const second = await pending;
    assert(errored(second), 'the losing status change is refused rather than applied');
    await b.send('rollback;');

    assert(
      sql(`select status from public.support_tickets where id = '${ticketId}'::uuid;`) === 'in_review',
      'the ticket keeps the status the winner set'
    );

    a.close();
    b.close();
  }

  console.log('\nconcurrent: two refunds race the last of the balance');
  {
    const orderId = prepareSupportOrder();
    const ticketId = openTicket(orderId);
    const balance = refundable(orderId);
    const half = Math.round((balance * 0.6 + Number.EPSILON) * 100) / 100;

    const a = openSession('refund-a');
    const b = openSession('refund-b');

    await a.send('begin;');
    await b.send('begin;');
    await a.send(actAs(ADMIN));
    await b.send(actAs(ADMIN));

    const first = await a.send(
      `select (public.admin_approve_support_refund('${ticketId}'::uuid, ${half}, 'first partial')).id;`
    );
    assert(!errored(first), 'the first refund reserves most of the balance');

    const pending = b.send(
      `select (public.admin_approve_support_refund('${ticketId}'::uuid, ${half}, 'second partial')).id;`
    );
    await waitForBlockedSessions(CONTAINER, DB, 1);
    assert(true, 'the second refund blocks on the ticket lock');

    await a.send('commit;');
    const second = await pending;
    assert(errored(second), 'two refunds cannot together exceed the balance');
    await b.send('rollback;');

    assert(
      Number(sql(`select count(*) from public.support_refunds where order_id = '${orderId}'::uuid;`)) === 1,
      'only the winning refund exists'
    );
    assert(
      Number(
        sql(`select coalesce(sum(amount), 0) from public.support_refunds
              where order_id = '${orderId}'::uuid and state = 'reserved';`)
      ) === half,
      'the reserved total never exceeds what was charged'
    );
    assert(refundable(orderId) === Math.round((balance - half) * 100) / 100,
      'the remaining balance is exact after the race');

    a.close();
    b.close();
  }

  console.log('\nconcurrent: two admins approve the same refund request');
  {
    const orderId = prepareSupportOrder();
    const ticketId = openTicket(orderId);
    const key = uuid();
    const call = `select (public.admin_approve_support_refund(
      '${ticketId}'::uuid, 5.00, 'double tap', 'platform', '${key}'::uuid)).id;`;

    const first = sql(`${actAs(ADMIN)} ${call}`);
    const second = sql(`${actAs(ADMIN)} ${call}`);

    assert(!errored(first) && !errored(second), 'both approvals of one request succeed');
    assert(lastValue(first) === lastValue(second), 'both approvals return the same refund');
    assert(
      Number(sql(`select count(*) from public.support_refunds where order_id = '${orderId}'::uuid;`)) === 1,
      'a repeated approval never refunds twice'
    );
    assert(
      Number(
        sql(`select count(*) from public.payment_reconciliations
              where order_id = '${orderId}'::uuid and kind = 'support_refund';`)
      ) === 1,
      'a repeated approval queues one provider refund'
    );
  }

  console.log('\nconcurrent: a support refund races the automatic reconciliation');
  {
    const orderId = prepareSupportOrder();
    const ticketId = openTicket(orderId);
    const balance = refundable(orderId);

    const paymentId = sql(`select id from public.payments where order_id = '${orderId}'::uuid;`);
    sql(`select (public.enqueue_payment_reconciliation('${paymentId}'::uuid,
      'refund_unfulfilled_order', ${balance}, 'order was never fulfilled')).id;`);

    assert(refundable(orderId) === 0,
      'a queued automatic refund reserves the whole balance');

    const guard = openSession('recon-guard');
    await guard.send(actAs(ADMIN));
    const refused = await guard.send(
      `select (public.admin_approve_support_refund('${ticketId}'::uuid, 1.00, 'on top')).id;`
    );
    assert(errored(refused),
      'a support refund cannot be approved on top of a pending automatic refund');
    guard.close();

    const reconciliationId = sql(`select id from public.payment_reconciliations
      where order_id = '${orderId}'::uuid and kind = 'refund_unfulfilled_order';`);

    const worker = openSession('recon-worker');
    const approver = openSession('recon-approver');

    await worker.send('begin;');
    await approver.send('begin;');

    await worker.send(`select (public.resolve_payment_reconciliation('${reconciliationId}'::uuid,
      're_auto', 'evt_auto', '{}'::jsonb)).state;`);

    await approver.send(actAs(ADMIN));
    const pending = approver.send(
      `select (public.admin_approve_support_refund('${ticketId}'::uuid, 1.00, 'after the worker')).id;`
    );
    await waitForBlockedSessions(CONTAINER, DB, 1);
    assert(true, 'the approval blocks while the worker holds the payment');

    await worker.send('commit;');
    const afterWorker = await pending;
    await approver.send('rollback;');

    assert(errored(afterWorker),
      'a refunded order cannot also fund a support refund');
    assert(
      Number(
        sql(`select amount_refunded from public.payments where id = '${paymentId}'::uuid;`)
      ) === balance,
      'the automatic refund settled for the full balance'
    );
    assert(refundable(orderId) === 0, 'nothing is refundable once the order is fully refunded');

    worker.close();
    approver.close();
  }

  console.log('\nconcurrent: the worker settles while an admin reads the ticket');
  {
    const orderId = prepareSupportOrder();
    const ticketId = openTicket(orderId);
    const refundId = lastValue(sql(`${actAs(ADMIN)}
      select (public.admin_approve_support_refund('${ticketId}'::uuid, 7.00, 'partial')).id;`));
    const reconciliationId = sql(
      `select reconciliation_id from public.support_refunds where id = '${refundId}'::uuid;`
    );

    const workerA = openSession('settle-a');
    const workerB = openSession('settle-b');

    await workerA.send('begin;');
    await workerB.send('begin;');

    const first = await workerA.send(`select (public.resolve_payment_reconciliation(
      '${reconciliationId}'::uuid, 're_settle', 'evt_settle', '{}'::jsonb)).state;`);
    assert(!errored(first), 'the first worker resolves the refund');

    const pending = workerB.send(`select (public.resolve_payment_reconciliation(
      '${reconciliationId}'::uuid, 're_settle_again', 'evt_settle_again', '{}'::jsonb)).state;`);
    await waitForBlockedSessions(CONTAINER, DB, 1);

    await workerA.send('commit;');
    const second = await pending;
    await workerB.send('commit;');

    assert(!errored(second), 'a second worker pass is a no-op rather than an error');
    assert(
      Number(sql(`select amount_refunded from public.payments where order_id = '${orderId}'::uuid;`)) === 7,
      'a double settlement refunds the amount once'
    );
    assert(
      Number(
        sql(`select count(*) from public.refunds where order_id = '${orderId}'::uuid;`)
      ) === 1,
      'only one provider refund is recorded'
    );
    assert(
      sql(`select state from public.support_refunds where id = '${refundId}'::uuid;`) === 'confirmed',
      'the support refund ends confirmed'
    );
    assert(
      Number(
        sql(`select coalesce(sum(amount), 0) from public.ledger_entries
              where order_id = '${orderId}'::uuid and entry_type = 'refund';`)
      ) === -7,
      'the ledger records the refund exactly once'
    );

    workerA.close();
    workerB.close();
  }

  console.log('\nconcurrent: two partial refunds both reach the ledger');
  {
    const orderId = prepareSupportOrder();
    const ticketId = openTicket(orderId);

    const settle = async (amount, tag) => {
      const refundId = lastValue(sql(`${actAs(ADMIN)}
        select (public.admin_approve_support_refund('${ticketId}'::uuid, ${amount}, '${tag}')).id;`));
      const reconciliationId = sql(
        `select reconciliation_id from public.support_refunds where id = '${refundId}'::uuid;`
      );
      sql(`select (public.resolve_payment_reconciliation('${reconciliationId}'::uuid,
        're_${tag}', 'evt_${tag}', '{}'::jsonb)).state;`);
      return refundId;
    };

    await settle(4, 'partone');
    await settle(6, 'parttwo');

    assert(
      Number(sql(`select amount_refunded from public.payments where order_id = '${orderId}'::uuid;`)) === 10,
      'two partial refunds both count against the payment'
    );
    assert(
      Number(
        sql(`select coalesce(sum(amount), 0) from public.ledger_entries
              where order_id = '${orderId}'::uuid and entry_type = 'refund';`)
      ) === -10,
      'the ledger accumulates both partial refunds'
    );
    assert(
      Number(
        lastValue(
          sql(`${actAs(ADMIN)}
            select refunded from public.order_financials where order_id = '${orderId}'::uuid;`)
        )
      ) === 10,
      'the order financials report the full refunded amount'
    );
  }

  console.log('\nconcurrent: the same support message sent twice at once');
  {
    const orderId = prepareSupportOrder();
    const ticketId = openTicket(orderId);
    const key = uuid();
    const call = `select (public.send_support_message('${ticketId}'::uuid,
      '${key}'::uuid, 'Any news?')).id;`;

    const a = openSession('support-msg-a');
    const b = openSession('support-msg-b');

    await a.send('begin;');
    await b.send('begin;');
    await a.send(actAs(USER_A));
    await b.send(actAs(USER_A));

    const first = await a.send(call);
    assert(!errored(first), 'the first send is accepted');

    const pending = b.send(call);
    await waitForBlockedSessions(CONTAINER, DB, 1);

    await a.send('commit;');
    const second = await pending;
    await b.send('commit;');

    assert(!errored(second), 'the duplicate send resolves instead of failing');
    assert(
      Number(
        sql(`select count(*) from public.support_messages
              where ticket_id = '${ticketId}'::uuid and client_message_id = '${key}'::uuid;`)
      ) === 1,
      'the duplicate send stores one message'
    );

    a.close();
    b.close();
  }

  console.log('\nconcurrent: a customer reopens while an admin resolves');
  {
    const orderId = prepareSupportOrder();
    const ticketId = openTicket(orderId);
    const revision = Number(
      sql(`select revision from public.support_tickets where id = '${ticketId}'::uuid;`)
    );

    const admin = openSession('reopen-admin');
    const customer = openSession('reopen-customer');

    await admin.send('begin;');
    await customer.send('begin;');

    await admin.send(actAs(ADMIN));
    await admin.send(
      `select (public.admin_set_support_status('${ticketId}'::uuid, 'resolved', ${revision})).status;`
    );

    await customer.send(actAs(USER_A));
    const pending = customer.send(
      `select (public.send_support_message('${ticketId}'::uuid, '${uuid()}'::uuid, 'Still broken')).id;`
    );
    await waitForBlockedSessions(CONTAINER, DB, 1);
    assert(true, 'the customer message blocks while the ticket is being resolved');

    await admin.send('commit;');
    const sent = await pending;
    await customer.send('commit;');

    assert(!errored(sent), 'the customer message lands after the resolution');
    assert(
      sql(`select status from public.support_tickets where id = '${ticketId}'::uuid;`) === 'open',
      'the message reopens the ticket the admin just resolved'
    );
    assert(
      Number(sql(`select reopened_count from public.support_tickets where id = '${ticketId}'::uuid;`)) === 1,
      'the reopen is counted exactly once'
    );

    admin.close();
    customer.close();
  }
};

run()
  .then(() => {
    console.log(`\n${passed} passed, ${failed} failed.`);
    cleanup();
    if (failed > 0) process.exit(1);
    console.log('\nConcurrent checkout, chat, support and refund paths verified.\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    fail('Concurrent verification crashed.');
  });
