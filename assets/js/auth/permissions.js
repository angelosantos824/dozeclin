export const PERMISSIONS = {
  PATIENTS_READ: 'patients.read',
  PATIENTS_CREATE: 'patients.create',
  PATIENTS_UPDATE: 'patients.update',
  RECORDS_READ: 'records.read',
  RECORDS_CREATE: 'records.create',
  APPOINTMENTS_MANAGE: 'appointments.manage',
  FINANCE_READ: 'finance.read',
  FINANCE_MANAGE: 'finance.manage',
  SETTINGS_MANAGE: 'settings.manage'
};

const ROLE_PERMISSIONS = {
  super_admin: [],
  clinic_admin: Object.values(PERMISSIONS),
  reception: [
    PERMISSIONS.PATIENTS_READ,
    PERMISSIONS.PATIENTS_CREATE,
    PERMISSIONS.PATIENTS_UPDATE,
    PERMISSIONS.APPOINTMENTS_MANAGE
  ],
  professional: [
    PERMISSIONS.PATIENTS_READ,
    PERMISSIONS.PATIENTS_UPDATE,
    PERMISSIONS.RECORDS_READ,
    PERMISSIONS.RECORDS_CREATE,
    PERMISSIONS.APPOINTMENTS_MANAGE
  ],
  finance: [
    PERMISSIONS.PATIENTS_READ,
    PERMISSIONS.FINANCE_READ,
    PERMISSIONS.FINANCE_MANAGE
  ],
  supervisor: [
    PERMISSIONS.PATIENTS_READ,
    PERMISSIONS.RECORDS_READ,
    PERMISSIONS.APPOINTMENTS_MANAGE,
    PERMISSIONS.FINANCE_READ
  ],
  patient: []
};

export function hasPermission(profile, permission) {
  if (!profile || !permission) return false;
  if (profile.role === 'super_admin') return true;

  return (ROLE_PERMISSIONS[profile.role] || []).includes(permission);
}
