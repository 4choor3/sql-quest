/* 在真实浏览器里把全部关卡逐个打通一遍（最强端到端验证） */
import path from 'node:path';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL_ = process.env.URL || 'http://127.0.0.1:8123/';

// 从 levels.js 里取出所有关卡 id + 参考答案
const sb = { window: {}, console };
vm.createContext(sb);
for (const f of ['src/levels.js', 'src/levels-adv.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sb);
}
const levels = [];
for (const ch of [...sb.window.CHAPTERS, ...sb.window.ADV_CHAPTERS]) {
  for (const lv of ch.levels) levels.push([lv.id, lv.solution]);
}

const b = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push(e.message));
p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

await p.goto(URL_, { waitUntil: 'networkidle' });
await p.waitForSelector('#editor', { timeout: 25000 });
await p.evaluate(() => localStorage.clear());
await p.reload({ waitUntil: 'networkidle' });
await p.waitForSelector('#editor', { timeout: 25000 });

const bad = [];
for (const [id, sql] of levels) {
  await p.locator(`[data-level="${id}"]`).click();
  await p.waitForTimeout(60);
  await p.locator('#editor').fill(sql);
  await p.locator('#btn-run').click();
  await p.waitForTimeout(150);
  const cls = await p.locator('#verdict').getAttribute('class');
  if (!cls.includes('ok')) {
    bad.push(`${id}: ${(await p.locator('#verdict').innerText()).replace(/\n/g, ' ').slice(0, 120)}`);
  }
}

const prog = (await p.locator('#progress-num').innerText()).replace(/\s/g, '');
const banner = await p.locator('#finish-banner').isVisible();
await p.screenshot({ path: path.join(ROOT, 'qa/07-allclear.png') });
await b.close();

console.log(`浏览器内全通关: ${levels.length - bad.length} / ${levels.length}（含进阶关）`);
console.log(`进度显示: ${prog}   通关横幅: ${banner ? '已显示' : '未显示'}`);
if (bad.length) { console.log('失败关卡:'); bad.forEach(x => console.log('  ✗ ' + x)); }
if (errs.length) console.log('控制台错误: ' + [...new Set(errs)].slice(0,5).join(' | '));
process.exit(bad.length || errs.length || prog !== '39/39' || !banner ? 1 : 0);
