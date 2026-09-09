import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && serviceRoleKey);
export const supabaseConfigMessage = isSupabaseConfigured
  ? null
  : 'Supabase belum dikonfigurasi. Set SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY di environment deployment.';

const unavailableQuery = new Proxy({}, {
  get(_target, prop) {
    if (prop === 'then') {
      return (resolve) => resolve({ data: null, error: new Error(supabaseConfigMessage) });
    }
    if (prop === 'catch') return undefined;
    return () => unavailableQuery;
  }
});

const unavailableClient = new Proxy({}, {
  get(_target, prop) {
    if (prop === 'from' || prop === 'rpc' || prop === 'storage' || prop === 'auth') return unavailableQuery;
    return () => unavailableQuery;
  }
});

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
  : unavailableClient;
