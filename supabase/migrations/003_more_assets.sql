-- Full market list: currencies, crypto, indices and commodities. Prices are simulated by the backend price engine.
-- sort_order groups the list: currencies 1-99, crypto 100-199, indices 200-299, commodities 300-399.
-- volatility = std-dev of one 250 ms tick as a fraction of price.

update public.assets set sort_order = 100 where id = 'BTCUSD';
update public.assets set sort_order = 101 where id = 'ETHUSD';
update public.assets set sort_order = 200 where id = 'ALPHAMET';
update public.assets set sort_order = 300 where id = 'XAUUSD';

insert into public.assets (id, name, category, base_price, decimals, volatility, payout_fixed, payout_inzone, max_leverage, sort_order) values
  -- currencies: majors
  ('USDJPY', 'USD/JPY', 'currency', 151.250,  3, 0.00002,  85, 110, 500,  7),
  ('USDCHF', 'USD/CHF', 'currency', 0.86450,  5, 0.00002,  85, 110, 500,  8),
  ('AUDUSD', 'AUD/USD', 'currency', 0.65800,  5, 0.00002,  85, 110, 500,  9),
  ('USDCAD', 'USD/CAD', 'currency', 1.38900,  5, 0.00002,  85, 110, 500, 10),
  ('NZDUSD', 'NZD/USD', 'currency', 0.59700,  5, 0.00002,  85, 110, 500, 11),
  -- currencies: crosses
  ('EURGBP', 'EUR/GBP', 'currency', 0.83300,  5, 0.00002,  85, 110, 500, 12),
  ('EURJPY', 'EUR/JPY', 'currency', 163.400,  3, 0.00002,  85, 110, 500, 13),
  ('GBPJPY', 'GBP/JPY', 'currency', 196.200,  3, 0.000025, 85, 110, 500, 14),
  ('EURCHF', 'EUR/CHF', 'currency', 0.93700,  5, 0.00002,  85, 110, 500, 15),
  ('EURAUD', 'EUR/AUD', 'currency', 1.64200,  5, 0.00002,  84, 110, 500, 16),
  ('EURCAD', 'EUR/CAD', 'currency', 1.50100,  5, 0.00002,  84, 110, 500, 17),
  ('EURNZD', 'EUR/NZD', 'currency', 1.80800,  5, 0.000025, 84, 110, 500, 18),
  ('GBPAUD', 'GBP/AUD', 'currency', 1.97100,  5, 0.000025, 84, 110, 500, 19),
  ('GBPCHF', 'GBP/CHF', 'currency', 1.12400,  5, 0.00002,  84, 110, 500, 20),
  ('AUDCAD', 'AUD/CAD', 'currency', 0.91400,  5, 0.00002,  84, 110, 500, 21),
  ('AUDNZD', 'AUD/NZD', 'currency', 1.10200,  5, 0.00002,  84, 110, 500, 22),
  ('CADJPY', 'CAD/JPY', 'currency', 108.900,  3, 0.00002,  84, 110, 500, 23),
  ('CHFJPY', 'CHF/JPY', 'currency', 174.900,  3, 0.00002,  84, 110, 500, 24),
  ('NZDJPY', 'NZD/JPY', 'currency', 90.300,   3, 0.00002,  84, 110, 500, 25),
  -- currencies: exotics
  ('USDNGN', 'USD/NGN', 'currency', 1550.00,  2, 0.00003,  82, 110, 100, 30),
  ('USDZAR', 'USD/ZAR', 'currency', 17.8500,  4, 0.00003,  82, 110, 100, 31),
  ('USDTRY', 'USD/TRY', 'currency', 34.2500,  4, 0.00003,  82, 110, 100, 32),
  ('USDMXN', 'USD/MXN', 'currency', 19.8500,  4, 0.00003,  82, 110, 100, 33),
  ('USDSGD', 'USD/SGD', 'currency', 1.32400,  5, 0.00002,  83, 110, 200, 34),
  ('USDHKD', 'USD/HKD', 'currency', 7.77500,  4, 0.00001,  83, 110, 200, 35),
  ('EURTRY', 'EUR/TRY', 'currency', 37.1500,  4, 0.00003,  82, 110, 100, 36),
  -- crypto
  ('SOLUSD',  'Solana',        'crypto', 175.00,   2, 0.0001,   80, 110, 50, 102),
  ('BNBUSD',  'BNB',           'crypto', 590.00,   2, 0.00008,  80, 110, 50, 103),
  ('XRPUSD',  'XRP',           'crypto', 0.5800,   4, 0.0001,   80, 110, 50, 104),
  ('ADAUSD',  'Cardano',       'crypto', 0.3600,   4, 0.0001,   80, 110, 50, 105),
  ('DOGEUSD', 'Dogecoin',      'crypto', 0.16000,  5, 0.00012,  80, 110, 50, 106),
  ('DOTUSD',  'Polkadot',      'crypto', 4.300,    3, 0.0001,   80, 110, 50, 107),
  ('LTCUSD',  'Litecoin',      'crypto', 72.00,    2, 0.00009,  80, 110, 50, 108),
  ('AVAXUSD', 'Avalanche',     'crypto', 27.00,    2, 0.0001,   80, 110, 50, 109),
  ('LINKUSD', 'Chainlink',     'crypto', 12.000,   3, 0.0001,   80, 110, 50, 110),
  ('TRXUSD',  'TRON',          'crypto', 0.16500,  5, 0.00008,  80, 110, 50, 111),
  ('TONUSD',  'Toncoin',       'crypto', 5.200,    3, 0.0001,   80, 110, 50, 112),
  ('BCHUSD',  'Bitcoin Cash',  'crypto', 360.00,   2, 0.00009,  80, 110, 50, 113),
  ('XLMUSD',  'Stellar',       'crypto', 0.09500,  5, 0.0001,   80, 110, 50, 114),
  ('UNIUSD',  'Uniswap',       'crypto', 7.800,    3, 0.0001,   80, 110, 50, 115),
  ('ATOMUSD', 'Cosmos',        'crypto', 4.600,    3, 0.0001,   80, 110, 50, 116),
  ('NEARUSD', 'NEAR Protocol', 'crypto', 4.900,    3, 0.0001,   80, 110, 50, 117),
  -- indices (generic names, simulated levels)
  ('US500',  'US 500',        'index', 5800.00,  2, 0.00003,  83, 110, 100, 201),
  ('US100',  'US Tech 100',   'index', 20500.00, 2, 0.000035, 83, 110, 100, 202),
  ('US30',   'Wall Street 30','index', 42000.00, 2, 0.00003,  83, 110, 100, 203),
  ('UK100',  'UK 100',        'index', 8200.00,  2, 0.00003,  83, 110, 100, 204),
  ('DE40',   'Germany 40',    'index', 19500.00, 2, 0.00003,  83, 110, 100, 205),
  ('FR40',   'France 40',     'index', 7500.00,  2, 0.00003,  83, 110, 100, 206),
  ('EU50',   'Euro 50',       'index', 4900.00,  2, 0.00003,  83, 110, 100, 207),
  ('JP225',  'Japan 225',     'index', 38500.00, 2, 0.000035, 83, 110, 100, 208),
  ('HK50',   'Hong Kong 50',  'index', 20000.00, 2, 0.00004,  83, 110, 100, 209),
  ('AU200',  'Australia 200', 'index', 8200.00,  2, 0.00003,  83, 110, 100, 210),
  -- commodities: metals, energy, agriculture
  ('XAGUSD', 'Silver',        'commodity', 31.500,  3, 0.00005,  82, 110, 200, 301),
  ('XPTUSD', 'Platinum',      'commodity', 980.00,  2, 0.00005,  82, 110, 100, 302),
  ('XPDUSD', 'Palladium',     'commodity', 1000.00, 2, 0.00006,  82, 110, 100, 303),
  ('COPPER', 'Copper',        'commodity', 4.3000,  4, 0.00004,  82, 110, 100, 304),
  ('USOIL',  'Crude Oil (WTI)','commodity', 72.00,  2, 0.00005,  82, 110, 100, 310),
  ('UKOIL',  'Brent Oil',     'commodity', 76.00,   2, 0.00005,  82, 110, 100, 311),
  ('NATGAS', 'Natural Gas',   'commodity', 2.600,   3, 0.00008,  80, 110, 50,  312),
  ('CORN',   'Corn',          'commodity', 4.2000,  4, 0.00004,  82, 110, 50,  320),
  ('WHEAT',  'Wheat',         'commodity', 5.6000,  4, 0.00004,  82, 110, 50,  321),
  ('SOYBEAN','Soybeans',      'commodity', 10.000,  3, 0.00004,  82, 110, 50,  322),
  ('COFFEE', 'Coffee',        'commodity', 2.4000,  4, 0.00005,  82, 110, 50,  323),
  ('SUGAR',  'Sugar',         'commodity', 0.2100,  4, 0.00005,  82, 110, 50,  324),
  ('COCOA',  'Cocoa',         'commodity', 7000.0,  1, 0.00006,  80, 110, 50,  325)
on conflict (id) do nothing;
