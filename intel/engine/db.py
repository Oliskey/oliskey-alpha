"""Postgres storage for the engine (schema `intel` in the app database)."""
from __future__ import annotations

import pandas as pd
import psycopg

from .settings import DATABASE_URL

SCHEMA = """
create schema if not exists intel;

create table if not exists intel.bars (
  asset_id text not null,
  tf       text not null,
  ts       timestamptz not null,
  open double precision not null, high double precision not null,
  low  double precision not null, close double precision not null,
  volume double precision not null default 0,
  primary key (asset_id, tf, ts)
);

-- Walk-forward results per strategy / asset class / regime (rebuilt by each backtest run).
create table if not exists intel.strategy_stats (
  strategy text not null, asset_class text not null, regime text not null,
  trades int not null, wins int not null, hit_rate double precision not null,
  hit_low double precision not null, breakeven double precision not null,
  expectancy_r double precision not null, accepted boolean not null,
  computed_at timestamptz not null default now(),
  primary key (strategy, asset_class, regime)
);

-- Every published idea, stored BEFORE its outcome is known, then resolved automatically.
create table if not exists intel.ideas (
  id bigserial primary key,
  asset_id text not null,
  asset_class text not null,
  strategy text not null,
  regime text not null,
  direction smallint not null check (direction in (-1, 1)),
  tf text not null,
  bar_time timestamptz not null,           -- close of the bar that produced the signal
  created_at timestamptz not null default now(),
  enter_until timestamptz not null,        -- entry window
  expires_at timestamptz not null,         -- horizon end
  entry double precision not null,
  stop double precision not null,
  target double precision not null,
  probability double precision not null,
  ev_per_100 double precision not null,
  reasons jsonb not null,
  status text not null default 'open' check (status in ('open', 'won', 'lost', 'expired')),
  result_r double precision,
  exit_price double precision,
  resolved_at timestamptz,
  unique (asset_id, strategy, bar_time)
);
create index if not exists ideas_created_idx on intel.ideas (created_at desc);
-- kind: 'idea' = suggested trade (accepted strategy); 'avoid' = setup the engine said NOT to take (strategy not
-- proven). Both are resolved, so the track record shows how ideas did and how skipped setups would have done.
alter table intel.ideas add column if not exists kind text not null default 'idea' check (kind in ('idea', 'avoid'));
alter table intel.ideas add column if not exists horizon_hours int not null default 0;
-- One idea per market, strategy, timeframe and bar (crypto is scanned on 1 h and 4 h bars).
alter table intel.ideas drop constraint if exists ideas_asset_id_strategy_bar_time_key;
create unique index if not exists ideas_unique_idx on intel.ideas (asset_id, strategy, tf, bar_time);

-- Forward test: the backend places a demo-money trade for every live-priced setup in the Engine demo account.
create table if not exists intel.paper_trades (
  idea_id bigint primary key references intel.ideas (id) on delete cascade,
  trade_id uuid not null,
  created_at timestamptz not null default now()
);

-- AI Spot forward paper trading (docs/intel/SPOT_HYPOTHESES.md, forward protocol). No money moves: these are records.
create table if not exists intel.spot_paper_tracking (
  strategy_id text not null,
  version text not null,
  symbol text not null,
  started_at timestamptz not null default now(),
  primary key (strategy_id, version, symbol)
);
create table if not exists intel.spot_paper_trades (
  id text primary key,                         -- strategy|version|symbol|signal bar
  strategy_id text not null,
  version text not null,
  symbol text not null,
  timeframe text not null,
  status text not null check (status in ('open', 'closed')),
  signal_at timestamptz not null,
  entry_at timestamptz not null,
  entry double precision not null,
  stop0 double precision not null,
  stop_now double precision,
  target double precision,
  last_price double precision,
  exit_at timestamptz,
  exit double precision,
  reason text,
  r double precision,
  mfe_r double precision,
  mae_r double precision,
  bars int,
  regime text,
  updated_at timestamptz not null default now()
);
create index if not exists spot_paper_trades_entry_idx on intel.spot_paper_trades (strategy_id, entry_at);
create table if not exists intel.spot_paper_summary (
  id text primary key,
  summary jsonb not null,
  updated_at timestamptz not null default now()
);
"""


def connect() -> psycopg.Connection:
    return psycopg.connect(DATABASE_URL, autocommit=True)


def ensure_schema() -> None:
    with connect() as c:
        c.execute(SCHEMA)


def upsert_bars(asset_id: str, tf: str, df: pd.DataFrame) -> int:
    if df.empty:
        return 0
    rows = [(asset_id, tf, ts.to_pydatetime(), r.open, r.high, r.low, r.close, r.volume) for ts, r in df.iterrows()]
    with connect() as c, c.cursor() as cur:
        cur.executemany(
            """insert into intel.bars (asset_id, tf, ts, open, high, low, close, volume)
               values (%s, %s, %s, %s, %s, %s, %s, %s)
               on conflict (asset_id, tf, ts) do update set open = excluded.open, high = excluded.high,
                 low = excluded.low, close = excluded.close, volume = excluded.volume""",
            rows,
        )
    return len(rows)


def load_bars(asset_id: str, tf: str) -> pd.DataFrame:
    with connect() as c:
        rows = c.execute(
            "select ts, open, high, low, close, volume from intel.bars where asset_id = %s and tf = %s order by ts",
            (asset_id, tf),
        ).fetchall()
    df = pd.DataFrame(rows, columns=["ts", "open", "high", "low", "close", "volume"])
    if not df.empty:
        df["ts"] = pd.to_datetime(df["ts"], utc=True)
        df = df.set_index("ts")
    return df


def first_bar_time(asset_id: str, tf: str):
    with connect() as c:
        row = c.execute("select min(ts) from intel.bars where asset_id = %s and tf = %s", (asset_id, tf)).fetchone()
    return row[0]


def last_bar_time(asset_id: str, tf: str):
    with connect() as c:
        row = c.execute("select max(ts) from intel.bars where asset_id = %s and tf = %s", (asset_id, tf)).fetchone()
    return row[0]
