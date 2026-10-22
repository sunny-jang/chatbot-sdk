/** Read-only schema export; never reads customer rows or credential values. */
import {writeFile,mkdir} from 'node:fs/promises';
import sql from '../lib/neon';
async function main(){
 const columns=await sql`SELECT c.table_name,c.column_name,c.data_type,c.udt_name,c.is_nullable,c.ordinal_position,
 EXISTS(SELECT 1 FROM information_schema.table_constraints t JOIN information_schema.key_column_usage k ON k.constraint_name=t.constraint_name AND k.constraint_schema=t.constraint_schema WHERE t.constraint_type='PRIMARY KEY' AND t.table_schema='public' AND t.table_name=c.table_name AND k.column_name=c.column_name) AS primary_key
 FROM information_schema.columns c JOIN information_schema.tables t ON t.table_name=c.table_name AND t.table_schema=c.table_schema AND t.table_type='BASE TABLE'
 WHERE c.table_schema='public' ORDER BY c.table_name,c.ordinal_position`;
 const relations=await sql`SELECT src.relname AS source_table,sa.attname AS source_column,dst.relname AS target_table,da.attname AS target_column,
 con.conname AS constraint_name,con.confdeltype AS on_delete FROM pg_constraint con
 JOIN pg_class src ON src.oid=con.conrelid JOIN pg_namespace ns ON ns.oid=src.relnamespace JOIN pg_class dst ON dst.oid=con.confrelid JOIN pg_namespace target_ns ON target_ns.oid=dst.relnamespace
 CROSS JOIN LATERAL unnest(con.conkey,con.confkey) WITH ORDINALITY AS keys(source_num,target_num,n)
 JOIN pg_attribute sa ON sa.attrelid=src.oid AND sa.attnum=keys.source_num JOIN pg_attribute da ON da.attrelid=dst.oid AND da.attnum=keys.target_num
 WHERE con.contype='f' AND ns.nspname='public' AND target_ns.nspname='public' ORDER BY src.relname,con.conname,keys.n`;
 const uniqueKeys=await sql`SELECT t.relname AS table_name,con.conname,ARRAY_AGG(a.attname ORDER BY k.n) AS columns FROM pg_constraint con JOIN pg_class t ON t.oid=con.conrelid JOIN pg_namespace ns ON ns.oid=t.relnamespace CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(num,n) JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.num WHERE con.contype IN ('p','u') AND ns.nspname='public' GROUP BY t.relname,con.conname`;
 await mkdir('docs/architecture',{recursive:true});
 await writeFile('docs/architecture/schema-2026-10-22.json',JSON.stringify({date:'2026-10-22',scope:'public schema; isolated local QA database including pending customer/demo migrations; production migration not applied',columns,relations,uniqueKeys},null,2)+'\n');
 console.log(`${new Set(columns.map(c=>c.table_name)).size} tables, ${relations.length} FK column relations; no row data exported`);
}
main().catch(e=>{console.error(e instanceof Error?e.message:'schema export failed');process.exitCode=1}).finally(()=>sql.end());
