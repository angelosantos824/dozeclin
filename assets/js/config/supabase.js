import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './constants.js';

const hasSupabaseConfig =
  SUPABASE_URL &&
  SUPABASE_ANON_KEY &&
  !SUPABASE_URL.includes('YOUR-DOZEDEV') &&
  !SUPABASE_ANON_KEY.includes('YOUR-DOZEDEV');

if (!hasSupabaseConfig) {
  console.warn('Configure assets/js/config/constants.js com o Supabase compartilhado do DOZEDEV.');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  db: {
    schema: 'dozeclin'
  },
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

export function isSupabaseConfigured() {
  return hasSupabaseConfig;
}
