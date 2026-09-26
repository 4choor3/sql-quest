/* sql-formatter 精简入口：只打包 sqlite 方言（见 tools/build-vendor.mjs） */
import { format } from 'sql-formatter';

window.SqlFormatter = {
  /** 按 SQLite 方言格式化 SQL；失败时抛错，由调用方兜底 */
  formatSqlite(sql, opts = {}) {
    return format(sql, Object.assign({ language: 'sqlite' }, opts));
  },
};
