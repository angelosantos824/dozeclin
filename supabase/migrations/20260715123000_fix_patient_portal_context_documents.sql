begin;

create or replace function dozeclin.get_patient_portal_context()
returns jsonb
language plpgsql
security definer
set search_path = dozeclin, auth
stable
as $$
declare
  payload jsonb;
begin
  if auth.uid() is null then
    raise exception 'Portal do paciente nao encontrado ou indisponivel.';
  end if;

  select jsonb_build_object(
    'patient', to_jsonb(p),
    'portal', to_jsonb(pp),
    'onboarding', to_jsonb(po),
    'anamnesis', to_jsonb(af),
    'next_appointment', to_jsonb(na),
    'appointments', coalesce(appointments.rows, '[]'::jsonb),
    'documents', coalesce(documents.rows, '[]'::jsonb),
    'financial', jsonb_build_object(
      'open_charges', coalesce(open_charges.rows, '[]'::jsonb),
      'payments', coalesce(payments.rows, '[]'::jsonb),
      'receipts', coalesce(receipts.rows, '[]'::jsonb)
    )
  )
  into payload
  from dozeclin.patient_portals pp
  join dozeclin.patients p
    on p.id = pp.patient_id
   and p.clinic_id = pp.clinic_id
   and p.status = 'active'
  join dozeclin.clinics c
    on c.id = pp.clinic_id
   and c.status in ('trial', 'active')
  left join dozeclin.patient_onboarding po
    on po.patient_id = p.id
   and po.portal_id = pp.id
  left join lateral (
    select af.id,
           af.clinic_id,
           af.patient_id,
           af.status,
           af.answers,
           af.created_at,
           af.updated_at
    from dozeclin.anamnesis_forms af
    where af.patient_id = p.id
    order by af.created_at desc
    limit 1
  ) af on true
  left join lateral (
    select a.id,
           a.clinic_id,
           a.patient_id,
           a.professional_id,
           a.appointment_date,
           a.start_time,
           a.end_time,
           a.status,
           a.scheduled_start,
           a.scheduled_end,
           a.clinic_timezone,
           a.patient_timezone_snapshot,
           a.meeting_url,
           a.meeting_provider,
           a.modality,
           a.expected_duration,
           pr.full_name as professional_name,
           pr.specialty as professional_specialty
    from dozeclin.appointments a
    left join dozeclin.profiles pr on pr.id = a.professional_id
    where a.patient_id = p.id
      and a.clinic_id = p.clinic_id
      and a.status in ('scheduled', 'confirmed', 'checked_in', 'in_progress')
      and a.scheduled_end >= now()
    order by a.scheduled_start asc
    limit 1
  ) na on true
  left join lateral (
    select coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.scheduled_start desc), '[]'::jsonb) as rows
    from (
      select a.id,
             a.clinic_id,
             a.patient_id,
             a.professional_id,
             a.appointment_date,
             a.start_time,
             a.end_time,
             a.status,
             a.scheduled_start,
             a.scheduled_end,
             a.clinic_timezone,
             a.patient_timezone_snapshot,
             a.modality,
             a.expected_duration,
             pr.full_name as professional_name,
             pr.specialty as professional_specialty
      from dozeclin.appointments a
      left join dozeclin.profiles pr on pr.id = a.professional_id
      where a.patient_id = p.id
        and a.clinic_id = p.clinic_id
      order by a.scheduled_start desc
      limit 20
    ) row_data
  ) appointments on true
  left join lateral (
    select coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.issued_at desc nulls last, row_data.created_at desc), '[]'::jsonb) as rows
    from (
      select d.id,
             d.document_type,
             d.document_number,
             d.title,
             d.status,
             case when d.status = 'revoked' then true else false end as revoked,
             d.signature_status,
             d.visibility,
             d.current_version,
             d.issued_at,
             d.created_at,
             d.patient_access_enabled,
             d.patient_access_enabled_at,
             d.current_pdf_generated_at,
             case
               when d.current_pdf_path is not null
                and d.current_pdf_hash is not null
                and d.current_pdf_generated_at is not null
                 then true
               else false
             end as pdf_available,
             pr.full_name as professional_name,
             pr.specialty as professional_title
      from dozeclin.clinical_documents d
      left join dozeclin.profiles pr on pr.id = d.professional_id
      where d.patient_id = p.id
        and d.clinic_id = p.clinic_id
        and d.visibility = 'patient'
        and d.patient_access_enabled = true
        and d.status in ('issued', 'revoked')
      order by d.issued_at desc nulls last, d.created_at desc
      limit 20
    ) row_data
  ) documents on true
  left join lateral (
    select coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.due_date nulls last, row_data.created_at desc), '[]'::jsonb) as rows
    from (
      select fc.id,
             fc.description,
             case
               when fc.status = 'pending' and fc.due_date is not null and fc.due_date < current_date
                 then 'overdue'
               else fc.status::text
             end as status,
             fc.currency,
             fc.final_amount,
             fc.paid_amount,
             fc.remaining_amount,
             fc.due_date,
             fc.created_at
      from dozeclin.financial_charges fc
      where fc.patient_id = p.id
        and fc.clinic_id = p.clinic_id
        and fc.status in ('pending', 'partially_paid', 'overdue')
    ) row_data
  ) open_charges on true
  left join lateral (
    select coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.payment_date desc), '[]'::jsonb) as rows
    from (
      select fp.id,
             fp.amount,
             fp.currency,
             fp.payment_method,
             fp.payment_status,
             fp.payment_date
      from dozeclin.financial_payments fp
      where fp.patient_id = p.id
        and fp.clinic_id = p.clinic_id
        and fp.payment_status = 'confirmed'
      order by fp.payment_date desc
      limit 10
    ) row_data
  ) payments on true
  left join lateral (
    select coalesce(jsonb_agg(to_jsonb(row_data) order by row_data.issued_at desc), '[]'::jsonb) as rows
    from (
      select fr.id,
             fr.receipt_number,
             fr.currency,
             fr.amount,
             fr.issued_at,
             fr.status,
             fr.document_template_version,
             fr.pdf_generated_at,
             case
               when fr.pdf_storage_path is not null
                and fr.pdf_hash is not null
                and fr.pdf_generated_at is not null
                 then true
               else false
             end as pdf_available,
             fr.external_fiscal_reference,
             fr.external_fiscal_document_type,
             fr.external_fiscal_document_number,
             fr.external_fiscal_atcud
      from dozeclin.financial_receipts fr
      where fr.patient_id = p.id
        and fr.clinic_id = p.clinic_id
        and fr.status = 'issued'
      order by fr.issued_at desc
      limit 10
    ) row_data
  ) receipts on true
  where pp.auth_user_id = auth.uid()
    and pp.status = 'active'
  limit 1;

  if payload is null then
    raise exception 'Portal do paciente nao encontrado ou indisponivel.';
  end if;

  return payload;
end;
$$;

revoke execute on function dozeclin.get_patient_portal_context() from public, anon;
grant execute on function dozeclin.get_patient_portal_context() to authenticated;

commit;
