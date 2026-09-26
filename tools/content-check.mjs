/* 内容级校验：右侧表格渲染的文本，必须与直接查库的结果逐格一致 */
import { chromium } from 'playwright-core';
const b = await chromium.launch({ channel: 'chrome', headless: true });
const p = await b.newPage();
await p.goto('http://127.0.0.1:8123/', { waitUntil: 'networkidle' });
await p.waitForSelector('#editor');
await p.evaluate(() => localStorage.clear());
await p.reload({ waitUntil: 'networkidle' });
await p.waitForSelector('#editor');

// 确保 books 处于展开状态（首屏可能已因「右栏跟随关卡」自动展开，
// 无条件点一次会把它收起）
const booksWrap = p.locator('.tbl[data-tbl="books"]');
if (!(await booksWrap.evaluate((e) => e.classList.contains('open')))) {
  await p.locator('.tbl[data-tbl="books"] .tbl-head').click();
}
await p.waitForTimeout(300);

const r = await p.evaluate(() => {
  const wrap = document.querySelector('.tbl[data-tbl="books"]');
  const head = [...wrap.querySelectorAll('thead th')].map(e => e.textContent.trim());
  const rows = [...wrap.querySelectorAll('tbody tr')].map(tr =>
    [...tr.querySelectorAll('td')].map(td => td.textContent.trim())
  );
  // 用同一个引擎独立查一遍做对照
  const expect = window.__probe ? null : null;
  return { head, rows };
});

console.log('表头:', r.head.join(' | '));
console.log('渲染行数:', r.rows.length);
r.rows.slice(0, 5).forEach(x => console.log('  ', x.join(' | ')));

// 与引擎直查结果对照
const same = await p.evaluate((rendered) => {
  const res = Engine.run('SELECT * FROM books LIMIT 12');
  const cols = res.columns;
  const vals = res.values.map(row => row.map(v => v === null ? 'NULL' : (typeof v === 'number' ? String(Math.round(v*1e6)/1e6) : String(v))));
  if (cols.join() !== rendered.head.join()) return 'COLUMN_MISMATCH: ' + cols.join() + ' vs ' + rendered.head.join();
  if (vals.length !== rendered.rows.length) return `ROW_COUNT ${vals.length} vs ${rendered.rows.length}`;
  for (let i = 0; i < vals.length; i++) {
    for (let j = 0; j < vals[i].length; j++) {
      if (vals[i][j] !== rendered.rows[i][j]) {
        return `CELL[${i}][${j}] sql="${vals[i][j]}" dom="${rendered.rows[i][j]}"`;
      }
    }
  }
  return 'OK';
}, r);

console.log('\n逐格比对 SQL 结果 vs DOM 渲染:', same === 'OK' ? '✓ 完全一致' : '✗ ' + same);

// 浮层内容一致性
await p.locator('.tbl[data-tbl="books"] [data-zoom]').click();
await p.waitForTimeout(300);
const modalRows = await p.locator('#modal tbody tr').count();
const total = await p.evaluate(() => Engine.count('books'));
console.log(`浮层行数 ${modalRows} vs 库中总数 ${total}:`, modalRows === total ? '✓' : '✗');
// 用 textContent 而不是 innerText：td 里的 .cell 是块级元素，
// innerText 会为它插入换行，看起来像凭空多了空单元格
console.log('浮层首行:', await p.locator('#modal tbody tr').first().evaluate(
  (tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.trim()).join(' | ')
));

/* ---- 全数值列表格（会走末尾 fill 兜底列）也要逐格对得上 ---- */
await p.keyboard.press('Escape');
await p.waitForTimeout(200);
const numeric = await p.evaluate(() => {
  const wrap = document.querySelector('.tbl[data-tbl="books"]');
  const t = wrap.querySelector('table.grid');
  const ths = [...t.querySelectorAll('thead th')];
  const firstRow = t.querySelector('tbody tr');
  const tds = [...firstRow.querySelectorAll('td')];
  return {
    head: ths.map((x) => x.textContent.trim()),
    row: tds.map((x) => x.textContent.trim()),
    hasFill: ths.some((x) => x.classList.contains('fill')),
  };
});
console.log(`右栏 books 表头(${numeric.head.length} 项):`, JSON.stringify(numeric.head));
console.log(`右栏 books 首行(${numeric.row.length} 项):`, JSON.stringify(numeric.row));
console.log('是否含兜底空列:', numeric.hasFill ? '是' : '否（由文本列吸收宽度）');

await b.close();
process.exit(same === 'OK' && modalRows === total ? 0 : 1);
