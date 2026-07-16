# DOZECLIN Financial Module

Sprint 3.4 introduces the clinical financial layer integrated with appointments.

## Model

The new model is separate from the legacy `financial_entries` table:

- `dozeclin.financial_charges`: amounts owed by patients.
- `dozeclin.financial_payments`: payments registered against charges.
- `dozeclin.financial_receipts`: simple payment receipts.
- `dozeclin.financial_receipt_sequences`: clinic/year receipt numbering.

Charges and payments are not mixed in the same table.

## Charges

Supported charge types:

- `appointment`
- `package`
- `manual`
- `subscription`
- `adjustment`

Supported statuses:

- `pending`
- `partially_paid`
- `paid`
- `overdue`
- `cancelled`
- `refunded`

Appointment charges require `appointment_id`. Manual charges can be created without an Appointment.

## Payments

Payments are registered through `dozeclin.register_payment(...)`.

The RPC:

- derives the clinic from the authenticated profile;
- locks the charge with `FOR UPDATE`;
- validates clinic, status, currency and remaining balance;
- supports partial payment;
- updates charge totals and status;
- creates a receipt in the same transaction;
- writes audit logs.

## Receipts

Receipts are simple payment receipts and are not official fiscal documents.

Receipt numbers are generated in the database per clinic and year, using:

`YYYY-000001`

or the configured `receipt_prefix`.

Each payment can have only one receipt.

## Multicurrency

Initial currencies:

- `EUR`
- `BRL`
- `USD`

The module does not convert currencies and does not sum different currencies together.

## Appointment Integration

When an Appointment becomes `completed`, the database attempts automatic charge creation only if:

- `clinic_settings.auto_create_charge_on_completion = true`;
- `clinic_settings.default_session_price > 0`;
- no active appointment charge already exists.

If financial settings are incomplete, the Appointment completion is not blocked.

## Cancellation

Charges are cancelled through `dozeclin.cancel_charge(uuid, text)`.

Rules:

- cancellation reason is mandatory;
- charges with confirmed payments cannot be cancelled in this Sprint;
- no physical deletion is allowed.

Refunds and gateway reversals remain prepared by schema/status, but are deferred to a future Sprint.

## Portal

The Patient Portal shows only the authenticated patient's financial subset:

- open charges;
- confirmed payments;
- issued receipts.

It does not expose internal notes, external references, administrative users or other patients' data.

## Dashboard

The clinic Dashboard includes a compact financial summary:

- receivable;
- received this month;
- overdue;
- completed sessions without charge;
- overdue charges;
- partial payments.

Values are separated by currency.

## RLS And Permissions

Financial tables have RLS enabled.

Staff can select records only for their own clinic. Patients can select only their own records.

Writes are performed by RPCs. Direct insert/update/delete privileges are not granted to authenticated users.

Permissions added in frontend:

- `financial.read`
- `financial.create_charge`
- `financial.register_payment`
- `financial.cancel_charge`
- `financial.issue_receipt`
- `financial.manage`

Super Admin platform access does not automatically grant clinical financial access.

## Audit

Audit actions:

- `financial.charge_created`
- `financial.charge_cancelled`
- `financial.payment_registered`
- `financial.payment_cancelled`
- `financial.receipt_issued`
- `financial.receipt_cancelled`

No card data, tokens or sensitive banking payloads are stored.

## Manual Application

Do not apply automatically from Codex.

Review and apply manually:

```bash
supabase db push
```

or your normal reviewed migration process.

## Static Test Checklist

- `node --check assets/js/pages/financeiro.js`
- `node --check assets/js/services/financial.service.js`
- `node --check assets/js/pages/paciente-detalhes.js`
- `node --check assets/js/pages/portal-paciente.js`
- `node --check assets/js/pages/dashboard.js`
- `node --check assets/js/auth/permissions.js`

## Functional Checklist

1. Create manual charge.
2. Create Appointment charge.
3. Block duplicate active Appointment charge.
4. Register full payment.
5. Register partial payment.
6. Update balance.
7. Update charge status.
8. Block payment above remaining balance.
9. Block payment on cancelled charge.
10. Generate receipt.
11. Keep receipt numbering sequential.
12. Cancel unpaid charge.
13. Block cancellation with confirmed payment.
14. Show patient financial history.
15. Show patient portal financial data.
16. Isolate another clinic.
17. Block suspended clinic.
18. Separate currencies.
19. Show dashboard values by currency.
20. Avoid console errors.
21. Avoid physical deletion.
22. Avoid open policies.

## Limitations

Not included in Sprint 3.4:

- Stripe integration;
- MB Way integration;
- PIX integration;
- official fiscal invoices;
- electronic invoice;
- digital signature;
- automatic bank reconciliation;
- payment gateway;
- accounting integration;
- tax/IVA automation;
- payment split.
