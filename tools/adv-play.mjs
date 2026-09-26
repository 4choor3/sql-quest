import { chromium } from 'playwright-core';
import fs from 'node:fs';
import vm from 'node:vm';
const b = await chromium.launch({ channel: 'chrome', headless: true });
const p = await b.newPage();
const errs = [];
p.on('pageerror', e => errs.push(e.message));
p.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
await p.goto('http://127.0.0.1:8123/', { waitUntil: 'networkidle' });
await p.waitForSelector('#editor', { timeout: 25000 });
await p.evaluate(() => localStorage.clear());
await p.reload({ waitUntil: 'networkidle' });
await p.waitForSelector('#editor', { timeout: 25000 });

const sb = { window: {}, console }; vm.createContext(sb);
vm.runInContext(fs.readFileSync('src/levels-adv.js','utf8'), sb);
const adv = [];
for (const ch of sb.window.ADV_CHAPTERS) for (const lv of ch.levels) adv.push([lv.id, lv.title, lv.solution]);

let okN = 0;
for (const [id, title, sql] of adv) {
  await p.locator(`[data-level="${id}"]`).click();
  await p.waitForTimeout(80);
  await p.locator('#editor').fill(sql);
  await p.locator('#btn-run').click();
  await p.waitForTimeout(200);
  const cls = await p.locator('#verdict').getAttribute('class');
  const rows = await p.locator('#table-slot tbody tr').count();
  if (cls.includes('ok')) { okN++; console.log(`  ✓ ${id.padEnd(5)} ${title.padEnd(14)} ${rows} 行`); }
  else console.log(`  ✗ ${id.padEnd(5)} ${title.padEnd(14)} ${(await p.locator('#verdict').innerText()).replace(/\n/g,' ').slice(0,90)}`);
}
console.log(`\n进阶关通关: ${okN}/${adv.length}`);
console.log(errs.length ? '错误: ' + [...new Set(errs)].slice(0,3).join(' | ') : '无控制台错误');
await b.close();
process.exit(okN === adv.length ? 0 : 1);
