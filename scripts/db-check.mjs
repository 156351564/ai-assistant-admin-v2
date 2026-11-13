/**
 * 数据库连通性自检。
 *
 * 用法（Node 20+ 支持 --env-file）：
 *   node --env-file=.env.local scripts/db-check.mjs
 *
 * 检查三件事：
 *   1. 连接串能不能连上
 *   2. 表建了没有（没建就提示去触发一次 ensureSchema）
 *   3. 当前数据量（会话数 / 消息数 / 用量天数）
 */
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("✗ DATABASE_URL 未设置。请在 .env.local 里填，或用 --env-file 指定文件。");
  process.exit(1);
}

// 别把整条连接串打出来，只打 host，避免密码进日志
const host = url.match(/@([^/:?]+)/)?.[1] ?? "(解析失败)";
console.log(`→ 连接 host: ${host}`);

const sql = neon(url);

try {
  const info = await sql`select current_database() as db, current_user as usr`;
  console.log(`✓ 连接成功 ｜ database=${info[0].db} ｜ user=${info[0].usr}`);

  const tables = await sql`
    select table_name from information_schema.tables
    where table_schema = 'public'
      and table_name in ('sessions', 'messages', 'usage_daily')
    order by table_name
  `;
  const names = tables.map((t) => t.table_name);
  console.log(`→ 已存在的表: ${names.length ? names.join(", ") : "(无)"}`);

  if (names.length < 3) {
    console.log("！表还没建全。启动应用后访问一次 /api/sessions 就会自动建表（ensureSchema）。");
  } else {
    const [s] = await sql`select count(*)::int as n from sessions`;
    const [m] = await sql`select count(*)::int as n from messages`;
    const [u] = await sql`select count(*)::int as n from usage_daily`;
    console.log(`✓ 数据量：会话 ${s.n} ｜ 消息 ${m.n} ｜ 用量天数 ${u.n}`);
  }
} catch (e) {
  console.error("✗ 失败:", e?.message ?? e);
  console.error("常见原因：连接串复制不全 / 没带 ?sslmode=require / 项目已休眠（Neon 免费版会自动挂起，首次连接稍慢）");
  process.exit(1);
}
