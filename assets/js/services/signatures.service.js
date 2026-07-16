import { supabase } from '../config/supabase.js';
import { getCurrentProfile } from '../auth/auth.js';

const SIGNATURE_FIELDS = `
  id,
  clinic_id,
  owner_type,
  profile_id,
  signature_type,
  display_name,
  storage_path,
  file_hash,
  mime_type,
  is_default,
  is_active,
  created_at,
  updated_at,
  revoked_at,
  revocation_reason,
  profile:profile_id(id, full_name, display_title, specialty)
`;

export async function listProfessionalSignatures() {
  const profile = await requireProfile();
  const { data, error } = await supabase
    .from('professional_signatures')
    .select(SIGNATURE_FIELDS)
    .eq('clinic_id', profile.clinic_id)
    .order('created_at', { ascending: false });

  if (error) throw mapSignatureError(error);
  return data || [];
}

export async function createSignatureFromFile({ file, signatureType, displayName, isDefault = false }) {
  const profile = await requireProfile();
  validateFile(file);

  const signatureId = crypto.randomUUID();
  const extension = extensionForMime(file.type);
  const ownerType = signatureType.startsWith('clinic_') ? 'clinic' : 'professional';
  const storagePath = `${profile.clinic_id}/${profile.id}/${signatureId}/signature.${extension}`;
  const fileHash = await sha256Hex(await file.arrayBuffer());

  const { error: uploadError } = await supabase.storage
    .from('professional-signatures')
    .upload(storagePath, file, {
      contentType: file.type,
      upsert: false
    });
  if (uploadError) throw mapSignatureError(uploadError);

  const { data, error } = await supabase
    .from('professional_signatures')
    .insert([{
      id: signatureId,
      clinic_id: profile.clinic_id,
      owner_type: ownerType,
      profile_id: ownerType === 'professional' ? profile.id : null,
      signature_type: signatureType,
      display_name: displayName || signatureLabel(signatureType),
      storage_path: storagePath,
      file_hash: fileHash,
      mime_type: file.type,
      is_default: Boolean(isDefault),
      is_active: true
    }])
    .select(SIGNATURE_FIELDS)
    .single();

  if (error) throw mapSignatureError(error);
  return data;
}

export async function setDefaultSignature(signature) {
  const profile = await requireProfile();
  const sameType = await listProfessionalSignatures();
  await Promise.all(
    sameType
      .filter((item) => item.profile_id === profile.id && item.signature_type === signature.signature_type && item.id !== signature.id)
      .map((item) => supabase.from('professional_signatures').update({ is_default: false }).eq('id', item.id))
  );

  const { data, error } = await supabase
    .from('professional_signatures')
    .update({ is_default: true })
    .eq('id', signature.id)
    .select(SIGNATURE_FIELDS)
    .single();
  if (error) throw mapSignatureError(error);
  return data;
}

export async function revokeSignature(signatureId, reason) {
  if (!reason?.trim()) throw new Error('Informe o motivo da revogacao.');
  const profile = await requireProfile();
  const { data, error } = await supabase
    .from('professional_signatures')
    .update({
      is_active: false,
      revoked_at: new Date().toISOString(),
      revoked_by: profile.id,
      revocation_reason: reason.trim()
    })
    .eq('id', signatureId)
    .select(SIGNATURE_FIELDS)
    .single();

  if (error) throw mapSignatureError(error);
  return data;
}

async function requireProfile() {
  const profile = await getCurrentProfile();
  if (!profile?.clinic_id || profile.status !== 'active') {
    throw new Error('Sessao invalida para gerir assinaturas.');
  }
  return profile;
}

function validateFile(file) {
  if (!file) throw new Error('Selecione um arquivo.');
  if (!['image/png', 'image/webp', 'image/jpeg'].includes(file.type)) {
    throw new Error('Formato permitido: PNG, WebP ou JPG.');
  }
  if (file.size > 2 * 1024 * 1024) {
    throw new Error('Arquivo acima do limite permitido.');
  }
}

function extensionForMime(mime) {
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/jpeg') return 'jpg';
  return 'png';
}

async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function signatureLabel(type) {
  const labels = {
    drawn: 'Assinatura desenhada',
    image: 'Imagem da assinatura',
    stamp: 'Carimbo profissional',
    seal: 'Selo da clinica'
  };
  return labels[type] || 'Assinatura';
}

function mapSignatureError(error) {
  return new Error(error?.message || 'Nao foi possivel processar a assinatura.');
}
