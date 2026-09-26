/* ==========================================================================
   打包：把 HTML / CSS / JS / 数据 / WASM 全部内联成单个 HTML 文件
   产物：dist/sql-quest.html —— 双击即可打开，无需服务器、无需联网
   ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
fs.mkdirSync(DIST, { recursive: true });

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let html = read('index.html');

// 1. 内联 CSS
html = html.replace(
  /<link rel="stylesheet" href="([^"]+)">/,
  (_, href) => `<style>\n${read(href)}\n</style>`
);

// 2. 内联脚本（按出现顺序）
html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, src) => {
  const code = read(src);
  // 防止内联脚本里出现 </script> 提前闭合标签
  return `<script>\n${code.replace(/<\/script>/gi, '<\\/script>')}\n</script>`;
});

// 3. 单文件版不需要 wasm 外链兜底，去掉注释里的服务器假设
html = html.replace(
  '<title>SQL 闯关训练场</title>',
  '<title>SQL 闯关训练场</title>\n<!-- 单文件版：所有依赖已内联，可离线双击打开 -->'
);

const out = path.join(DIST, 'sql-quest.html');
fs.writeFileSync(out, html, 'utf8');

const kb = (fs.statSync(out).size / 1024).toFixed(0);
console.log(`单文件产物 -> ${out}`);
console.log(`体积 ${kb} KB（含 SQLite WASM）`);

// 4. 顺带产出一份可直接导入的示例库，方便用户拿去练手
fs.copyFileSync(path.join(ROOT, 'data/schema.sql'), path.join(DIST, 'bookstore.sql'));
console.log(`示例数据库 -> ${path.join(DIST, 'bookstore.sql')}`);
fs.copyFileSync(path.join(ROOT, 'data/schema_adv.sql'), path.join(DIST, 'campus.sql'));
console.log(`示例数据库 -> ${path.join(DIST, 'campus.sql')}`);
