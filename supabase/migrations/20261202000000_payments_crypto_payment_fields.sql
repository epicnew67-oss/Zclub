-- In-app crypto checkout: direct NOWPayments payments carry the selected
-- coin, the exact amount to send, the deposit address and the payment
-- window. These are display/metadata fields — money state still moves
-- only through nowpayments_webhook_apply (verified IPN / server-side
-- status sync), never from the client.

alter table public.payments
  add column if not exists pay_address text,
  add column if not exists pay_expires_at timestamptz,
  add column if not exists pay_status text;
