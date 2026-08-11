import postgres from "postgres";

const sql = postgres(process.env.POSTGRES_URL!, {
  ssl: "require",
  prepare: false, // required for Supabase pgbouncer
});

export default sql;
