/* ==========================================================================
   裁剪打包 sql-formatter
   --------------------------------------------------------------------------
   sql-formatter 的 format() 会 import 一张包含 20+ 种方言的注册表
   （allDialects.js），全量打进单文件版约 312 KB —— 而这个项目只用 SQLite。

   这里用 esbuild 插件把 allDialects.js 换成「只导出 sqlite」的虚拟模块，
   公开 API（format）保持不变，产物大幅缩小。
   ========================================================================== */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SQLITE_DIALECT = path.join(
  ROOT,
  'node_modules/sql-formatter/dist/esm/languages/sqlite/sqlite.formatter.js'
);

if (!fs.existsSync(SQLITE_DIALECT)) {
  console.error('找不到 sql-formatter 的 sqlite 方言文件，请先 npm install');
  process.exit(1);
}

const entry = path.join(ROOT, 'tools/vendor-src/sql-formatter-entry.js');

const result = await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2020'],
  outfile: path.join(ROOT, 'vendor/sql-formatter.js'),
  legalComments: 'none',
  plugins: [
    {
      name: 'sqlite-dialect-only',
      setup(build) {
        // 把方言注册表整个替换掉，只留 sqlite
        build.onResolve({ filter: /[/\\]allDialects\.js$/ }, () => ({
          path: 'sqlite-only-dialects',
          namespace: 'stub',
        }));
        build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
          contents: `export { sqlite } from ${JSON.stringify(SQLITE_DIALECT)};`,
          loader: 'js',
          resolveDir: ROOT,
        }));
      },
    },
  ],
  metafile: true,
});

const out = path.join(ROOT, 'vendor/sql-formatter.js');
const kb = (fs.statSync(out).size / 1024).toFixed(0);
const full = fs.statSync(
  path.join(ROOT, 'node_modules/sql-formatter/dist/sql-formatter.min.js')
).size;

console.log(`sql-formatter (仅 sqlite 方言) -> vendor/sql-formatter.js`);
console.log(`  裁剪后 ${kb} KB   （全量版 ${(full / 1024).toFixed(0)} KB，省下 ${(((full - fs.statSync(out).size) / full) * 100).toFixed(0)}%）`);

// 自检：产物必须能格式化出正确结果
const code = fs.readFileSync(out, 'utf8');
const sandbox = { window: {} };
const vm = await import('node:vm');
vm.runInNewContext(code, sandbox);
const got = sandbox.window.SqlFormatter.formatSqlite(
  'select a,b from t where x=1 and y=2 order by a desc',
  { keywordCase: 'upper', tabWidth: 2 }
);
const want = 'SELECT\n  a,\n  b\nFROM\n  t\nWHERE\n  x = 1\n  AND y = 2\nORDER BY\n  a DESC';
if (got.trim() !== want) {
  console.error('自检失败，产物输出不符合预期：\n' + got);
  process.exit(1);
}
console.log('  自检通过：格式化输出符合预期');
