import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations');
const TESTS = path.join(ROOT, 'supabase', 'tests');

const NETWORK = 'wolt-compat-net';
const DB_CONTAINER = 'wolt-compat-db';
const API_CONTAINER = 'wolt-compat-api';
const DB = 'wolt_compat';
const JWT_SECRET = 'a-string-secret-at-least-thirty-two-characters-long';
const API_PORT = 3999;

let passed = 0;
let failed = 0;

const tryDocker = (args) => spawnSync('docker', args, { encoding: 'utf8' });

function cleanup() {
  tryDocker(['rm', '-f', API_CONTAINER]);
  tryDocker(['rm', '-f', DB_CONTAINER]);
  tryDocker(['network', 'rm', NETWORK]);
}

const fail = (message) => {
  console.error(`\n${message}\n`);
  cleanup();
  process.exit(1);
};

const assert = (condition, label) => {
  if (condition) {
    passed += 1;
    console.log(`  pass: ${label}`);
  } else {
    failed += 1;
    console.error(`  FAIL: ${label}`);
  }
};

const sql = (text) => {
  const result = spawnSync(
    'docker',
    ['exec', '-i', DB_CONTAINER, 'psql', '-U', 'postgres', '-d', DB, '-At', '-v', 'ON_ERROR_STOP=1', '-f', '-'],
    { input: text, encoding: 'utf8' }
  );
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return (result.stdout ?? '').trim();
};

const base64url = (input) =>
  Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

const mintJwt = (userId) => {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      sub: userId,
      role: 'authenticated',
      is_anonymous: false,
      exp: Math.floor(Date.now() / 1000) + 3600,
    })
  );
  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${header}.${payload}.${signature}`;
};

const callRpc = async (name, body, token) => {
  const response = await fetch(`http://127.0.0.1:${API_PORT}/rpc/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  return { status: response.status, body: parsed, raw: text };
};

if (tryDocker(['version', '--format', '{{.Server.Version}}']).status !== 0) {
  fail('Docker is not running. Start Docker Desktop and re-run: npm run verify:rpc-compat');
}

cleanup();
process.on('exit', cleanup);
process.on('SIGINT', () => process.exit(130));

console.log('Starting throwaway Postgres and PostgREST...');
execFileSync('docker', ['network', 'create', NETWORK]);
execFileSync('docker', [
  'run', '--rm', '-d', '--name', DB_CONTAINER, '--network', NETWORK,
  '-e', 'POSTGRES_PASSWORD=verify', '-e', `POSTGRES_DB=${DB}`,
  'postgres:16-alpine',
]);

const deadline = Date.now() + 120000;
let stable = 0;
while (Date.now() < deadline && stable < 3) {
  const ok =
    tryDocker(['exec', DB_CONTAINER, 'pg_isready', '-U', 'postgres', '-d', DB]).status === 0 &&
    tryDocker(['exec', DB_CONTAINER, 'psql', '-U', 'postgres', '-d', DB, '-tAc', 'select 1']).status === 0;
  stable = ok ? stable + 1 : 0;
  if (stable < 3) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400);
}
if (stable < 3) fail('Postgres did not become ready.');

const applyFile = (file) => {
  const result = spawnSync(
    'docker',
    ['exec', '-i', DB_CONTAINER, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', DB, '-f', '-'],
    { input: fs.readFileSync(file, 'utf8'), encoding: 'utf8' }
  );
  if (result.status !== 0) {
    console.error(result.stderr ?? '');
    fail(`FAILED to apply ${path.basename(file)}`);
  }
};

console.log('Applying stubs and migrations...');
applyFile(path.join(TESTS, '00_supabase_stubs.sql'));
fs.readdirSync(MIGRATIONS)
  .filter((file) => file.endsWith('.sql'))
  .sort()
  .forEach((file) => applyFile(path.join(MIGRATIONS, file)));

console.log('Seeding fixtures...');
sql(`
alter role authenticated login password 'verify';
alter role anon login password 'verify';
grant usage on schema public to anon, authenticated;

insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'compat@test.local'),
  ('11111111-1111-4111-8111-111111111111', 'compat-admin@test.local'),
  ('22222222-2222-4222-8222-222222222222', 'compat-other@test.local');

update public.profiles set role = 'admin' where id = '11111111-1111-4111-8111-111111111111';

insert into public.restaurants (id, name, min_order, is_open, latitude, longitude)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Compat Kitchen', 0, true, 51.9625, 7.6257);

insert into public.menu_categories (id, restaurant_id, name)
values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Mains');

insert into public.dishes (id, restaurant_id, menu_category_id, name, price, is_available)
values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Compat Dish', 10.00, true);

insert into public.addresses (id, user_id, label, address_line, latitude, longitude)
values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'Home', 'Compatstreet 1', 51.9650, 7.6300);

insert into public.promotions (code, discount_type, discount_value, max_per_customer)
values ('COMPAT10', 'percentage', 10, 5);
`);

console.log('Starting PostgREST...');
execFileSync('docker', [
  'run', '--rm', '-d', '--name', API_CONTAINER, '--network', NETWORK,
  '-p', `${API_PORT}:3000`,
  '-e', `PGRST_DB_URI=postgres://postgres:verify@${DB_CONTAINER}:5432/${DB}`,
  '-e', 'PGRST_DB_SCHEMAS=public',
  '-e', 'PGRST_DB_ANON_ROLE=anon',
  '-e', `PGRST_JWT_SECRET=${JWT_SECRET}`,
  'postgrest/postgrest:v12.2.3',
]);

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ADMIN = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

let ticketId = null;
const RESTAURANT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DISH = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const ADDRESS = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const legacyBody = (idempotencyKey) => ({
  p_restaurant_id: RESTAURANT,
  p_items: [{ dish_id: DISH, quantity: 2, addon_ids: [] }],
  p_delivery_mode: 'delivery',
  p_address_id: ADDRESS,
  p_scheduled_for: null,
  p_tip_amount: 1,
  p_payment_method: 'cash',
  p_leave_at_door: false,
  p_send_as_gift: false,
  p_idempotency_key: idempotencyKey,
});

const run = async () => {
  const apiDeadline = Date.now() + 90000;
  let ready = false;
  while (Date.now() < apiDeadline) {
    try {
      const probe = await fetch(`http://127.0.0.1:${API_PORT}/`);
      if (probe.status < 500) {
        ready = true;
        break;
      }
    } catch {
      ready = false;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!ready) fail('PostgREST did not become ready.');

  const token = mintJwt(USER);

  console.log('\nlegacy client: ten argument request without p_promo_code');
  {
    const key = crypto.randomUUID();
    const result = await callRpc('create_order', legacyBody(key), token);

    assert(result.status === 200, `the legacy request is accepted (got ${result.status})`);
    assert(
      !/PGRST202|could not find the function|No function matches/i.test(result.raw),
      'PostgREST resolves the function without the new parameter'
    );
    assert(result.body?.id != null, 'the legacy request returns a created order');
    assert(Number(result.body?.subtotal) === 20, 'the legacy order is priced by the server');
    assert(Number(result.body?.discount_amount) === 0, 'the legacy order carries no discount');
    assert(result.body?.promo_code === null, 'the legacy order has no promo code');
    const sumOfParts =
      Math.round(
        (Number(result.body?.subtotal) +
          Number(result.body?.service_fee) +
          Number(result.body?.delivery_fee) +
          Number(result.body?.tip_amount)) *
          100
      ) / 100;
    assert(
      Math.round(Number(result.body?.total) * 100) / 100 === sumOfParts,
      `the legacy total is unchanged by the promotion work (total ${result.body?.total}, parts ${sumOfParts})`
    );
  }

  console.log('\nlegacy client: repeated submission still idempotent');
  {
    const key = crypto.randomUUID();
    const first = await callRpc('create_order', legacyBody(key), token);
    const second = await callRpc('create_order', legacyBody(key), token);

    assert(first.body?.id === second.body?.id, 'a legacy retry returns the same order');
    assert(
      Number(sql(`select count(*) from public.orders where idempotency_key = '${key}'::uuid;`)) === 1,
      'a legacy retry creates exactly one order'
    );
  }

  console.log('\nnew client: eleven argument request with a promo code');
  {
    const key = crypto.randomUUID();
    const result = await callRpc(
      'create_order',
      { ...legacyBody(key), p_promo_code: 'COMPAT10' },
      token
    );

    assert(result.status === 200, `the new request is accepted (got ${result.status})`);
    assert(Number(result.body?.discount_amount) === 2, 'the new request applies the discount');
    assert(result.body?.promo_code === 'COMPAT10', 'the new request records the code');
  }

  console.log('\nnew client: explicit null promo code');
  {
    const key = crypto.randomUUID();
    const result = await callRpc(
      'create_order',
      { ...legacyBody(key), p_promo_code: null },
      token
    );

    assert(result.status === 200, 'an explicit null promo code is accepted');
    assert(Number(result.body?.discount_amount) === 0, 'an explicit null applies no discount');
  }

  console.log('\nunauthenticated and spoofed requests');
  {
    const key = crypto.randomUUID();
    const anonymous = await fetch(`http://127.0.0.1:${API_PORT}/rpc/create_order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(legacyBody(key)),
    });
    assert(anonymous.status >= 400, `an anonymous checkout is refused (got ${anonymous.status})`);

    const spoofed = await callRpc(
      'create_order',
      { ...legacyBody(crypto.randomUUID()), p_user_id: USER, p_total: 1 },
      token
    );
    assert(
      spoofed.status >= 400,
      'a request carrying extra client supplied columns is refused by PostgREST'
    );
  }

  console.log('\nsupport: the report screen request shape');
  {
    const key = crypto.randomUUID();
    const created = await callRpc('create_order', legacyBody(key), token);
    const orderId = created.body?.id;

    ['accepted', 'preparing', 'ready_for_pickup', 'delivered'].forEach((status) => {
      sql(`select set_config('request.jwt.claims',
             json_build_object('sub','${ADMIN}','role','authenticated','is_anonymous',false)::text, false);
           select (public.transition_order_status('${orderId}'::uuid,
             '${status}'::public.order_status)).id;`);
    });

    const itemId = sql(`select id from public.order_items where order_id = '${orderId}'::uuid limit 1;`);

    const eligibility = await callRpc('support_report_eligibility', { p_order_id: orderId }, token);
    assert(eligibility.status === 200, `the eligibility request is accepted (got ${eligibility.status})`);
    assert(
      (Array.isArray(eligibility.body) ? eligibility.body[0] : eligibility.body)?.can_report === true,
      'a delivered order is reportable through the api'
    );

    const clientTicketId = crypto.randomUUID();
    const body = {
      p_order_id: orderId,
      p_client_ticket_id: clientTicketId,
      p_category: 'missing_items',
      p_description: 'One dish was missing',
      p_items: [{ order_item_id: itemId, quantity: 1 }],
    };

    const submitted = await callRpc('submit_support_ticket', body, token);
    assert(submitted.status === 200, `the report request is accepted (got ${submitted.status})`);
    assert(
      !/PGRST202|could not find the function|No function matches/i.test(submitted.raw),
      'PostgREST resolves submit_support_ticket from the parameters the app sends'
    );
    assert(submitted.body?.id != null, 'the report returns a ticket');
    assert(submitted.body?.status === 'open', 'the ticket comes back open');

    const retry = await callRpc('submit_support_ticket', body, token);
    assert(retry.body?.id === submitted.body?.id, 'a retried report returns the same ticket');
    assert(
      Number(sql(`select count(*) from public.support_tickets where order_id = '${orderId}'::uuid;`)) === 1,
      'a retried report creates exactly one ticket'
    );

    ticketId = submitted.body?.id;
  }

  console.log('\nsupport: the conversation request shape');
  {
    const clientMessageId = crypto.randomUUID();
    const sent = await callRpc(
      'send_support_message',
      { p_ticket_id: ticketId, p_client_message_id: clientMessageId, p_body: 'Any news?' },
      token
    );
    assert(sent.status === 200, `the send request is accepted (got ${sent.status})`);
    assert(sent.body?.sender_role === 'customer', 'the server decides the sender role');

    const paged = await callRpc(
      'support_messages_page',
      {
        p_ticket_id: ticketId,
        p_before_created_at: null,
        p_before_id: null,
        p_limit: 30,
      },
      token
    );
    assert(paged.status === 200, `the paging request is accepted (got ${paged.status})`);
    assert(Array.isArray(paged.body) && paged.body.length >= 2, 'the conversation pages through the api');

    const mine = await callRpc('my_support_tickets', { p_limit: 20, p_offset: 0 }, token);
    assert(Array.isArray(mine.body) && mine.body.length === 1, 'the customer reads their own tickets');

    const details = await callRpc('support_ticket_details', { p_ticket_id: ticketId }, token);
    const detailRow = Array.isArray(details.body) ? details.body[0] : details.body;
    assert(detailRow?.viewer_role === 'customer', 'the server reports the viewer role');
  }

  console.log('\nsupport: refund approval is admin only through the api');
  {
    const approval = {
      p_ticket_id: ticketId,
      p_amount: 5,
      p_reason: 'one dish missing',
      p_liability: 'platform',
      p_client_request_id: crypto.randomUUID(),
    };

    const asCustomer = await callRpc('admin_approve_support_refund', approval, token);
    assert(asCustomer.status >= 400, `a customer cannot approve a refund (got ${asCustomer.status})`);
    assert(
      Number(sql(`select count(*) from public.support_refunds where ticket_id = '${ticketId}'::uuid;`)) === 0,
      'the refused approval left no refund behind'
    );

    const adminToken = mintJwt(ADMIN);
    const asAdmin = await callRpc('admin_approve_support_refund', approval, adminToken);
    assert(asAdmin.status === 200, `an admin approval is accepted (got ${asAdmin.status})`);
    assert(
      !/PGRST202|could not find the function|No function matches/i.test(asAdmin.raw),
      'PostgREST resolves admin_approve_support_refund from the parameters the admin screen sends'
    );
    assert(asAdmin.body?.state === 'reserved', 'the approval reserves the amount');

    const repeated = await callRpc('admin_approve_support_refund', approval, adminToken);
    assert(repeated.body?.id === asAdmin.body?.id, 'a repeated approval returns the same refund');
    assert(
      Number(sql(`select count(*) from public.support_refunds where ticket_id = '${ticketId}'::uuid;`)) === 1,
      'a repeated approval refunds once'
    );

    const queue = await callRpc(
      'admin_support_tickets',
      { p_status: null, p_category: null, p_assignment: null, p_limit: 20, p_offset: 0 },
      token
    );
    assert(
      !Array.isArray(queue.body) || queue.body.length === 0,
      'a customer reads nothing from the admin queue'
    );
  }

  console.log('\nsupport: unauthenticated and cross account requests');
  {
    const anonymous = await fetch(`http://127.0.0.1:${API_PORT}/rpc/my_support_tickets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_limit: 20, p_offset: 0 }),
    });
    assert(anonymous.status >= 400, `an anonymous ticket list is refused (got ${anonymous.status})`);

    const otherToken = mintJwt(OTHER);
    const stolen = await callRpc('support_ticket_details', { p_ticket_id: ticketId }, otherToken);
    assert(stolen.status >= 400, `another account cannot read the ticket (got ${stolen.status})`);

    const settle = await callRpc(
      'settle_support_refund',
      { p_refund_id: crypto.randomUUID(), p_state: 'confirmed' },
      token
    );
    assert(settle.status >= 400, 'a client cannot settle a refund through the api');

    const claim = await callRpc(
      'claim_payment_reconciliations',
      { p_limit: 5, p_lease_seconds: 60 },
      token
    );
    assert(claim.status >= 400, 'a client cannot claim worker jobs through the api');
  }
};

run()
  .then(() => {
    console.log(`\n${passed} passed, ${failed} failed.`);
    cleanup();
    if (failed > 0) process.exit(1);
    console.log('\nCheckout and support requests verified through PostgREST.\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    fail('RPC compatibility verification crashed.');
  });
