/* ==========================================================================
   视觉审计（程序化）：不靠截图，直接读计算样式与几何，检查
     · 对比度是否达标（正文 4.5:1，大字 3:1）
     · 是否有元素溢出容器 / 视口
     · 间距、行高、字号是否落在设计阶梯上
     · 交互态（hover / active / focus）是否与常态有可辨差异
   ========================================================================== */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL_ = process.env.URL || 'http://127.0.0.1:8123/';

const b = await chromium.launch({ channel: 'chrome', headless: true });
const p = await b.newContext({ viewport: { width: 1440, height: 900 } }).then(c => c.newPage());
await p.goto(URL_, { waitUntil: 'networkidle' });
await p.waitForSelector('#editor', { timeout: 25000 });
await p.evaluate(() => localStorage.clear());
await p.reload({ waitUntil: 'networkidle' });
await p.waitForSelector('#editor', { timeout: 25000 });
await p.waitForTimeout(300);

const report = await p.evaluate(() => {
  const out = [];
  const rgb = (s) => (s.match(/[\d.]+/g) || []).map(Number);
  const lum = ([r, g, b]) => {
    const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const contrast = (fg, bg) => {
    const a = lum(rgb(fg)), c = lum(rgb(bg));
    return ((Math.max(a, c) + 0.05) / (Math.min(a, c) + 0.05));
  };
  // 向上找第一个不透明背景
  const bgOf = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const c = getComputedStyle(n).backgroundColor;
      if (c && !c.includes('rgba(0, 0, 0, 0)')) return c;
      n = n.parentElement;
    }
    return getComputedStyle(document.body).backgroundColor;
  };
  const check = (sel, label, min = 4.5) => {
    const el = document.querySelector(sel);
    if (!el) return out.push(`  · ${label}: 未找到 ${sel}`);
    const cs = getComputedStyle(el);
    const ratio = contrast(cs.color, bgOf(el));
    const pass = ratio >= min;
    out.push(`  ${pass ? '✓' : '✗'} ${label.padEnd(22)} ${cs.fontSize.padStart(6)}  对比度 ${ratio.toFixed(2)}:1 (需 ≥${min})`);
    return ratio;
  };

  out.push('【对比度】');
  check('.level-title', '关卡标题', 3);
  check('.brief', '任务描述', 4.5);
  check('.btn-primary', '主按钮文字', 4.5);
  check('.level-name', '关卡名', 4.5);
  check('.col-name', '字段名', 4.5);
  check('.chapter-desc', '章节说明', 4.5);
  check('.tbl-name', '表名', 3);

  out.push('\n【布局溢出】');
  const vw = window.innerWidth, vh = window.innerHeight;
  let overflow = 0;
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed' || cs.position === 'absolute') continue;
    if (r.right > vw + 1 || r.left < -1) {
      if (!el.closest('.grid-scroll') && !el.closest('.data-block')) {
        overflow++;
        if (overflow <= 4) out.push(`  ✗ ${el.className || el.tagName} 横向越界 right=${Math.round(r.right)}`);
      }
    }
  }
  out.push(overflow === 0 ? '  ✓ 无元素横向越界视口' : `  ✗ ${overflow} 个元素越界`);

  out.push('\n【字号阶梯】');
  const sizes = new Set();
  for (const el of document.querySelectorAll('body *')) {
    if (!el.textContent.trim()) continue;
    const s = getComputedStyle(el).fontSize;
    if (s) sizes.add(s);
  }
  out.push('  出现过的字号: ' + [...sizes].sort((a, b) => parseFloat(a) - parseFloat(b)).join(' / '));

  out.push('\n【行高】');
  for (const [sel, label] of [['.brief', '正文'], ['#editor', '代码'], ['.level-title', '标题']]) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const cs = getComputedStyle(el);
    const lh = parseFloat(cs.lineHeight) / parseFloat(cs.fontSize);
    out.push(`  ${lh >= 1.4 && lh <= 1.8 ? '✓' : '·'} ${label} 行高 ${lh.toFixed(2)}`);
  }
  return out;
});

console.log(report.join('\n'));

/* ---------------------------------------------- 补全弹层专项视觉审计 */
await p.locator('#editor').fill('');
await p.locator('#editor').pressSequentially('SELECT * FROM bo', { delay: 20 });
await p.waitForTimeout(350);

const ac = await p.evaluate(() => {
  const pop = document.querySelector('.autocomplete');
  const items = [...pop.querySelectorAll('.ac-item')];
  const active = pop.querySelector('.ac-item.active');
  const normal = items.find((i) => !i.classList.contains('active'));
  const cs = (e) => getComputedStyle(e);
  const pr = pop.getBoundingClientRect();
  const heights = items.map((i) => Math.round(i.getBoundingClientRect().height));
  return {
    size: `${Math.round(pr.width)}×${Math.round(pr.height)}`,
    itemCount: items.length,
    itemHeights: [...new Set(heights)],
    activeBg: cs(active).backgroundColor,
    normalBg: normal ? cs(normal).backgroundColor : '-',
    activeColor: cs(active.querySelector('.ac-label')).color,
    normalColor: normal ? cs(normal.querySelector('.ac-label')).color : '-',
    detailSize: normal ? cs(normal.querySelector('.ac-detail')).fontSize : '-',
    footerVisible: !!pop.querySelector('.ac-foot') && pop.querySelector('.ac-foot').getBoundingClientRect().height > 0,
    labelOverflow: items.some((i) => {
      const l = i.querySelector('.ac-label');
      return l.scrollWidth > l.clientWidth + 1;
    }),
    inViewport: pr.left >= 0 && pr.top >= 0 && pr.right <= innerWidth && pr.bottom <= innerHeight,
    radius: cs(pop).borderRadius,
    shadow: cs(pop).boxShadow !== 'none',
    zIndex: cs(pop).zIndex,
  };
});
console.log('\n【补全弹层】');
console.log(`  尺寸 ${ac.size}，${ac.itemCount} 项，单项高 ${ac.itemHeights.join('/')}px（应一致）`);
console.log(`  选中态背景 ${ac.activeBg}  vs 常态 ${ac.normalBg}  → ${ac.activeBg !== ac.normalBg ? '✓ 可辨' : '✗ 无差异'}`);
console.log(`  选中态文字 ${ac.activeColor}  vs 常态 ${ac.normalColor}  → ${ac.activeColor !== ac.normalColor ? '✓ 可辨' : '✗ 无差异'}`);
console.log(`  次要字 ${ac.detailSize}，底部提示条 ${ac.footerVisible ? '✓ 可见' : '✗ 缺失'}`);
console.log(`  文字截断 ${ac.labelOverflow ? '✗ 有' : '✓ 无'}，圆角 ${ac.radius}，阴影 ${ac.shadow ? '✓' : '✗'}，z-index ${ac.zIndex}`);
console.log(`  弹层在视口内 ${ac.inViewport ? '✓' : '✗'}`);

await b.close();
