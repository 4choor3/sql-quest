/* ==========================================================================
   题库自检（Node + sql.js 真跑 SQLite）
   --------------------------------------------------------------------------
   校验项：
     1. 每关 solution 能执行且返回非空结果
     2. 每关 solution 满足自己的 require 约束（防止答案通不过自己的门槛）
     3. 每关 starter 不通过（保证起始状态确实是「未完成」）
     4. DML 关卡的 probe 在 solution 执行后能取到结果
     5. 比对器对 solution 判定为通过（端到端一致性）
   ========================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ------------------------------------------------ 在 Node 里加载浏览器脚本 */
const sandbox = { window: {}, console, atob: (s) => Buffer.from(s, 'base64').toString('binary') };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

// 三个文件拼成一个脚本执行，末尾显式导出顶层 const
// （vm.runInContext 里 const/let 属于脚本词法作用域，不会挂到 global 上）
const bundle =
  ['data/schema.js', 'data/schema_adv.js', 'src/levels.js', 'src/levels-adv.js', 'src/engine.js']
    .map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8'))
    .join('\n;\n') +
  '\n;window.__x = { CHAPTERS: window.CHAPTERS, ADV_CHAPTERS: window.ADV_CHAPTERS, Engine, Compare, keywordCheck, DATASETS };';
vm.runInContext(bundle, sandbox, { filename: 'bundle.js' });
const { CHAPTERS, ADV_CHAPTERS, Engine, Compare, keywordCheck, DATASETS } = sandbox.window.__x;

/* ---------------------------------------------------------------- 初始化 */
// 浏览器里 Engine.init() 走内联 base64 wasm；Node 下直接注入 sql.js 模块
const initSqlJs = (await import('sql.js')).default;
const SQL = await initSqlJs();
Engine.SQL = SQL;
Engine.instances = {};
Engine.clean = {};
for (const key of Object.keys(DATASETS)) {
  const sql = sandbox.window[DATASETS[key].varName];
  if (!sql) continue;
  const d = new SQL.Database();
  d.run(sql);
  Engine.instances[key] = d;
  Engine.clean[key] = d.export();
}
Engine.dataset = 'bookstore';
Engine.db = Engine.instances.bookstore;
Engine.ready = true;

const allChapters = [...CHAPTERS, ...ADV_CHAPTERS];
const flat = [];
for (const ch of allChapters) {
  for (const lv of ch.levels) {
    lv._chapter = ch;
    lv.dataset = lv.dataset || ch.dataset || 'bookstore';
    flat.push(lv);
  }
}

const expect = {};
for (const lv of flat) {
  const prev = Engine.dataset;
  Engine.use(lv.dataset);
  if (!lv.probe) {
    expect[lv.id] = Engine.run(lv.solution);
  } else {
    const tmp = new Engine.SQL.Database(Engine.cleanExport());
    tmp.run(lv.solution);
    const r = tmp.exec(lv.probe);
    expect[lv.id] = r.length ? { columns: r[0].columns, values: r[0].values } : { columns: [], values: [] };
    tmp.close();
  }
  Engine.use(prev);
}

/* ---------------------------------------------------------------- 跑校验 */
let pass = 0;
const fails = [];
const warns = [];

function fail(id, msg) { fails.push(`[${id}] ${msg}`); }
function warn(id, msg) { warns.push(`[${id}] ${msg}`); }

for (const lv of flat) {
  const exp = expect[lv.id];
  Engine.use(lv.dataset);

  // 1. 期望结果非空
  if (!exp) { fail(lv.id, '期望结果为空对象'); continue; }
  if (!exp.values.length) {
    fail(lv.id, `参考答案返回 0 行 —— 这关的答案有问题（${lv.compare}）`);
    continue;
  }

  // 2. solution 满足自身 require
  const kw = keywordCheck(lv, lv.solution);
  if (kw) fail(lv.id, `参考答案不满足自己的约束：${kw}`);

  // 3. 模拟用户提交 solution → 必须通过
  const snap = Engine.db.export();
  let got;
  try {
    Engine.restore(snap);
    Engine.db.run(lv.solution);
    const probe = lv.probe || lv.solution;
    const r = Engine.db.exec(probe);
    got = r.length ? { columns: r[r.length - 1].columns, values: r[r.length - 1].values } : { columns: [], values: [] };
  } catch (e) {
    fail(lv.id, `参考答案执行报错：${e.message}`);
    Engine.restore(snap);
    continue;
  }
  const v = Compare.check(lv, got, exp);
  if (!v.ok) fail(lv.id, `参考答案未通过比对：${(v.reason || '').split('\n')[0]}`);
  else pass++;

  // 4. starter 不应该通过（否则一进关就"已完成"的错觉）
  if (lv.starter && lv.starter.trim()) {
    Engine.restore(snap);
    let sGot = null, sErr = null;
    try {
      Engine.db.run(lv.starter);
      const probe = lv.probe || lv.starter;
      const r = Engine.db.exec(probe);
      sGot = r.length ? { columns: r[r.length - 1].columns, values: r[r.length - 1].values } : { columns: [], values: [] };
    } catch (e) { sErr = e.message; }
    if (!sErr && sGot) {
      const sv = Compare.check(lv, sGot, exp);
      const skw = keywordCheck(lv, lv.starter);
      if (sv.ok && !skw) warn(lv.id, 'starter 直接就能通过，建议清空或改成不完整片段');
    }
    Engine.restore(snap);
  }

  // 5. DML 关卡必须有 probe
  if (/\b(insert|update|delete)\b/i.test(lv.solution) && !lv.probe) {
    fail(lv.id, 'DML 关卡缺少 probe，无法校验');
  }
  // 6. SELECT 关卡不该有 probe
  if (!/\b(insert|update|delete)\b/i.test(lv.solution) && lv.probe) {
    warn(lv.id, 'SELECT 关卡带 probe，确认是否有意为之');
  }
}

/* ------------------------------------------------- 额外：负例（错误答案） */
const negatives = [
  ['1-2', 'SELECT id, title FROM books LIMIT 5;', '缺少 ORDER BY 时顺序不保证，但结果集可能巧合一致'],
  ['3-4', 'SELECT genre, COUNT(*) AS book_count FROM books GROUP BY genre;', '缺 ORDER BY 应判错'],
  ['4-3', 'SELECT c.name, COUNT(*) AS order_count FROM customers c LEFT JOIN orders o ON o.customer_id = c.id GROUP BY c.id;', 'COUNT(*) 会把无订单客户数成 1，应判错'],
  ['2-5', 'SELECT name, city FROM customers WHERE city = NULL;', '= NULL 应返回 0 行，应判错'],
];
for (const [id, sql, why] of negatives) {
  const lv = flat.find((l) => l.id === id);
  if (!lv) continue;
  const snap = Engine.db.export();
  Engine.restore(snap);
  let got;
  try {
    Engine.db.run(sql);
    const r = Engine.db.exec(lv.probe || sql);
    got = r.length ? { columns: r[r.length - 1].columns, values: r[r.length - 1].values } : { columns: [], values: [] };
  } catch (e) {
    Engine.restore(snap);
    continue;
  }
  const v = Compare.check(lv, got, expect[id]);
  const kw = keywordCheck(lv, sql);
  if (v.ok && !kw) fail(id, `负例竟然通过了（${why}）：${sql}`);
  Engine.restore(snap);
}

/* ---------------------------------------------------------------- 报告 */
const byChapter = allChapters.map((ch) => {
  const n = ch.levels.length;
  const ok = ch.levels.filter((l) => expect[l.id]?.values?.length).length;
  return `  ${ch.title.padEnd(14, '　')} ${String(n).padStart(2)} 关   期望结果非空 ${ok}/${n}`;
}).join('\n');

console.log('关卡总数:', flat.length, `（基础 ${CHAPTERS.reduce((n,c)=>n+c.levels.length,0)} + 进阶 ${ADV_CHAPTERS.reduce((n,c)=>n+c.levels.length,0)}）`);
console.log(byChapter);
console.log('参考答案端到端通过:', pass, '/', flat.length);
console.log('');

if (warns.length) {
  console.log(`提示 ${warns.length} 条：`);
  warns.forEach((w) => console.log('  · ' + w));
  console.log('');
}

if (fails.length) {
  console.log(`失败 ${fails.length} 条：`);
  fails.forEach((f) => console.log('  ✗ ' + f));
  process.exit(1);
}
console.log('全部校验通过。');
