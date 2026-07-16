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

export const PATIENT_REQUEST_STATUS_LABELS = {
    new: "Novo",
    contacted: "Em conversa",
    qualified: "Atendimento confirmado",
    converted: "Paciente criado",
    closed: "Contato encerrado"
};

export const PATIENT_ONBOARDING_STEP_LABELS = {
    welcome: "Boas-vindas",
    password: "Alterar senha",
    profile: "Completar cadastro",
    anamnesis: "Concluir anamnese",
    completed: "Concluido"
};

export const PATIENT_ONBOARDING_STATUS_LABELS = {
    not_started: "Nao iniciado",
    in_progress: "Em andamento",
    completed: "Concluido"
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
    checked_in: "Paciente chegou",
    in_progress: "Em atendimento",
    completed: "Concluida",
    rescheduled: "Remarcada",
    cancelled: "Cancelada",
    cancelled_by_patient: "Cancelada pelo paciente",
    cancelled_by_clinic: "Cancelada pela clinica",
    no_show: "Nao compareceu",
    archived: "Arquivada"
};

export const APPOINTMENT_TYPE_LABELS = {
    first_visit: "Primeira consulta",
    follow_up: "Consulta de acompanhamento",
    assessment: "Avaliacao",
    return_visit: "Retorno",
    session: "Sessao",
    other: "Outro"
};

export const APPOINTMENT_MODALITY_LABELS = {
    presential: "Presencial",
    online: "Online",
    home: "Domiciliar"
};

export const COMMON_TIMEZONES = [
    "Europe/Lisbon",
    "America/Manaus",
    "America/Sao_Paulo",
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
    "America/Phoenix",
    "America/Toronto",
    "Europe/Madrid",
    "Europe/London"
];

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

export const DOCUMENT_STATUS_LABELS = {
    draft: "Rascunho",
    issued: "Emitido",
    revoked: "Revogado",
    cancelled: "Cancelado",
    archived: "Arquivado"
};

export const DOCUMENT_SIGNATURE_STATUS_LABELS = {
    unsigned: "Não assinado",
    signed: "Assinado",
    revoked: "Assinatura revogada"
};

export const DOCUMENT_TYPE_LABELS = {
    attendance_certificate: "Declaração de comparecimento",
    follow_up_certificate: "Declaração de acompanhamento",
    service_certificate: "Declaração de atendimento",
    clinical_report: "Relatório clínico",
    clinical_progress: "Evolução clínica",
    referral: "Encaminhamento",
    treatment_plan: "Plano terapêutico",
    consent: "Consentimento",
    custom: "Documento personalizado"
};

export const DOCUMENT_VISIBILITY_LABELS = {
    internal: "Interno",
    patient: "Paciente",
    public_validation_only: "Validação pública"
};

export const SIGNATURE_TYPE_LABELS = {
    drawn: "Assinatura desenhada",
    image: "Imagem da assinatura",
    stamp: "Carimbo profissional",
    seal: "Selo da clínica",
    clinic_signature: "Assinatura institucional",
    clinic_stamp: "Carimbo da clínica",
    clinic_seal: "Selo da clínica",
    clinic_logo: "Logotipo da clínica"
};

export const FINANCIAL_CHARGE_TYPE_LABELS = {
    appointment: "Sessao",
    package: "Pacote",
    manual: "Manual",
    subscription: "Assinatura",
    adjustment: "Ajuste"
};

export const FINANCIAL_CHARGE_STATUS_LABELS = {
    pending: "Pendente",
    partially_paid: "Parcialmente paga",
    paid: "Paga",
    overdue: "Em atraso",
    cancelled: "Cancelada",
    refunded: "Reembolsada"
};

export const FINANCIAL_PAYMENT_METHOD_LABELS = {
    cash: "Dinheiro",
    bank_transfer: "Transferencia bancaria",
    card: "Cartao",
    pix: "PIX",
    mb_way: "MB Way",
    stripe: "Stripe",
    paypal: "PayPal",
    other: "Outro"
};

export const FINANCIAL_PAYMENT_STATUS_LABELS = {
    confirmed: "Confirmado",
    pending: "Pendente",
    cancelled: "Cancelado",
    refunded: "Reembolsado"
};

export const FINANCIAL_RECEIPT_STATUS_LABELS = {
    issued: "Emitido",
    cancelled: "Cancelado"
};

export const SUPPORTED_CURRENCIES = ["EUR", "BRL", "USD"];

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
