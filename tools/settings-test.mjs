/* ==========================================================================
   设置面板测试：主题切换 / 初始代码格式化 / 补全开关 / 右栏跟随 / 持久化
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
await p.waitForTimeout(300);

const theme = () => p.evaluate(() => document.documentElement.getAttribute('data-theme'));
const bodyBg = () => p.evaluate(() => getComputedStyle(document.body).backgroundColor);
const openSettings = async () => { await p.locator('#btn-settings').click(); await p.waitForTimeout(180); };
const closeSettings = async () => { await p.keyboard.press('Escape'); await p.waitForTimeout(180); };

/* ------------------------------------------------------- 1. 面板开关 */
if (!(await p.locator('#settings').isVisible())) ok('设置面板默认关闭');
else bad('设置面板初始就打开了');

await openSettings();
if (await p.locator('#settings').isVisible()) ok('点击齿轮可打开设置面板');
else bad('设置面板未打开');

await p.locator('.modal-backdrop[data-close-settings]').click({ position: { x: 10, y: 10 } });
await p.waitForTimeout(200);
if (!(await p.locator('#settings').isVisible())) ok('点击遮罩可关闭设置面板');
else bad('遮罩未关闭面板');

/* ----------------------------------------------------- 2. 主题切换 */
if ((await theme()) === 'dark') ok('默认主题为深色');
else bad('默认主题异常', await theme());
const darkBg = await bodyBg();

await openSettings();
await p.locator('[data-theme-pick="light"]').click();
await p.waitForTimeout(300);
const lightBg = await bodyBg();
if ((await theme()) === 'light' && lightBg !== darkBg) ok('切换到浅色主题生效', `${darkBg} → ${lightBg}`);
else bad('浅色主题未生效', `${await theme()} / ${lightBg}`);

// 浅色下对比度仍要达标
const contrast = await p.evaluate(() => {
  const rgb = (s) => (s.match(/[\d.]+/g) || []).map(Number);
  const lum = ([r, g, bl]) => {
    const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(bl);
  };
  const ratio = (a, c) => { const x = lum(rgb(a)), y = lum(rgb(c)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const bgOf = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const c = getComputedStyle(n).backgroundColor;
      if (c && !c.includes('rgba(0, 0, 0, 0)')) return c;
      n = n.parentElement;
    }
    return getComputedStyle(document.body).backgroundColor;
  };
  const out = {};
  for (const [k, sel, min] of [
    ['brief', '.brief', 4.5], ['btn', '.btn-primary', 4.5],
    ['chapter', '.chapter-desc', 4.5], ['level', '.level-name', 4.5],
  ]) {
    const el = document.querySelector(sel);
    const r = el ? ratio(getComputedStyle(el).color, bgOf(el)) : 0;
    out[k] = { ratio: +r.toFixed(2), min, pass: r >= min };
  }
  return out;
});
const fails = Object.entries(contrast).filter(([, v]) => !v.pass);
if (!fails.length) ok('浅色主题对比度全部达标', Object.entries(contrast).map(([k, v]) => `${k} ${v.ratio}`).join(' '));
else bad('浅色主题对比度不足', fails.map(([k, v]) => `${k} ${v.ratio}<${v.min}`).join(' '));

await p.screenshot({ path: path.join(SHOTS, '30-light.png') });

// 切回深色
await p.locator('[data-theme-pick="dark"]').click();
await p.waitForTimeout(280);
if ((await theme()) === 'dark' && (await bodyBg()) === darkBg) ok('可切回深色主题');
else bad('切回深色失败', await theme());

/* ------------------------------------------ 3. 初始代码格式化开关 */
await closeSettings();
await p.locator('[data-level="4-3"]').click();
await p.waitForTimeout(300);
const fmtDefault = await p.locator('#editor').inputValue();
if (fmtDefault.includes('\n') && fmtDefault.includes('FROM\n')) ok('默认起始代码为格式化形式');
else bad('默认起始代码未格式化', JSON.stringify(fmtDefault));

await openSettings();
await p.locator('[data-starter-pick="raw"]').click();
await p.waitForTimeout(200);
await closeSettings();
await p.locator('[data-level="1-1"]').click();
await p.waitForTimeout(180);
await p.locator('[data-level="4-3"]').click();
await p.waitForTimeout(300);
const rawNow = await p.locator('#editor').inputValue();
if (rawNow === 'SELECT c.name, COUNT(o.id) AS order_count\nFROM customers c\n') ok('切到「原样」后起始代码不格式化');
else bad('「原样」未生效', JSON.stringify(rawNow));

// 草稿不应被设置覆盖
await p.locator('#editor').fill('SELECT 1 -- my draft');
await p.waitForTimeout(400);
await openSettings();
await p.locator('[data-starter-pick="formatted"]').click();
await p.waitForTimeout(200);
await closeSettings();
await p.waitForTimeout(250);
const kept = await p.locator('#editor').inputValue();
if (kept.includes('my draft')) ok('切换设置不会覆盖已写草稿');
else bad('草稿被设置覆盖', JSON.stringify(kept));

/* --------------------------------------------------- 4. 补全开关 */
await openSettings();
await p.locator('[data-ac-pick="off"]').click();
await p.waitForTimeout(200);
await closeSettings();
await p.locator('#editor').fill('');
await p.locator('#editor').pressSequentially('SELECT * FROM bo', { delay: 20 });
await p.waitForTimeout(300);
if (!(await p.locator('.autocomplete').isVisible())) ok('关闭补全后不再弹候选');
else bad('补全关闭后仍弹出');

await openSettings();
await p.locator('[data-ac-pick="on"]').click();
await p.waitForTimeout(200);
await closeSettings();
await p.locator('#editor').fill('');
await p.locator('#editor').pressSequentially('SELECT * FROM bo', { delay: 20 });
await p.waitForTimeout(300);
if (await p.locator('.autocomplete').isVisible()) ok('重新开启后补全恢复');
else bad('补全未恢复');
await p.keyboard.press('Escape');

/* ------------------------------------------------ 5. 右栏跟随开关 */
await openSettings();
await p.locator('[data-focus-pick="off"]').click();
await p.waitForTimeout(200);
await closeSettings();
await p.locator('[data-level="1-1"]').click();
await p.waitForTimeout(250);
await p.locator('[data-level="2-5"]').click();   // customers
await p.waitForTimeout(350);
const openOff = await p.locator('.tbl.open').evaluateAll((e) => e.map((x) => x.dataset.tbl));
if (!openOff.includes('customers')) ok('关闭右栏跟随后不再自动展开', `[${openOff.join(', ')}]`);
else bad('关闭后仍在自动展开', `[${openOff.join(', ')}]`);

await openSettings();
await p.locator('[data-focus-pick="on"]').click();
await p.waitForTimeout(200);
await closeSettings();
await p.locator('[data-level="1-1"]').click();
await p.waitForTimeout(200);
await p.locator('[data-level="2-5"]').click();
await p.waitForTimeout(350);
const openOn = await p.locator('.tbl.open').evaluateAll((e) => e.map((x) => x.dataset.tbl));
if (openOn.includes('customers')) ok('开启后右栏自动展开本关的表', `[${openOn.join(', ')}]`);
else bad('开启后未自动展开', `[${openOn.join(', ')}]`);

/* ------------------------------------------------- 6. 设置持久化 */
await p.reload({ waitUntil: 'networkidle' });
await p.waitForSelector('#editor', { timeout: 25000 });
await p.waitForTimeout(300);
await openSettings();
const persisted = await p.evaluate(() => ({
  theme: document.querySelector('[data-theme-pick="dark"]').getAttribute('aria-checked'),
  ac: document.querySelector('[data-ac-pick="on"]').getAttribute('aria-checked'),
  focus: document.querySelector('[data-focus-pick="on"]').getAttribute('aria-checked'),
  starter: document.querySelector('[data-starter-pick="formatted"]').getAttribute('aria-checked'),
}));
if (Object.values(persisted).every((v) => v === 'true')) ok('设置持久化：刷新后全部保留');
else bad('设置未持久化', JSON.stringify(persisted));

/* --------------------------------------------------- 7. 恢复默认 */
await p.locator('#btn-settings-reset').click();
await p.waitForTimeout(250);
const back = await p.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('sql-quest-settings-v1'));
  return { s, themeAttr: document.documentElement.getAttribute('data-theme') };
});
if (back.s.theme === 'dark' && back.s.starterFormatted === true && back.themeAttr === 'dark') ok('恢复默认可用');
else bad('恢复默认异常', JSON.stringify(back));

await b.close();

/* ------------------------------------------------------------ 报告 */
const nPass = results.filter((r) => r[0] === 'PASS').length;
const nFail = results.filter((r) => r[0] === 'FAIL').length;
console.log('\n=== 设置面板测试 ===');
for (const [s, n, d] of results) {
  console.log(`${s === 'PASS' ? '  ✓' : '  ✗'} ${n}${d ? '  — ' + d : ''}`);
}
console.log(`\n通过 ${nPass} / 失败 ${nFail}`);
if (errs.length) {
  console.log(`\n控制台错误 ${errs.length} 条：`);
  [...new Set(errs)].slice(0, 8).forEach((e) => console.log('  · ' + e.slice(0, 170)));
} else console.log('控制台无错误。');
process.exit(nFail ? 1 : 0);
