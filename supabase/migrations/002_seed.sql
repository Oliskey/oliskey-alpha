-- Oliskey Alpha seed data. Prices are simulated by the backend price engine around base_price.

insert into public.platform_settings (id, live_trading_enabled, demo_start_balance, min_deposit_ngn, min_withdrawal_ngn)
values (true, false, 10000, 1000, 1000)
on conflict (id) do nothing;

-- volatility = std-dev of one 250 ms tick as a fraction of price. InZone corridor scales with duration (see open_trade).
insert into public.assets (id, name, category, base_price, decimals, volatility, payout_fixed, payout_inzone, max_leverage, sort_order) values
  ('EURUSD',   'EUR/USD',            'currency',  1.11620,  5, 0.00002, 85, 110, 500,  1),
  ('GBPUSD',   'GBP/USD',            'currency',  1.27100,  5, 0.00002, 85, 110, 500,  2),
  ('AUDCHF',   'AUD/CHF',            'currency',  0.58460,  5, 0.00002, 85, 110, 500,  3),
  ('AUDJPY',   'AUD/JPY',            'currency',  114.570,  3, 0.00002, 85, 110, 500,  4),
  ('NZDCAD',   'NZD/CAD',            'currency',  0.81200,  5, 0.00002, 85, 110, 500,  5),
  ('GBPCAD',   'GBP/CAD',            'currency',  1.74200,  5, 0.00002, 85, 110, 500,  6),
  ('XAUUSD',   'Gold',               'commodity', 2650.00,  2, 0.00004, 82, 110, 200,  7),
  ('ALPHAMET', 'Alpha Metals Index', 'index',     5901.5000, 4, 0.00003, 85, 110, 100, 8),
  ('BTCUSD',   'Bitcoin',            'crypto',    68000.00, 2, 0.00008, 80, 110,  50,  9),
  ('ETHUSD',   'Ethereum',           'crypto',    2500.00,  2, 0.00008, 80, 110,  50, 10)
on conflict (id) do nothing;

insert into public.tasks (id, title, kind, target, reward, asset_id, mode, time_limit_sec, sort_order) values
  ('first_trade',   'Open your very first trade',       'trade_count', 1,  10, null,     null,     86400, 1),
  ('streak_gbpcad', 'Win 6 trades in a row on GBP/CAD', 'win_streak',  6,  50, 'GBPCAD', null,     10800, 2),
  ('ten_trades',    'Place 10 trades on any asset',     'trade_count', 10, 20, null,     null,     86400, 3),
  ('inzone_five',   'Open 5 InZone trades',             'trade_count', 5,  25, null,     'inzone', 86400, 4)
on conflict (id) do nothing;

insert into public.promo_codes (code, description, bonus_pct, max_bonus, min_deposit) values
  ('ALPHA30',   '30% bonus on a deposit of ₦5,000 or more', 30, 30000, 5000),
  ('WELCOME10', '10% welcome bonus on your first deposit',  10, 10000, 2000)
on conflict (code) do nothing;
