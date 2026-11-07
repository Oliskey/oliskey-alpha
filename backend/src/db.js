import pg from 'pg';

// Numeric columns arrive as strings by default; keep them as strings to avoid float rounding on money.
// DB_POOL_MAX: connections to Postgres (default 20). Keep it within the database/pooler limit (Supabase pooler: see plan).
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: Number(process.env.DB_POOL_MAX || 20) });
