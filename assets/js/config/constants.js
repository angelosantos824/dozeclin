// export const SUPABASE_URL =
//   "https://crbxqjxpghgfqkibudlz.supabase.co";

// export const SUPABASE_ANON_KEY =
//   "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNyYnhxanhwZ2hnZnFraWJ1ZGx6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwNjIxNjgsImV4cCI6MjA5NTYzODE2OH0.snvXPWCpKEwBB2Mtc1U55FSO7kh5ZH0bHMlGmM_EWpc";

// export const DEFAULT_LOCALE = "pt-PT";
// export const DEFAULT_TIMEZONE = "Europe/Lisbon";
// export const DEFAULT_CURRENCY = "EUR";

// export const PATIENT_STATUS_LABELS = {
//   active: "Ativo",
//   inactive: "Inativo",
//   discharged: "Alta",
//   archived: "Arquivado"
// };

// export const ROLE_LABELS = {
//   super_admin: "Administrador do produto",
//   clinic_admin: "Administrador da clínica",
//   reception: "Receção",
//   professional: "Profissional de saúde",
//   finance: "Financeiro",
//   supervisor: "Supervisor",
//   patient: "Paciente"
// };

// uuid clinica: f12c02f6-1ffd-486f-a32a-70142e84e644
// uuid admin: 9bf6872b-4afc-4eea-aa93-87085c5fe3c0

/* ==========================================================
   DOZECLIN
   Configurações Globais
========================================================== */

export const APP_NAME = "DOZECLIN";
export const APP_VERSION = "1.0.0";
export const APP_DESCRIPTION = "Sistema SaaS de Gestão Clínica";
export const COMPANY_NAME = "DOZEDEV";
export const COMPANY_WEBSITE = "https://dozedev.pt";

/* ==========================================================
   SUPABASE
========================================================== */

export const SUPABASE_URL =
    "https://crbxqjxpghgfqkibudlz.supabase.co";

export const SUPABASE_ANON_KEY =
    "sb_publishable_fIzoLl2_C25e3ZymLbidpA_pciDrE3I";

/* ==========================================================
   LOCALIZAÇÃO
========================================================== */

export const DEFAULT_LOCALE = "pt-PT";
export const DEFAULT_TIMEZONE = "Europe/Lisbon";
export const DEFAULT_CURRENCY = "EUR";

/* ==========================================================
   STATUS DOS PACIENTES
========================================================== */

export const PATIENT_STATUS_LABELS = {
    active: "Ativo",
    inactive: "Inativo",
    discharged: "Alta",
    archived: "Arquivado"
};

/* ==========================================================
   PERFIS
========================================================== */

export const ROLE_LABELS = {
    super_admin: "Administrador do Produto",
    clinic_admin: "Administrador da Clínica",
    reception: "Receção",
    professional: "Profissional de Saúde",
    finance: "Financeiro",
    supervisor: "Supervisor",
    patient: "Paciente"
};

export const USER_STATUS_LABELS = {
    active: "Ativo",
    inactive: "Inativo",
    suspended: "Suspenso",
    invited: "Convite enviado",
    pending_invite: "Convite pendente"
};

export const APPOINTMENT_STATUS_LABELS = {
    scheduled: "Agendada",
    confirmed: "Confirmada",
    in_progress: "Em atendimento",
    completed: "Concluida",
    cancelled: "Cancelada",
    no_show: "Nao compareceu"
};

export const APPOINTMENT_TYPE_LABELS = {
    first_visit: "Primeira consulta",
    follow_up: "Consulta de acompanhamento",
    assessment: "Avaliacao",
    return_visit: "Retorno",
    session: "Sessao",
    other: "Outro"
};

export const MEDICAL_RECORD_TYPE_LABELS = {
    evolution: "Evolucao",
    observation: "Observacao",
    diagnosis: "Diagnostico",
    conduct: "Conduta",
    prescription: "Prescricao",
    other: "Outro"
};

export const MEDICAL_RECORD_STATUS_LABELS = {
    draft: "Rascunho",
    signed: "Assinado",
    cancelled: "Cancelado"
};

/* ==========================================================
   STATUS DA CLÍNICA
========================================================== */

export const CLINIC_STATUS_LABELS = {
    trial: "Em teste",
    active: "Ativa",
    inactive: "Inativa",
    suspended: "Suspensa",
    blocked: "Bloqueada",
    cancelled: "Cancelada"
};

export const CLINIC_SPECIALTY_LABELS = {
    general: "Geral",
    psychoanalysis: "Psicanalise",
    psychology: "Psicologia",
    dentistry: "Odontologia",
    nutrition: "Nutricao",
    physiotherapy: "Fisioterapia",
    pediatrics: "Pediatria",
    psychiatry: "Psiquiatria",
    multidisciplinary: "Multidisciplinar",
    other: "Outra"
};

export const CLINIC_PLAN_LABELS = {
    basic: "Basico",
    professional: "Profissional",
    premium: "Premium",
    custom: "Personalizado"
};

/* ==========================================================
   CORES DO SISTEMA
========================================================== */

export const COLORS = {
    primary: "#7c3aed",
    secondary: "#a855f7",
    success: "#22c55e",
    warning: "#f59e0b",
    danger: "#ef4444",
    info: "#3b82f6",
    dark: "#111827",
    light: "#f8fafc"
};

/* ==========================================================
   CLÍNICA PADRÃO (DESENVOLVIMENTO)
========================================================== */

export const DEFAULT_CLINIC_ID =
    "f12c02f6-1ffd-486f-a32a-70142e84e644";

export const DEFAULT_ADMIN_ID =
    "9bf6872b-4afc-4eea-aa93-87085c5fe3c0";
