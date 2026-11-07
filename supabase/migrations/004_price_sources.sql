-- Where each asset's price comes from. 'sim' = the backend's simulated random walk; 'binance' = live Binance
-- spot trades (source_symbol = Binance pair). Owner decision 2026-10-30: real prices wherever a free live feed exists.
alter table public.assets
  add column price_source text not null default 'sim' check (price_source in ('sim', 'binance')),
  add column source_symbol text;

update public.assets set price_source = 'binance', source_symbol = v.sym
from (values
  ('BTCUSD', 'BTCUSDT'), ('ETHUSD', 'ETHUSDT'), ('SOLUSD', 'SOLUSDT'), ('BNBUSD', 'BNBUSDT'), ('XRPUSD', 'XRPUSDT'),
  ('ADAUSD', 'ADAUSDT'), ('DOGEUSD', 'DOGEUSDT'), ('DOTUSD', 'DOTUSDT'), ('LTCUSD', 'LTCUSDT'), ('AVAXUSD', 'AVAXUSDT'),
  ('LINKUSD', 'LINKUSDT'), ('TRXUSD', 'TRXUSDT'), ('BCHUSD', 'BCHUSDT'), ('XLMUSD', 'XLMUSDT'), ('UNIUSD', 'UNIUSDT'),
  ('ATOMUSD', 'ATOMUSDT'), ('NEARUSD', 'NEARUSDT')
) as v(id, sym)
where assets.id = v.id;

-- Decimals = Binance's price step for each pair, so live prices never show invented digits.
update public.assets a set decimals = v.dec
from (values ('BTCUSDT', 2), ('ETHUSDT', 2), ('BNBUSDT', 2), ('LTCUSDT', 2), ('ADAUSDT', 4), ('XRPUSDT', 4),
  ('XLMUSDT', 4), ('TRXUSDT', 4), ('LINKUSDT', 3), ('ATOMUSDT', 3), ('DOGEUSDT', 5), ('BCHUSDT', 1), ('SOLUSDT', 2),
  ('DOTUSDT', 3), ('UNIUSDT', 3), ('AVAXUSDT', 3), ('NEARUSDT', 3)) as v(sym, dec)
where a.source_symbol = v.sym;
