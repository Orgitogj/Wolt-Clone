import { corsHeaders, json, requireEnv, serviceClient } from '../_shared/stripe.ts';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const CHUNK_SIZE = 100;

interface ClaimedNotification {
  notification_id: string;
  user_id: string;
  token: string;
  platform: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
}

interface PushTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

const chunk = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
};

const isAuthorised = (req: Request): boolean => {
  const header = req.headers.get('Authorization') ?? '';
  const expected = `Bearer ${requireEnv('SUPABASE_SERVICE_ROLE_KEY')}`;
  if (header.length !== expected.length) return false;

  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) {
    mismatch |= header.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!isAuthorised(req)) return json({ error: 'Not authorised' }, 401);

  const supabase = serviceClient();
  let claimed: ClaimedNotification[] = [];

  try {
    const limit = await req
      .json()
      .then((body) => Number(body?.limit))
      .catch(() => NaN);

    const { data, error } = await supabase.rpc('claim_notifications_for_push', {
      p_limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 500) : 100,
    });
    if (error) throw error;

    claimed = (data ?? []) as ClaimedNotification[];
    if (claimed.length === 0) return json({ sent: 0, failed: 0, discarded: 0 });

    let sent = 0;
    let failed = 0;
    const deadTokens = new Set<string>();

    for (const batch of chunk(claimed, CHUNK_SIZE)) {
      const messages = batch.map((row) => ({
        to: row.token,
        title: row.title,
        body: row.body,
        data: row.data ?? {},
        sound: 'default',
        channelId: 'default',
      }));

      const response = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'accept-encoding': 'gzip, deflate',
          'content-type': 'application/json',
        },
        body: JSON.stringify(messages),
      });

      if (!response.ok) {
        throw new Error(`Expo push responded ${response.status}`);
      }

      const payload = (await response.json()) as { data?: PushTicket[] };
      const tickets = payload.data ?? [];

      tickets.forEach((ticket, index) => {
        if (ticket.status === 'ok') {
          sent += 1;
          return;
        }
        failed += 1;
        if (ticket.details?.error === 'DeviceNotRegistered') {
          deadTokens.add(batch[index].token);
        }
      });
    }

    for (const token of deadTokens) {
      await supabase.rpc('discard_push_token', { p_token: token });
    }

    return json({ sent, failed, discarded: deadTokens.size });
  } catch (error) {
    if (claimed.length > 0) {
      await supabase.rpc('release_notifications_for_push', {
        p_ids: [...new Set(claimed.map((row) => row.notification_id))],
      });
    }
    console.error('send-push failed', error);
    return json({ error: error instanceof Error ? error.message : 'Unexpected error' }, 500);
  }
});
