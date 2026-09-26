/* 验证线上 Pages 站点真的能用（不只是返回 200） */
import { chromium } from 'playwright-core';
const URL_ = 'https://4choor3.github.io/sql-quest/';
const b = await chromium.launch({ channel: 'chrome', headless: true });
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errs = [];
p.on('pageerror', e => errs.push(e.message));
p.on('console', m => { if (m.type()==='error') errs.push(m.text()); });

await p.goto(URL_, { waitUntil: 'load', timeout: 90000 });
await p.waitForSelector('#editor', { timeout: 40000 });
console.log('✓ 线上页面加载，SQL 引擎就绪');

const n = await p.locator('.level-item').count();
console.log(`✓ 关卡数 ${n}`);

// 基础关答题
await p.locator('[data-level="1-1"]').click();
await p.waitForTimeout(300);
await p.locator('#editor').fill('SELECT title, price FROM books;');
await p.locator('#btn-run').click();
await p.waitForTimeout(500);
const v1 = await p.locator('#verdict').getAttribute('class');
console.log(v1.includes('ok') ? '✓ 基础关答题通关' : '✗ 基础关失败 ' + v1);

// 语法高亮
const hl = await p.evaluate(() => document.querySelectorAll('#hl span').length);
console.log(hl > 0 ? `✓ 语法高亮生效（${hl} 个着色片段）` : '✗ 高亮未生效');

// 补全
await p.locator('#editor').fill('');
await p.locator('#editor').pressSequentially('SELECT * FROM bo', { delay: 20 });
await p.waitForTimeout(350);
const ac = await p.locator('.autocomplete .ac-label').first().innerText().catch(()=>'');
console.log(ac === 'books' ? '✓ 自动补全生效（bo → books）' : '✗ 补全异常: ' + ac);
await p.keyboard.press('Escape');

// 进阶关（跨库）
await p.locator('[data-level="a-8"]').click();
await p.waitForTimeout(400);
await p.locator('#editor').fill('SELECT s.id, s.name FROM students s WHERE NOT EXISTS (SELECT 1 FROM enrollments e WHERE e.student_id = s.id) ORDER BY s.id;');
await p.locator('#btn-run').click();
await p.waitForTimeout(500);
const v2 = await p.locator('#verdict').getAttribute('class');
const badge = await p.locator('#dataset-badge').innerText();
console.log(v2.includes('ok') ? `✓ 进阶关答题通关（${badge}）` : '✗ 进阶关失败 ' + v2);

// 单文件版也能下载
const dl = await p.evaluate(async () => {
  const r = await fetch('dist/sql-quest.html', { method: 'HEAD' });
  return { ok: r.ok, size: r.headers.get('content-length') };
});
console.log(dl.ok ? `✓ dist/sql-quest.html 可下载（${Math.round(dl.size/1024)} KB）` : '✗ 单文件版不可下载');

console.log(errs.length ? '\n控制台错误: ' + [...new Set(errs)].slice(0,3).join(' | ') : '\n无控制台错误');
await b.close();
process.exit(errs.length ? 1 : 0);
