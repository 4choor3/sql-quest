/* ==========================================================================
   浏览器端到端测试（playwright-core + 系统 Chrome，无需下载浏览器）
   --------------------------------------------------------------------------
   覆盖：加载、关卡切换、正确答案通关、错误答案拦截、提示/答案/重置、
         草稿持久化、进度条、表结构面板、移动端布局
   ========================================================================== */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL = process.env.URL || 'http://127.0.0.1:8123/';
const SHOTS = path.join(ROOT, 'qa');
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const ok = (n, d = '') => results.push(['PASS', n, d]);
const bad = (n, d = '') => results.push(['FAIL', n, d]);
const warn = (n, d = '') => results.push(['WARN', n, d]);

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

/* ------------------------------------------------------------ 1. 加载 */
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('#editor', { timeout: 20000 });
ok('页面加载并渲染编辑器');

const levelCount = await page.locator('.level-item').count();
const chapterCount = await page.locator('.chapter').count();
// 期望值直接从题库算，加题后不用回来改测试
const expected = await page.evaluate(() => {
  const chs = [...(window.CHAPTERS || []), ...(window.ADV_CHAPTERS || [])];
  return { levels: chs.reduce((n, c) => n + c.levels.length, 0), chapters: chs.length };
});
if (levelCount === expected.levels && chapterCount === expected.chapters)
  ok(`关卡列表：${chapterCount} 章 / ${levelCount} 关`);
else bad('关卡列表数量不符', `实际 ${chapterCount}章/${levelCount}关，期望 ${expected.chapters}章/${expected.levels}关`);

const TOTAL = expected.levels;
const totalText = await page.locator('#progress-num').innerText();
if (totalText.replace(/\s/g, '') === `0/${TOTAL}`) ok(`进度初始为 0/${TOTAL}`);
else bad('进度初始值不符', totalText);

/* ------------------------------------------------------- 2. 表结构面板 */
const tbls = await page.locator('.tbl').count();
if (tbls === 5) ok('表结构面板列出 5 张表');
else bad('表结构表数不符', String(tbls));

const rowCounts = await page.locator('.tbl-rows').allInnerTexts();
if (rowCounts.join(' ').includes('25 行')) ok('表行数统计正确（books 25 行）', rowCounts.join(' / '));
else bad('表行数统计异常', rowCounts.join(' / '));

/* --------------------------------------------- 2b. 右侧真实数据表格 */
// 1-1 这关只用 books，右栏应自动展开它（而非固定的第一张表）
const autoOpen = await page.locator('.tbl.open').evaluateAll((e) => e.map((x) => x.dataset.tbl));
if (autoOpen.length === 1 && autoOpen[0] === 'books') ok('右栏自动展开本关涉及的表（1-1 → books）');
else bad('右栏未跟随关卡展开', `[${autoOpen.join(', ')}]`);

if (await page.locator('.tbl.open table.grid').count()) ok('展开的表渲染出真实数据表格');
else bad('右侧未渲染数据表格');

// 逐张展开，检查几何：不出面板、单元格不塌陷、表头与数据列对齐
// 注意要连 authors 一起展开 —— 它默认不再展开，但几何检查要覆盖全部 5 张
for (const t of ['authors', 'books', 'customers', 'order_items', 'orders']) {
  const w = page.locator(`.tbl[data-tbl="${t}"]`);
  if (!(await w.evaluate((e) => e.classList.contains('open')))) {
    await w.locator('.tbl-head').click();
    await page.waitForTimeout(80);
  }
}
await page.waitForTimeout(250);

const geom = await page.evaluate(() => {
  const panel = document.querySelector('.schema-panel').getBoundingClientRect();
  const problems = [];
  let checked = 0;
  for (const wrap of document.querySelectorAll('.tbl')) {
    const name = wrap.dataset.tbl;
    const block = wrap.querySelector('.data-block');
    const rows = wrap.querySelectorAll('tbody tr').length;
    if (!block || !rows) { problems.push(`${name} 无数据`); continue; }
    checked++;
    if (block.getBoundingClientRect().right > panel.right + 0.5) problems.push(`${name} 溢出面板`);
    const zero = [...wrap.querySelectorAll('tbody td')].filter(
      (td) => td.getBoundingClientRect().width < 8
    ).length;
    if (zero) problems.push(`${name} 有 ${zero} 个零宽单元格`);
    const ths = [...wrap.querySelectorAll('thead th')].map((e) => Math.round(e.getBoundingClientRect().left));
    const tds = [...wrap.querySelectorAll('tbody tr:first-child td')].map((e) => Math.round(e.getBoundingClientRect().left));
    if (ths.join() !== tds.join()) problems.push(`${name} 表头与数据列错位`);
  }
  return { checked, problems };
});
if (geom.checked === 5 && !geom.problems.length) ok('5 张表数据渲染：无溢出 / 无塌陷 / 列对齐');
else bad('数据表格几何异常', geom.problems.join('; '));

// 列对齐：表头文字必须和它下面那列数据用同一种对齐、并落在同一条边缘上。
// 之前这里只比了单元格「盒子」的 left —— 盒子当然对得齐，但表头 left / 数据 right
// 时文字能差 50px+。所以必须比 Range 量出来的**文字**位置。
const alignResult = await page.evaluate(() => {
  const textRect = (el) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    return r.getBoundingClientRect();
  };
  const checkAlign = (root, label) => {
    const t = root.querySelector('table.grid');
    if (!t) return null;
    const first = t.querySelector('tbody tr');
    if (!first) return null;
    const ths = [...t.querySelectorAll('thead th')];
    const tds = [...first.querySelectorAll('td')];
    const bad = [];
    const kinds = [];
    ths.forEach((th, i) => {
      const td = tds[i];
      if (!td) return;
      const a = textRect(th), c = textRect(td);
      const align = getComputedStyle(td).textAlign;
      const delta = align === 'right' ? c.right - a.right : c.left - a.left;
      if (Math.abs(delta) > 1.5) bad.push(th.textContent.trim() + ' 差 ' + Math.round(delta) + 'px');
      kinds.push({ name: th.textContent.trim(), isNum: th.classList.contains('num'), align });
    });
    return { label, cols: ths.length, bad, kinds };
  };
  const out = [];
  const panel = document.querySelector('.tbl[data-tbl="books"]');
  if (panel) out.push(checkAlign(panel, '右栏预览'));
  const main = document.getElementById('work-inner');
  if (main) out.push(checkAlign(main, '主区结果'));
  return out.filter(Boolean);
});

const alignBad = alignResult.flatMap((r) => r.bad.map((b) => `${r.label}: ${b}`));
if (alignResult.length && !alignBad.length)
  ok('表格列对齐：表头与数据文字落在同一边缘', alignResult.map((r) => `${r.label} ${r.cols}列`).join(' / '));
else if (alignBad.length) bad('表格列对齐异常', alignBad.join('; '));
else warn('没找到可校验的表格');

// 数值列必须右对齐、文本列左对齐
const wrongAlign = alignResult.flatMap((r) =>
  r.kinds
    .filter((k) => (k.isNum && k.align !== 'right') || (!k.isNum && k.align === 'right'))
    .map((k) => `${r.label}:${k.name}`)
);
if (alignResult.length && !wrongAlign.length) ok('数值列右对齐、文本列左对齐');
else if (wrongAlign.length) bad('列对齐方式不对', wrongAlign.join('; '));

const wideScroll = await page.locator('.tbl[data-tbl="books"] .grid-scroll').evaluate(
  (e) => e.scrollWidth > e.clientWidth
);
if (wideScroll) ok('宽表（books 7 列）在预览块内横向滚动');
else warn('books 未触发横向滚动，可能列宽异常');

/* ------------------------------------------------ 2c. 放大浮层 */
await page.locator('.tbl[data-tbl="books"] [data-zoom]').click();
await page.waitForTimeout(300);
const modalShown = await page.locator('#modal').isVisible();
const modalTitle = await page.locator('.modal-title').innerText();
const modalRows = await page.locator('#modal tbody tr').count();
if (modalShown && modalTitle === 'books' && modalRows === 25) ok('放大浮层显示完整 25 行 books');
else bad('放大浮层异常', `${modalShown} / ${modalTitle} / ${modalRows} 行`);

await page.keyboard.press('Escape');
await page.waitForTimeout(250);
if (await page.locator('#modal').isHidden()) ok('Esc 可关闭浮层');
else bad('Esc 未关闭浮层');

/* ------------------------------------- 2d. DML 执行后右侧数据实时联动 */
// 注意：这一项会改动数据库并推进关卡进度，必须放在最后跑，
// 否则会污染上面「进度初始」「刷新后进度保留」等断言。
async function testDmlLiveSync() {
  // 前面跑过一堆关卡，当前状态（含自动跳关定时器）不确定。
  // 直接刷新页面回到干净起点，再走一遍完整路径 —— 这样这一步不依赖前序状态。
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#editor', { timeout: 25000 });
  await page.waitForTimeout(300);

  await page.locator('[data-level="8-1"]').click();
  await page.waitForTimeout(400);

  // 8-1 操作 authors，右栏应已自动切到它
  const opened = await page.locator('.tbl.open').evaluateAll((e) => e.map((x) => x.dataset.tbl));
  if (opened.length === 1 && opened[0] === 'authors') ok('切关后右栏跟随切换（8-1 → authors）');
  else bad('切关后右栏未跟随', `[${opened.join(', ')}]`);

  await page.locator('#editor').fill("INSERT INTO authors (id, name, country, birth_year) VALUES (99, '弗兰茨·卡夫卡', '奥地利', 1883);");
  await page.locator('#btn-run').click();
  await page.waitForTimeout(350);
  const label = await page.locator('.tbl[data-tbl="authors"] .tbl-rows').innerText();
  const rows = await page.locator('.tbl[data-tbl="authors"] tbody tr').count();
  if (label === '9 行' && rows === 9) ok('DML 执行后右侧行数与数据实时更新（8 → 9 行）');
  else bad('DML 后右侧未联动', `${label} / 预览 ${rows} 行`);

  // 顺手验证跨数据集：切到进阶关，右栏应换成校园库
  await page.locator('[data-level="a-1"]').click();
  await page.waitForTimeout(400);
  const advTables = await page.locator('.tbl').evaluateAll((e) => e.map((x) => x.dataset.tbl));
  const badge = await page.locator('#dataset-badge').innerText();
  if (advTables.includes('courses') && badge === '校园选课库')
    ok('跨数据集切换：进阶关右栏换成校园库', `[${advTables.join(', ')}]`);
  else bad('跨数据集切换失败', `${badge} / [${advTables.join(', ')}]`);
}

/* -------------------------------------------------------- 3. 答题流程 */
async function gotoLevel(id) {
  // 收掉可能挡路的浮层
  await page.evaluate(() => {
    for (const sel of ['#modal', '#settings']) {
      const el = document.querySelector(sel);
      if (el) el.hidden = true;
    }
    const ac = document.querySelector('.autocomplete');
    if (ac) ac.hidden = true;
  });

  // 关键：每次 open() 都会 renderLevels() 重建整个列表，
  // 所以不能在循环外持有 locator —— 必须每轮重新查。
  // 另外章节标题是 sticky 的，可能盖住列表顶部，因此滚动后再确认一次。
  for (let attempt = 0; attempt < 3; attempt++) {
    const item = page.locator(`[data-level="${id}"]`);
    await item.scrollIntoViewIfNeeded();
    await page.waitForTimeout(30);
    const onclick = await page.evaluate((lid) => {
      const el = document.querySelector(`[data-level="${lid}"]`);
      if (!el) return 'missing';
      // 用元素中心点上真正命中的是谁，判断有没有被遮挡
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (hit && (hit === el || el.contains(hit))) { el.click(); return 'ok'; }
      return 'covered';
    }, id);
    if (onclick === 'ok') break;

    const active = await page.locator('.level-item.active .level-name').innerText().catch(() => '?');
    if (attempt === 2) throw new Error(`gotoLevel(${id}) 失败（${onclick}）：当前停在「${active}」`);
    // 被遮住就往上滚一点再试
    await page.locator('.levels-scroll').evaluate((e) => { e.scrollTop -= 40; });
    await page.waitForTimeout(60);
  }

  try {
    await page.waitForFunction(
      (lid) => {
        const el = document.querySelector(`[data-level="${lid}"]`);
        return el && el.classList.contains('active');
      },
      id,
      { timeout: 8000 }
    );
  } catch {
    const active = await page.locator('.level-item.active .level-name').innerText().catch(() => '?');
    const diag = await page.evaluate(() => ({
      ds: window.Engine ? Engine.dataset : '?',
      cur: window.App && App.current ? App.current.id : '?',
      flat: window.App ? App.flat.length : '?',
      badge: document.getElementById('dataset-badge')?.textContent,
      tbls: [...document.querySelectorAll('.tbl')].map((e) => e.dataset.tbl).join(','),
    }));
    throw new Error(`gotoLevel(${id}) 切关超时：当前停在「${active}」\n` +
      `  诊断: ${JSON.stringify(diag)}\n  页面错误: ${errors.slice(-3).join(" | ") || "（无）"}}`);
  }
  await page.waitForTimeout(60);
}

async function setSql(sql) {
  await page.locator('#editor').fill(sql);
}
async function runSql() {
  await page.locator('#btn-run').click();
  await page.waitForTimeout(200);
}
const verdictClass = () => page.locator('#verdict').getAttribute('class');

// 3.1 错误答案 → 拦截
await gotoLevel('1-1');
await setSql('SELECT title FROM books;');
await runSql();
let vc = await verdictClass();
if (vc.includes('err')) ok('错误答案被拦截（少一列）');
else bad('错误答案未被拦截', vc);

const diffShown = await page.locator('#diff-block').evaluate((e) => e.classList.contains('show'));
if (diffShown) ok('错误时展示差异对比');
else warn('错误时未展示差异块（可能列名不符路径）');

// 3.2 正确答案 → 通关
await setSql('SELECT title, price FROM books;');
await runSql();
vc = await verdictClass();
if (vc.includes('ok')) ok('正确答案判定通关');
else bad('正确答案未通关', vc);

// 结果表本身也要检查：不能有大片留白，表头与数据文字必须对齐
const tblCheck = await page.evaluate(() => {
  const t = document.querySelector('#work-inner table.grid');
  if (!t) return null;
  const wrap = t.closest('.table-wrap');
  const ths = [...t.querySelectorAll('thead th')];
  const real = ths
    .filter((x) => !x.classList.contains('fill'))
    .reduce((n, x) => n + x.getBoundingClientRect().width, 0);
  const textRect = (el) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    return r.getBoundingClientRect();
  };
  const tds = [...t.querySelector('tbody tr').querySelectorAll('td')];
  let worst = 0;
  ths.forEach((th, i) => {
    if (!tds[i]) return;
    const a = textRect(th), c = textRect(tds[i]);
    const align = getComputedStyle(tds[i]).textAlign;
    worst = Math.max(worst, Math.abs(align === 'right' ? c.right - a.right : c.left - a.left));
  });
  return { pct: Math.round((real / wrap.clientWidth) * 100), worst: Math.round(worst), cols: ths.length };
});
if (!tblCheck) bad('结果表未渲染');
else {
  if (tblCheck.pct >= 80) ok('结果表铺满容器宽度（无大片留白）', `${tblCheck.pct}%`);
  else bad('结果表右侧留白过多', `真实列仅占 ${tblCheck.pct}%`);
  if (tblCheck.worst <= 1) ok('结果表表头与数据文字对齐', `${tblCheck.cols} 列，最大偏差 ${tblCheck.worst}px`);
  else bad('结果表列错位', `最大偏差 ${tblCheck.worst}px`);
}

const dotDone = await page.locator('[data-level="1-1"]').evaluate((e) => e.classList.contains('done'));
if (dotDone) ok('左侧关卡标记为已完成');
else bad('左侧关卡未标记完成');

const prog = await page.locator('#progress-num').innerText();
if (prog.replace(/\s/g, '') === `1/${TOTAL}`) ok(`进度更新为 1/${TOTAL}`);
else bad('进度未更新', prog);

// 3.3 自动跳下一关
await page.waitForTimeout(1400);
const curTitle = await page.locator('.level-title').innerText();
if (curTitle.includes('只要前 5 行')) ok('通关后自动进入下一关');
else warn('未自动跳转下一关', curTitle);

/* -------------------------------------------- 4. 关键字约束（防硬编码） */
await gotoLevel('1-2');
await setSql('SELECT id, title FROM books LIMIT 5;'); // 缺 ORDER BY
await runSql();
vc = await verdictClass();
if (vc.includes('err')) ok('缺少 ORDER BY 时被约束拦截');
else bad('关键字约束失效（1-2 缺 ORDER BY 竟通过）', vc);

/* ------------------------------------------------- 5. 提示 / 参考答案 */
await gotoLevel('1-3');
const hintBtn = page.locator('#btn-hint');
if (await hintBtn.count()) {
  const before = await page.locator('#hint-box').evaluate((e) => e.classList.contains('show'));
  await hintBtn.click();
  await page.waitForTimeout(100);
  const after = await page.locator('#hint-box').evaluate((e) => e.classList.contains('show'));
  if (!before && after) ok('提示按钮可展开提示');
  else bad('提示按钮无效', `${before} -> ${after}`);
} else bad('1-3 应有提示按钮但未渲染');

await page.locator('#btn-answer').click();
await page.waitForTimeout(100);
const refOpen = await page.locator('#ref-answer').evaluate((e) => e.open);
if (refOpen) ok('参考答案可展开');
else bad('参考答案未展开');

/* ------------------------------------------------------- 6. 重置本关 */
await setSql('SELECT 1;');
await page.locator('#btn-reset').click();
await page.waitForTimeout(100);
const resetVal = await page.locator('#editor').inputValue();
if (resetVal.trim() === 'SELECT title, price FROM books') ok('重置本关恢复起始代码');
else bad('重置本关异常', JSON.stringify(resetVal));

/* ------------------------------------------------ 7. 草稿持久化（刷新） */
await setSql('SELECT title, price FROM books WHERE price > 60; -- draft-marker');
await page.waitForTimeout(350);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('#editor', { timeout: 20000 });
const afterReload = await page.locator('#editor').inputValue();
if (afterReload.includes('draft-marker')) ok('刷新后草稿与进度保留');
else bad('草稿未持久化', afterReload.slice(0, 60));

const progAfter = await page.locator('#progress-num').innerText();
// 本脚本此时只通关了 1-1 一关
if (progAfter.replace(/\s/g, '') === `1/${TOTAL}`) ok('刷新后进度保留', progAfter.replace(/\s/g, ''));
else bad('刷新后进度丢失', progAfter);

/* ------------------------------------------------ 8. 各章抽样通关验证 */
const samples = [
  ['2-5', 'SELECT name, city FROM customers WHERE city IS NULL;'],
  ['3-5', "SELECT genre, COUNT(*) AS book_count FROM books GROUP BY genre HAVING COUNT(*) > 2;"],
  ['4-3', 'SELECT c.name, COUNT(o.id) AS order_count FROM customers c LEFT JOIN orders o ON o.customer_id = c.id GROUP BY c.id, c.name ORDER BY c.id;'],
  ['5-3', "SELECT c.name FROM customers c WHERE EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id AND o.status = '已完成');"],
  ['6-5', "SELECT title, price, CASE WHEN price >= 70 THEN '昂贵' WHEN price >= 45 THEN '适中' ELSE '便宜' END AS tier FROM books ORDER BY id;"],
  ['7-4', "SELECT o.order_date, SUM(oi.quantity * oi.unit_price) AS day_amount, SUM(SUM(oi.quantity * oi.unit_price)) OVER (ORDER BY o.order_date) AS running_total FROM orders o JOIN order_items oi ON oi.order_id = o.id WHERE o.status = '已完成' GROUP BY o.order_date ORDER BY o.order_date;"],
  // 进阶关（校园选课库）—— 顺带验证跨数据集切库后答题正常
  ['a-1', 'SELECT c.code, c.name, d.name AS dept_name, t.name AS teacher_name FROM courses c JOIN departments d ON d.id = c.dept_id JOIN teachers t ON t.id = c.teacher_id ORDER BY c.code;'],
  ['a-4', 'SELECT c.name, p.name AS prereq_name FROM courses c JOIN courses p ON p.id = c.prereq_id ORDER BY c.code;'],
  ['a-8', 'SELECT s.id, s.name FROM students s WHERE NOT EXISTS (SELECT 1 FROM enrollments e WHERE e.student_id = s.id) ORDER BY s.id;'],
  ['a-10', 'WITH RECURSIVE chain AS (SELECT id, code, name, prereq_id, 1 AS lvl FROM courses WHERE prereq_id IS NULL UNION ALL SELECT c.id, c.code, c.name, c.prereq_id, ch.lvl + 1 FROM courses c JOIN chain ch ON ch.id = c.prereq_id) SELECT code, name, lvl FROM chain ORDER BY lvl, code;'],
];
for (const [id, sql] of samples) {
  await gotoLevel(id);
  // 跨数据集切关时右栏会重建，等它稳定再答题
  await page.waitForTimeout(120);
  await setSql(sql);
  await runSql();
  const v = await verdictClass();
  if (v.includes('ok')) ok(`关卡 ${id} 参考答案在浏览器中通关`);
  else {
    const reason = await page.locator('#verdict').innerText();
    bad(`关卡 ${id} 未通关`, reason.replace(/\n/g, ' ').slice(0, 140));
  }
}

/* ---------------------------------------------------- 9. DML 幂等性 */
// 上一段抽样跨了两套数据集且会触发自动跳关，累积状态复杂。
// 这里先刷新回到干净起点再继续 —— 让每一步自包含，避免测试之间互相污染。
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('#editor', { timeout: 25000 });
await page.waitForTimeout(300);

await gotoLevel('8-1');
await setSql("INSERT INTO authors (id, name, country, birth_year) VALUES (99, '弗兰茨·卡夫卡', '奥地利', 1883);");
await runSql();
let v8 = await verdictClass();
if (v8.includes('ok')) ok('DML 8-1 首次执行通关');
else bad('DML 8-1 未通关', await page.locator('#verdict').innerText());

// 再点一次运行 —— 幂等性检查（不应报 UNIQUE 冲突）
await runSql();
v8 = await verdictClass();
if (v8.includes('ok')) ok('DML 8-1 重复运行仍通过（快照回滚生效）');
else bad('DML 重复运行失败（幂等性缺陷）', await page.locator('#verdict').innerText());

/* ------------------------------------------------- 10. 键盘快捷键 */
await gotoLevel('1-1');
await setSql('SELECT title, price FROM books;');
await page.locator('#editor').focus();
await page.keyboard.press('Meta+Enter');
await page.waitForTimeout(250);
const vKey = await verdictClass();
if (vKey.includes('ok')) ok('⌘+Enter 快捷键可运行');
else bad('快捷键运行失效', vKey);

/* ------------------------------------------------ 11. 移动端响应式 */
const m = await ctx.newPage();
await m.setViewportSize({ width: 390, height: 844 });
await m.goto(URL, { waitUntil: 'networkidle' });
await m.waitForSelector('#editor', { timeout: 20000 });
const tabsVisible = await m.locator('.mobile-tabs').isVisible();
if (tabsVisible) ok('窄屏显示移动端标签栏');
else bad('窄屏未显示移动端标签栏');

await m.locator('.mobile-tabs button[data-tab="schema"]').click();
await m.waitForTimeout(150);
const schemaVisible = await m.locator('.schema-panel').isVisible();
if (schemaVisible) ok('移动端可切换到表结构');
else bad('移动端切换失败');

const hasHScroll = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
if (!hasHScroll) ok('移动端无横向溢出');
else bad('移动端存在横向滚动');
await m.close();

// 会改动数据、推进进度的一项放到最后（见 2d 注释）
await testDmlLiveSync();

/* -------------------------------------------------------- 12. 截图 */
await page.setViewportSize({ width: 1440, height: 900 });
await gotoLevel('1-4');
await setSql('SELECT title, price FROM books ORDER BY price DESC;');
await runSql();
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(SHOTS, '01-main.png') });

await gotoLevel('4-3');
await setSql('SELECT c.name, COUNT(*) AS order_count FROM customers c LEFT JOIN orders o ON o.customer_id = c.id GROUP BY c.id;');
await runSql();
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(SHOTS, '02-wrong.png') });

await gotoLevel('7-4');
await setSql(samples[5][1]);
await runSql();
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(SHOTS, '03-window.png') });

const mp = await ctx.newPage();
await mp.setViewportSize({ width: 390, height: 844 });
await mp.goto(URL, { waitUntil: 'networkidle' });
await mp.waitForSelector('#editor', { timeout: 20000 });
await mp.screenshot({ path: path.join(SHOTS, '04-mobile.png') });
await mp.close();

await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('#editor', { timeout: 20000 });
await page.screenshot({ path: path.join(SHOTS, '05-fresh.png') });

/* ------------------------------------------------------------ 报告 */
await browser.close();

const nPass = results.filter((r) => r[0] === 'PASS').length;
const nFail = results.filter((r) => r[0] === 'FAIL').length;
const nWarn = results.filter((r) => r[0] === 'WARN').length;

console.log('\n=== 浏览器端到端测试 ===');
for (const [s, n, d] of results) {
  const mark = s === 'PASS' ? '  ✓' : s === 'FAIL' ? '  ✗' : '  !';
  console.log(`${mark} ${n}${d ? '  — ' + d : ''}`);
}
console.log(`\n通过 ${nPass} / 失败 ${nFail} / 提示 ${nWarn}`);
if (errors.length) {
  console.log(`\n控制台错误 ${errors.length} 条：`);
  [...new Set(errors)].slice(0, 10).forEach((e) => console.log('  · ' + e.slice(0, 200)));
} else {
  console.log('控制台无错误。');
}
process.exit(nFail ? 1 : 0);
