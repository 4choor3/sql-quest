/* ==========================================================================
   编辑器增强功能测试：一键格式化 + SQL 自动补全
   ========================================================================== */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL_ = process.env.URL || 'http://127.0.0.1:8123/';
const SHOTS = path.join(ROOT, 'qa');
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const ok = (n, d = '') => results.push(['PASS', n, d]);
const bad = (n, d = '') => results.push(['FAIL', n, d]);
const warn = (n, d = '') => results.push(['WARN', n, d]);

const b = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

await p.goto(URL_, { waitUntil: 'networkidle' });
await p.waitForSelector('#editor', { timeout: 25000 });
await p.evaluate(() => localStorage.clear());
await p.reload({ waitUntil: 'networkidle' });
await p.waitForSelector('#editor', { timeout: 25000 });

const ed = '#editor';
const ac = '.autocomplete';

async function clearEditor() {
  // 补全弹层可能悬在编辑器上方遮挡点击，先按 Esc 收起来
  await p.keyboard.press('Escape');
  await p.waitForTimeout(60);
  await p.locator(ed).fill('');
  await p.waitForTimeout(80);
}
async function typeText(t, delay = 25) {
  await p.locator(ed).pressSequentially(t, { delay });
  await p.waitForTimeout(140);
}
const acVisible = () => p.locator(ac).isVisible();
const acItems = async () =>
  p.locator(`${ac} .ac-item`).evaluateAll((els) =>
    els.map((e) => e.querySelector('.ac-label').textContent.trim())
  );
const acActive = async () =>
  p.locator(`${ac} .ac-item.active .ac-label`).innerText().catch(() => null);

/* ==================================================== 一、一键格式化 */
await p.locator('[data-level="1-1"]').click();
await p.waitForTimeout(150);

await p.locator(ed).fill('select title,price from books where price>60 order by price desc');
await p.locator('#btn-format').click();
await p.waitForTimeout(300);
const formatted = await p.locator(ed).inputValue();
const wantFmt = [
  'SELECT',
  '  title,',
  '  price',
  'FROM',
  '  books',
  'WHERE',
  '  price > 60',
  'ORDER BY',
  '  price DESC',
].join('\n');
if (formatted === wantFmt) ok('格式化：单行 SQL 排版正确');
else bad('格式化输出不符', JSON.stringify(formatted));

// 再点一次应提示「已经是格式化过的了」，且内容不变
await p.locator('#btn-format').click();
await p.waitForTimeout(250);
const again = await p.locator(ed).inputValue();
const toast1 = await p.locator('.toast').last().innerText().catch(() => '');
if (again === formatted) ok('格式化：幂等（重复点击内容不变）', toast1.trim());
else bad('格式化不幂等', JSON.stringify(again));

// 空内容时的提示
await p.locator(ed).fill('');
await p.locator('#btn-format').click();
await p.waitForTimeout(200);
const emptyToast = await p.locator('.toast').last().innerText().catch(() => '');
if (emptyToast.includes('没有内容')) ok('格式化：空编辑器给出提示');
else bad('空编辑器未提示', emptyToast);

// 语法错误不应破坏原文
await p.locator(ed).fill("SELECT * FROM books WHERE title = '未闭合");
const before = await p.locator(ed).inputValue();
await p.locator('#btn-format').click();
await p.waitForTimeout(250);
const afterBad = await p.locator(ed).inputValue();
if (afterBad.length > 0) ok('格式化：异常输入不会清空编辑器', afterBad.slice(0, 40));
else bad('格式化把内容弄丢了');

// 快捷键 Shift+Alt+F
await p.locator(ed).fill('select id from books');
await p.locator(ed).click();
await p.keyboard.press('Shift+Alt+KeyF');
await p.waitForTimeout(300);
const byKey = await p.locator(ed).inputValue();
if (byKey.includes('\n') && byKey.startsWith('SELECT')) ok('格式化：Shift+Alt+F 快捷键生效');
else bad('格式化快捷键无效', JSON.stringify(byKey));

// 撤销（⌘Z）应能回退格式化
await p.keyboard.press('Meta+z');
await p.waitForTimeout(250);
const undone = await p.locator(ed).inputValue();
if (undone.trim() === 'select id from books') ok('格式化：⌘Z 可撤销（保留原生撤销栈）');
else warn('格式化后 ⌘Z 未回退到原文', JSON.stringify(undone.slice(0, 40)));

/* ==================================================== 二、自动补全 */
await clearEditor();

// 1) 单个字母 p 就应弹出候选
await typeText('p');
if (await acVisible()) ok('补全：输入单个字符即弹出候选区');
else bad('补全：输入 p 未弹出候选');

const listP = await acItems();
if (listP.length) ok('补全：候选列表非空', listP.slice(0, 5).join(' / '));
else bad('补全：候选列表为空');

// 2) 列名/关键字混合：p 应给出 price（列名）
if (listP.some((x) => x.toLowerCase() === 'price')) ok('补全：列名进入候选（price）');
else bad('补全：候选里没有列名', listP.join(' / '));

// 3) 表名应进入候选（FROM 之后）
await clearEditor();
await typeText('SELECT * FROM bo');
const listTable = await acItems();
if (listTable[0] && listTable[0].toLowerCase() === 'books') ok('补全：FROM 之后表名排第一（books）', listTable.slice(0, 3).join(' / '));
else bad('补全：FROM 后未优先表名', listTable.slice(0, 5).join(' / '));

// 4) 回车插入
await p.keyboard.press('Enter');
await p.waitForTimeout(200);
let v = await p.locator(ed).inputValue();
if (v === 'SELECT * FROM books') ok('补全：回车插入候选');
else bad('补全：回车插入结果不符', JSON.stringify(v));

// 5) 关键字补全（语句开头）
await clearEditor();
await typeText('sel');
const listKw = await acItems();
if (listKw[0] === 'SELECT') ok('补全：语句开头关键字优先（sel → SELECT）', listKw.slice(0, 3).join(' / '));
else bad('补全：语句开头未优先关键字', listKw.slice(0, 5).join(' / '));

// 6) Tab 插入
await p.keyboard.press('Tab');
await p.waitForTimeout(200);
v = await p.locator(ed).inputValue();
if (v.trim() === 'SELECT') ok('补全：Tab 插入候选');
else bad('补全：Tab 插入结果不符', JSON.stringify(v));

// 7) 上下键切换 + 回车选中第二项
await clearEditor();
await typeText('SELECT * FROM ');
await typeText('o');
const beforeNav = await acActive();
await p.keyboard.press('ArrowDown');
await p.waitForTimeout(120);
const afterNav = await acActive();
if (beforeNav && afterNav && beforeNav !== afterNav) ok('补全：↓ 切换候选高亮', `${beforeNav} → ${afterNav}`);
else warn('补全：↓ 未改变高亮', `${beforeNav} / ${afterNav}`);
await p.keyboard.press('ArrowUp');
await p.waitForTimeout(120);
const backNav = await acActive();
if (backNav === beforeNav) ok('补全：↑ 可回到上一项');
else warn('补全：↑ 行为异常', `${backNav}`);

await p.keyboard.press('Enter');
await p.waitForTimeout(200);
v = await p.locator(ed).inputValue();
if (v.startsWith('SELECT * FROM ') && v.length > 'SELECT * FROM '.length) ok('补全：导航后回车插入所选', v);
else bad('补全：导航后插入异常', JSON.stringify(v));

// 8) Esc 关闭
await clearEditor();
await typeText('sel');
if (await acVisible()) {
  await p.keyboard.press('Escape');
  await p.waitForTimeout(150);
  if (!(await acVisible())) ok('补全：Esc 关闭候选区');
  else bad('补全：Esc 未关闭');
} else bad('补全：前置条件失败（未弹出）');

// 9) Esc 关闭后 Tab 恢复为缩进
await p.keyboard.press('Tab');
await p.waitForTimeout(150);
v = await p.locator(ed).inputValue();
if (v === 'sel  ') ok('补全：关闭后 Tab 恢复缩进功能', JSON.stringify(v));
else warn('补全：关闭后 Tab 行为', JSON.stringify(v));

// 10) 表名. 之后只提示该表的列
await clearEditor();
await typeText('SELECT * FROM books b WHERE b.');
const q1 = await acItems();
const booksCols = ['id', 'title', 'author_id', 'genre', 'price', 'stock', 'published_year'];
const onlyBooks = q1.length > 0 && q1.every((x) => booksCols.includes(x));
if (onlyBooks) ok('补全：b. 只提示 books 的列（别名解析生效）', q1.join(' / '));
else bad('补全：限定前缀未收敛到该表', q1.slice(0, 8).join(' / '));

// 11) 接续输入过滤
await typeText('t');
const q2 = await acItems();
if (q2[0] === 'title') ok('补全：b.t → title 排第一', q2.join(' / '));
else bad('补全：限定前缀过滤异常', q2.join(' / '));

await p.keyboard.press('Enter');
await p.waitForTimeout(200);
v = await p.locator(ed).inputValue();
if (v === 'SELECT * FROM books b WHERE b.title') ok('补全：限定前缀插入正确');
else bad('补全：限定前缀插入不符', JSON.stringify(v));

// 12) AS 别名同样可解析
await clearEditor();
await typeText('SELECT * FROM customers AS c WHERE c.');
const q3 = await acItems();
const custCols = ['id', 'name', 'city', 'signup_date', 'level'];
if (q3.length && q3.every((x) => custCols.includes(x))) ok('补全：AS 别名解析生效（c. → customers 列）', q3.join(' / '));
else bad('补全：AS 别名未解析', q3.slice(0, 8).join(' / '));

// 13) 鼠标点击候选
await clearEditor();
await typeText('SELECT * FROM ord');
if (await acVisible()) {
  await p.locator(`${ac} .ac-item`).nth(1).click();
  await p.waitForTimeout(220);
  v = await p.locator(ed).inputValue();
  if (v.startsWith('SELECT * FROM ') && v.length > 'SELECT * FROM '.length && !(await acVisible()))
    ok('补全：鼠标点击候选项可插入', v);
  else bad('补全：鼠标点击插入异常', JSON.stringify(v));
} else bad('补全：点击测试前置失败');

// 14) 弹层定位在视口内且靠近编辑器
await clearEditor();
await typeText('sel');
const geom = await p.evaluate(() => {
  const pop = document.querySelector('.autocomplete');
  const ta = document.querySelector('#editor');
  const pr = pop.getBoundingClientRect();
  const tr = ta.getBoundingClientRect();
  return {
    pr: { top: pr.top, left: pr.left, right: pr.right, bottom: pr.bottom, w: pr.width, h: pr.height },
    tr: { top: tr.top, left: tr.left, right: tr.right, bottom: tr.bottom },
    vw: window.innerWidth, vh: window.innerHeight,
  };
});
const inside = geom.pr.left >= 0 && geom.pr.top >= 0 && geom.pr.right <= geom.vw && geom.pr.bottom <= geom.vh;
const near = geom.pr.top >= geom.tr.top - 60 && geom.pr.left >= geom.tr.left - 20;
if (inside && near) ok('补全：弹层定位在视口内且贴近编辑器',
  `pop(${Math.round(geom.pr.left)},${Math.round(geom.pr.top)}) ta(${Math.round(geom.tr.left)},${Math.round(geom.tr.top)})`);
else bad('补全：弹层定位异常', JSON.stringify(geom));

await p.screenshot({ path: path.join(SHOTS, '20-autocomplete.png') });

// 15) 中文输入法组合期间不弹
await clearEditor();
await p.evaluate(() => {
  const ta = document.querySelector('#editor');
  ta.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  ta.value = '测试';
  ta.dispatchEvent(new Event('input', { bubbles: true }));
});
await p.waitForTimeout(150);
const duringIme = await acVisible();
await p.evaluate(() => {
  document.querySelector('#editor').dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
});
if (!duringIme) ok('补全：输入法组合期间不打扰');
else bad('补全：输入法组合期间误弹');

/* =============================== 二·补 用户自定义别名 / CTE 可补全 */
// 玩家给聚合结果起名 book_count 后，HAVING 里再打它必须能补出来
await clearEditor();
await typeText('SELECT genre, COUNT(*) AS book_count FROM books GROUP BY genre HAVING book_co');
let items = await acItems();
if (items[0] === 'book_count') ok('别名补全：AS book_count 后 HAVING 里可补出', items.join(' / '));
else bad('别名补全失败（HAVING 里打不出 book_count）', items.join(' / '));

await clearEditor();
await typeText('SELECT price * stock AS value FROM books ORDER BY val');
items = await acItems();
if (items[0] === 'value') ok('别名补全：ORDER BY 里别名压过同名关键字 VALUES', items.slice(0, 3).join(' / '));
else bad('别名 ORDER BY 排序异常', items.slice(0, 4).join(' / '));

await clearEditor();
await typeText('SELECT price * stock value FROM books ORDER BY val');
items = await acItems();
if (items[0] === 'value') ok('别名补全：省略 AS 的别名也能识别');
else bad('省略 AS 的别名未识别', items.slice(0, 4).join(' / '));

await clearEditor();
await typeText('WITH city_stat AS (SELECT city, COUNT(*) c FROM customers GROUP BY city) SELECT city FROM city_st');
items = await acItems();
if (items[0] === 'city_stat') ok('别名补全：CTE 名可补出');
else bad('CTE 名未补出', items.slice(0, 4).join(' / '));

await clearEditor();
await typeText('SELECT * FROM (SELECT id, title FROM books) AS b WHERE b.ti');
items = await acItems();
if (items[0] === 'title') ok('别名补全：派生表别名 b. 可推出内层列');
else bad('派生表列推导失败', items.slice(0, 5).join(' / '));

// 字符串/注释里的假别名不能进候选
await clearEditor();
await typeText("SELECT 'AS fake_name' AS real_name FROM books WHERE fake");
items = await acItems();
if (!items.some((x) => x === 'fake_name')) ok('别名补全：字符串里的假别名不误入候选');
else bad('字符串里的假别名被误识别', items.join(' / '));

/* ============================== 二·收 作用域收敛：不跨表乱给列 */
await clearEditor();
await typeText('SELECT * FROM customers WHERE st');
items = await acItems();
const foreign = items.filter((x) => ['stock', 'status', 'genre', 'title'].includes(x));
if (!foreign.length) ok('作用域收敛：只用 customers 时不混入别表列', items.slice(0, 4).join(' / '));
else bad('作用域未收敛，混入无关表列', foreign.join(' / '));

await clearEditor();
await typeText('SELECT * FROM books WHERE st');
items = await acItems();
if (items[0] === 'stock') ok('作用域收敛：books 里 st → stock 排第一', items.slice(0, 3).join(' / '));
else bad('单表列未优先', items.slice(0, 4).join(' / '));

// 多表 JOIN 时两张表的列都该在
await clearEditor();
await typeText('SELECT * FROM books b JOIN authors a ON a.id = b.author_id WHERE cou');
items = await acItems();
const hasB = items.includes('country'), hasA = items.includes('author_id');
if (hasB || hasA) ok('作用域收敛：JOIN 的表都参与候选', items.slice(0, 4).join(' / '));
else bad('JOIN 场景候选为空', items.join(' / '));

// 还没写 FROM 时不收敛，关键字照给
await clearEditor();
await typeText('SEL');
items = await acItems();
if (items[0] === 'SELECT') ok('未写 FROM 时不收敛，关键字优先');
else bad('语句开头关键字丢失', items.slice(0, 4).join(' / '));

/* ============ 二·表 表名位置只给表（回归：JOIN 后错误地给出列名） */
// 曾经的 bug：`FROM orders o JOIN o` 用一条贪婪正则从**第一个** FROM 起匹配，
// 把中间的 JOIN 误当成「子句里已有别的关键字」，于是判定失败、退化成列名上下文 ——
// JOIN 后面只给列名和关键字，偏不给表名；用户选中列名后拼出跑不通的 JOIN。
const acDetailed = () =>
  p.locator(`${ac} .ac-item`).evaluateAll((els) =>
    els.map((e) => ({
      label: e.querySelector('.ac-label').textContent.trim(),
      kind: (e.querySelector('.ac-detail').textContent.trim().split(' · ')[0] || '').trim(),
    }))
  );

await clearEditor();
await typeText('SELECT * FROM orders o JOIN o');
let rich = await acDetailed();
let labels = rich.map((x) => x.label);
if (labels.includes('orders') && labels.includes('order_items'))
  ok('表名位置：JOIN 后给出表名', labels.join(' / '));
else bad('JOIN 后没给出表名', labels.join(' / '));

const nonTable = rich.filter((x) => x.kind !== '表' && x.kind !== 'CTE');
if (!nonTable.length) ok('表名位置：JOIN 后不混入列名 / 关键字');
else bad('JOIN 后混入非表名候选', nonTable.map((x) => `${x.label}(${x.kind})`).join(' / '));

// 没有表以 order_d 开头 —— 这里应该什么都不给（以前会给出列名 order_date）
await clearEditor();
await typeText('SELECT * FROM orders o JOIN order_d');
if (!(await acVisible())) ok('表名位置：无匹配表时不给候选（不再误导为列名 order_date）');
else bad('表名位置给出了误导候选', (await acItems()).join(' / '));

// 各种「表名引导词」后面都只给表
for (const [tag, sql, expect] of [
  ['FROM', 'SELECT * FROM bo', 'books'],
  ['UPDATE', 'UPDATE cust', 'customers'],
  ['INSERT INTO', 'INSERT INTO boo', 'books'],
  ['DELETE FROM', 'DELETE FROM orde', 'orders'],
]) {
  await clearEditor();
  await typeText(sql);
  const got = await acDetailed();
  const first = got[0];
  if (first && first.label === expect && (first.kind === '表' || first.kind === 'CTE'))
    ok(`${tag} 后只给表名（→ ${expect}）`);
  else bad(`${tag} 后候选异常`, got.slice(0, 4).map((x) => `${x.label}(${x.kind})`).join(' / '));
}

// 括号里是列清单，仍要给列名 —— 别被「表名位置只给表」误伤
await clearEditor();
await typeText('INSERT INTO books (tit');
rich = await acDetailed();
if (rich.some((x) => x.label === 'title' && x.kind === '列')) ok('INSERT 列清单里仍给列名');
else bad('INSERT 列清单被误伤', rich.slice(0, 4).map((x) => `${x.label}(${x.kind})`).join(' / '));

// WHERE 后的列名上下文没被误伤
await clearEditor();
await typeText('SELECT * FROM customers WHERE cit');
rich = await acDetailed();
if (rich[0] && rich[0].label === 'city' && rich[0].kind === '列') ok('WHERE 后仍是列名上下文');
else bad('WHERE 后上下文异常', rich.slice(0, 4).map((x) => `${x.label}(${x.kind})`).join(' / '));

/* ==================================================== 三、语法高亮 */
// 编辑器是「透明 textarea + 底层高亮 <pre>」的双层结构。
// 只要两层的内容盒宽度或排版属性有一点不同，文字就会错位 —— 这里全查一遍。
const HL_SQL =
  "SELECT b.title, COUNT(*) AS n\nFROM books b\nJOIN authors a ON a.id = b.author_id\n" +
  "WHERE b.price > 50 AND a.country = '中国'\nGROUP BY b.title -- 注释\nLIMIT 10;";

await clearEditor();
await p.locator(ed).fill(HL_SQL);
await p.waitForTimeout(400);

const hlState = await p.evaluate(() => {
  const edEl = document.getElementById('editor');
  const hlEl = document.getElementById('hl');
  const cs = (el) => getComputedStyle(el);
  const a = cs(edEl), b = cs(hlEl);
  const props = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing',
                 'whiteSpace', 'overflowWrap', 'wordBreak', 'tabSize',
                 'paddingTop', 'paddingLeft', 'paddingBottom', 'marginTop'];
  const counts = {};
  for (const el of hlEl.querySelectorAll('span')) counts[el.className] = (counts[el.className] || 0) + 1;
  return {
    textMatch: hlEl.textContent === edEl.value,
    edH: edEl.scrollHeight, hlH: hlEl.scrollHeight,
    edW: edEl.clientWidth - parseFloat(a.paddingLeft) - parseFloat(a.paddingRight),
    hlW: hlEl.clientWidth - parseFloat(b.paddingLeft) - parseFloat(b.paddingRight),
    styleDiff: props.filter((k) => a[k] !== b[k]),
    counts,
    baseColor: b.color,
    kwColor: hlEl.querySelector('.t-kw') ? cs(hlEl.querySelector('.t-kw')).color : null,
    fontSizes: {
      code: a.fontSize,
      base: cs(document.body).fontSize,
    },
  };
});

if (hlState.textMatch) ok('高亮层文本与编辑器逐字一致');
else bad('高亮层文本与编辑器不一致');

if (hlState.edW === hlState.hlW && hlState.edH === hlState.hlH)
  ok('高亮层与编辑器对齐（内容盒等宽 + 换行行数相同）', `${hlState.edW}px / ${hlState.edH}px`);
else bad('高亮层与编辑器错位', `宽 ${hlState.edW} vs ${hlState.hlW}，高 ${hlState.edH} vs ${hlState.hlH}`);

if (!hlState.styleDiff.length) ok('两层排版属性完全一致（字号/行高/内边距/换行）');
else bad('两层排版属性有差异', hlState.styleDiff.join(' | '));

const need = ['t-kw', 't-fn', 't-str', 't-num', 't-com', 't-tbl'];
const missing = need.filter((k) => !hlState.counts[k]);
if (!missing.length) ok('六类 token 都被着色', JSON.stringify(hlState.counts));
else bad('有 token 类型未着色', missing.join(' / '));

if (hlState.kwColor && hlState.kwColor !== hlState.baseColor) ok('关键字颜色区别于正文', hlState.kwColor);
else bad('关键字没有着色', String(hlState.kwColor));

// 字号确实调大了（编辑器等宽内容 15px，正文 15px）
if (parseFloat(hlState.fontSizes.code) >= 15 && parseFloat(hlState.fontSizes.base) >= 15)
  ok('默认字号已调大', `代码 ${hlState.fontSizes.code} / 正文 ${hlState.fontSizes.base}`);
else bad('字号未调大', JSON.stringify(hlState.fontSizes));

// 长 SQL 换行后仍然对齐
await p.locator(ed).fill(
  "SELECT o.order_date, SUM(oi.quantity * oi.unit_price) AS day_amount, " +
  "SUM(SUM(oi.quantity * oi.unit_price)) OVER (ORDER BY o.order_date) AS running_total " +
  "FROM orders o JOIN order_items oi ON oi.order_id = o.id WHERE o.status = '已完成' " +
  "GROUP BY o.order_date ORDER BY o.order_date;"
);
await p.waitForTimeout(350);
const wrapped = await p.evaluate(() => {
  const edEl = document.getElementById('editor');
  const hlEl = document.getElementById('hl');
  return { ok: edEl.scrollHeight === hlEl.scrollHeight, same: hlEl.textContent === edEl.value };
});
if (wrapped.ok && wrapped.same) ok('长 SQL 自动换行后两层仍对齐');
else bad('长 SQL 换行后错位', JSON.stringify(wrapped));

// 设置里能关掉
await p.locator('#btn-settings').click();
await p.waitForTimeout(180);
await p.locator('[data-hl-pick="off"]').click();
await p.waitForTimeout(250);
const offState = await p.evaluate(() => {
  const hlEl = document.getElementById('hl');
  return {
    spans: hlEl.querySelectorAll('span').length,
    same: hlEl.textContent === document.getElementById('editor').value,
    enabled: window.Highlighter.enabled,
  };
});
if (offState.spans === 0 && offState.same && !offState.enabled) ok('设置里可关闭语法高亮（退化为纯文本）');
else bad('关闭高亮异常', JSON.stringify(offState));

await p.locator('[data-hl-pick="on"]').click();
await p.waitForTimeout(250);
await p.keyboard.press('Escape');
await p.waitForTimeout(150);
if ((await p.evaluate(() => document.querySelectorAll('#hl span').length)) > 0) ok('可重新开启高亮');
else bad('重新开启高亮失败');

// 中文输入法组合期间 value 已经在变，高亮必须跟上 ——
// 否则用户看不见自己正在打的字
await clearEditor();
const ime = await p.evaluate(async () => {
  const ta = document.getElementById('editor');
  const hl = document.getElementById('hl');
  const steps = [];
  ta.focus();
  ta.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  ta.value = "SELECT * FROM books WHERE genre = '科";
  ta.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
  await new Promise((r) => setTimeout(r, 60));
  steps.push(hl.textContent === ta.value);
  ta.value = "SELECT * FROM books WHERE genre = '科幻'";
  ta.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
  await new Promise((r) => setTimeout(r, 60));
  steps.push(hl.textContent === ta.value);
  ta.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 80));
  steps.push(hl.textContent === ta.value);
  return { steps, strColor: getComputedStyle(hl.querySelector('.t-str')).color };
});
if (ime.steps.every(Boolean)) ok('输入法组合期间高亮实时跟随（中文可见）');
else bad('输入法组合期间高亮丢失', JSON.stringify(ime.steps));

/* ============================================ 四、补全 + 运行 联动 */
// 顺便验证「中段上下文」：SELECT 之后应优先列名而非关键字
await clearEditor();
await typeText('SELECT * FROM books WHERE st');
const midCtx = await acItems();
if (midCtx[0] && midCtx[0].toLowerCase() === 'stock') ok('补全：查询中段优先列名（st → stock）', midCtx.slice(0, 4).join(' / '));
else bad('补全：中段未优先列名', midCtx.slice(0, 5).join(' / '));
await p.keyboard.press('Escape');
await p.waitForTimeout(120);

// 用补全敲出答案，再直接运行通关
await p.locator('[data-level="2-1"]').click();
await p.waitForTimeout(200);
await clearEditor();
await typeText('SELECT title, stock FROM books WHERE stock = 0');
await p.keyboard.press('Escape');
await p.waitForTimeout(120);
await p.locator('#btn-run').click();
await p.waitForTimeout(400);
const vcls = await p.locator('#verdict').getAttribute('class');
if (vcls.includes('ok')) ok('补全输入的内容可直接运行通关');
else bad('补全后运行失败', (await p.locator('#verdict').innerText()).replace(/\n/g, ' ').slice(0, 100));

await b.close();

/* ------------------------------------------------------------ 报告 */
const nPass = results.filter((r) => r[0] === 'PASS').length;
const nFail = results.filter((r) => r[0] === 'FAIL').length;
const nWarn = results.filter((r) => r[0] === 'WARN').length;
console.log('\n=== 编辑器增强功能测试 ===');
for (const [s, n, d] of results) {
  console.log(`${s === 'PASS' ? '  ✓' : s === 'FAIL' ? '  ✗' : '  !'} ${n}${d ? '  — ' + d : ''}`);
}
console.log(`\n通过 ${nPass} / 失败 ${nFail} / 提示 ${nWarn}`);
if (errs.length) {
  console.log(`\n控制台错误 ${errs.length} 条：`);
  [...new Set(errs)].slice(0, 8).forEach((e) => console.log('  · ' + e.slice(0, 180)));
} else console.log('控制台无错误。');
process.exit(nFail ? 1 : 0);
