-- StripClub — seed: token packs (1 PKR = 2 tokens), default categories,
-- core settings. Idempotent.

insert into public.token_packs (label, price_pkr, tokens, sort_order) values
  ('Starter', 250, 500, 1),
  ('Classic', 500, 1000, 2),
  ('Plus', 1000, 2000, 3),
  ('VIP', 2500, 5000, 4),
  ('Elite', 5000, 10000, 5)
on conflict do nothing;

insert into public.categories (name, slug, sort_order) values
  ('Companionship', 'companionship', 1),
  ('Performance', 'performance', 2),
  ('Advice & Coaching', 'advice-coaching', 3),
  ('Music & Audio', 'music-audio', 4),
  ('Gaming', 'gaming', 5),
  ('Fitness', 'fitness', 6)
on conflict do nothing;

insert into public.settings (key, value) values
  ('token_rate', '{"pkr_per_token": 0.5}'::jsonb),          -- 1 PKR = 2 tokens
  ('payouts', '{"min_tokens": 1000}'::jsonb)
on conflict do nothing;
