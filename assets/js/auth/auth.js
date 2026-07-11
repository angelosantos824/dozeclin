import { supabase } from '../config/supabase.js';

export async function signIn(email, password) {
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signOut() {
  return supabase.auth.signOut();
}

export async function sendPasswordReset(email) {
  const redirectTo = new URL('login.html', window.location.href).href;
  return supabase.auth.resetPasswordForEmail(email, { redirectTo });
}

export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function getCurrentProfile() {
  const session = await getSession();
  if (!session?.user) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select(`
      id,
      clinic_id,
      auth_user_id,
      full_name,
      email,
      role,
      status,
      clinics:clinics!profiles_clinic_id_fkey (
        id,
        name,
        slug,
        status,
        specialty,
        plan_code,
        logo_url,
        primary_color,
        secondary_color,
        timezone
      )
    `)
    .or(`auth_user_id.eq.${session.user.id},id.eq.${session.user.id}`)
    .single();

  if (error) throw error;
  return data;
}
