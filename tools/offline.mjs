/* ==========================================================================
   单文件版验证：file:// 双击打开、完全断网、功能完整
   --------------------------------------------------------------------------
   顺序讲究：先测编辑器功能，最后才跑关卡 —— 通关会触发「自动跳下一关」，
   中途切关会把编辑器内容换掉，干扰前面的断言。
   ========================================================================== */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = 'file://' + path.join(ROOT, 'dist/sql-quest.html');

const results = [];
const ok = (n, d = '') => results.push(['PASS', n, d]);
const bad = (n, d = '') => results.push(['FAIL', n, d]);

const b = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
const errs = [];
const external = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

// 断网：放行本地文件，其余一律拦下并记录
await ctx.route('**', (route) => {
  const u = route.request().url();
  if (u.startsWith('file://') || u.startsWith('data:')) return route.continue();
  external.push(u);
  return route.abort();
});

await p.goto(FILE, { waitUntil: 'load' });
await p.waitForSelector('#editor', { timeout: 25000 });
ok('file:// 双击打开，SQL 引擎加载成功');

const n = await p.locator('.level-item').count();
// 期望关卡数从题库动态取，加题后不用改这里
const exp = await p.evaluate(() => {
  const chs = [...(window.CHAPTERS || []), ...(window.ADV_CHAPTERS || [])];
  return chs.reduce((a, c) => a + c.levels.length, 0);
});
if (n === exp) ok(`关卡数 ${n}（基础 + 进阶）`);
else bad('关卡数异常', `实际 ${n}，期望 ${exp}`);


/* -------------------------------------------------- 1. 一键格式化 */
await p.locator('#editor').fill('select title,price from books where stock=0 order by price');
await p.locator('#btn-format').click();
await p.waitForTimeout(300);
const fmt = await p.locator('#editor').inputValue();
if (fmt.startsWith('SELECT') && fmt.includes('\n') && fmt.includes('ORDER BY')) {
  ok('单文件版格式化可用');
} else bad('单文件版格式化异常', JSON.stringify(fmt));

/* -------------------------------------------------- 2. 自动补全 */
await p.locator('#editor').fill('');
await p.locator('#editor').pressSequentially('SELECT * FROM bo', { delay: 20 });
await p.waitForTimeout(300);
const acOn = await p.locator('.autocomplete').isVisible();
const first = await p.locator('.autocomplete .ac-item.active .ac-label').innerText().catch(() => '');
const list = await p.locator('.autocomplete .ac-label').allInnerTexts();
if (acOn && first === 'books') ok('单文件版自动补全可用（FROM bo → books）', list.join(' / '));
else bad('单文件版补全异常', `visible=${acOn} first=${first} list=${list.join('/')}`);

// 表名. 限定也要能用
await p.locator('#editor').fill('');
await p.locator('#editor').pressSequentially('SELECT * FROM books b WHERE b.ti', { delay: 15 });
await p.waitForTimeout(300);
const q = await p.locator('.autocomplete .ac-item.active .ac-label').innerText().catch(() => '');
if (q === 'title') ok('单文件版别名限定补全可用（b.ti → title）');
else bad('单文件版限定补全异常', q);

await p.screenshot({ path: path.join(ROOT, 'qa/21-offline-ac.png') });

/* -------------------------------------------- 2b. 进阶关跨库答题 */
// 注意：这一步会切到校园库，必须放在补全测试之后 ——
// 否则 `FROM bo → books` 会因当前库没有 books 而失败
await p.keyboard.press('Escape');
await p.evaluate(() => document.querySelector('[data-level="a-8"]').click());
await p.waitForTimeout(350);
await p.locator('#editor').fill('SELECT s.id, s.name FROM students s WHERE NOT EXISTS (SELECT 1 FROM enrollments e WHERE e.student_id = s.id) ORDER BY s.id;');
await p.locator('#btn-run').click();
await p.waitForTimeout(400);
const advVerdict = await p.locator('#verdict').getAttribute('class');
const badge = await p.locator('#dataset-badge').innerText();
if (advVerdict.includes('ok') && badge === '校园选课库') ok('单文件版进阶关可跨库答题', badge);
else bad('单文件版进阶关失败', `${advVerdict} / ${badge}`);

/* -------------------------------------------------- 3. 答题与校验 */
await p.keyboard.press('Escape');
await p.locator('[data-level="7-4"]').click();
await p.waitForTimeout(200);
await p.locator('#editor').fill("SELECT o.order_date, SUM(oi.quantity * oi.unit_price) AS day_amount, SUM(SUM(oi.quantity * oi.unit_price)) OVER (ORDER BY o.order_date) AS running_total FROM orders o JOIN order_items oi ON oi.order_id = o.id WHERE o.status = '已完成' GROUP BY o.order_date ORDER BY o.order_date;");
await p.locator('#btn-run').click();
await p.waitForTimeout(450);
const v = await p.locator('#verdict').getAttribute('class');
if (v.includes('ok')) ok('断网状态下答题与校验正常');
else bad('答题失败', v);

/* ------------------------------- 4. 通关后编辑应取消自动跳关 */
// 此时 7-4 已通关，1.1 秒后本应自动跳到 8-1；立刻开始输入应当把它拦下来
const before = await p.locator('.level-kicker').innerText();
await p.locator('#editor').pressSequentially('SELECT 1', { delay: 30 });
await p.waitForTimeout(1400);
const after = await p.locator('.level-kicker').innerText();
if (before === after) ok('通关后开始编辑会取消自动跳关');
else bad('自动跳关未被编辑取消', `${before.trim()} → ${after.trim()}`);

await b.close();

/* ------------------------------------------------------------ 报告 */
const nPass = results.filter((r) => r[0] === 'PASS').length;
const nFail = results.filter((r) => r[0] === 'FAIL').length;
console.log('\n=== 单文件版离线验证 ===');
for (const [s, name, d] of results) {
  console.log(`${s === 'PASS' ? '  ✓' : '  ✗'} ${name}${d ? '  — ' + d : ''}`);
}
console.log(`\n通过 ${nPass} / 失败 ${nFail}`);
if (external.length) {
  console.log(`\n外部请求 ${external.length} 条（不该有）：`);
  [...new Set(external)].slice(0, 5).forEach((u) => console.log('  · ' + u));
} else console.log('零外部请求。');
if (errs.length) {
  console.log(`控制台错误 ${errs.length} 条：`);
  [...new Set(errs)].slice(0, 5).forEach((e) => console.log('  · ' + e.slice(0, 160)));
} else console.log('控制台无错误。');

process.exit(nFail || errs.length || external.length ? 1 : 0);
