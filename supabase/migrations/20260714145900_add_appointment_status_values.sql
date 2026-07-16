alter type dozeclin.appointment_status add value if not exists 'checked_in';
alter type dozeclin.appointment_status add value if not exists 'rescheduled';
alter type dozeclin.appointment_status add value if not exists 'cancelled_by_patient';
alter type dozeclin.appointment_status add value if not exists 'cancelled_by_clinic';
alter type dozeclin.appointment_status add value if not exists 'archived';
