/* ==========================================================================
   引擎：SQL 执行 / 结果比对 / 进度存档
   支持多套数据集：每关通过 level.dataset 指定用哪一套（默认 bookstore）。
   ========================================================================== */

const STORE_KEY = 'sql-quest-progress-v1';

/**
 * 数据集注册表。key 与 levels.js 里 level.dataset 对应。
 * SQL 文本由 data/schema*.js 提供（生成脚本产出，避免 file:// 下的 fetch 限制）。
 */
const DATASETS = {
  bookstore: {
    label: '书店业务库',
    varName: 'SCHEMA_SQL',
    tables: 5,
    desc: '5 张表 · 25 本书 · 12 位客户 · 30 笔订单',
  },
  campus: {
    label: '校园选课库',
    varName: 'SCHEMA_ADV_SQL',
    tables: 5,
    desc: '5 张表 · 24 门课 · 60 学生 · 1126 条选课记录',
  },
};

const DEFAULT_DATASET = 'bookstore';

/** 取某套数据集的建库 SQL */
function datasetSql(key) {
  const d = DATASETS[key] || DATASETS[DEFAULT_DATASET];
  return window[d.varName] || '';
}

/* ------------------------------------------------------------------ 存档 */
const Store = {
  load() {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY)) || { done: {}, current: null };
    } catch {
      return { done: {}, current: null };
    }
  },
  save(state) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch {
      /* 隐私模式下 localStorage 不可用，静默降级为内存态 */
    }
  },
  reset() {
    try { localStorage.removeItem(STORE_KEY); } catch {}
  },
};

/* -------------------------------------------------------------- SQL 引擎 */
const Engine = {
  db: null,
  ready: false,

  /**
   * 同时建好所有数据集，各自独立一个 Database 实例。
   * 关卡切换时只换「当前用哪个」，互不干扰 —— 也保证 DML 关卡改坏一套数据
   * 不会波及另一套。
   */
  async init() {
    const SQL = await initSqlJs({
      // 优先用内联 base64，file:// 双击打开也能跑；失败再回落到同目录 wasm
      wasmBinary: this._decode(window.SQL_WASM_BASE64),
    });
    this.SQL = SQL;
    this.instances = {};
    this.clean = {};
    for (const key of Object.keys(DATASETS)) {
      const sql = datasetSql(key);
      if (!sql) continue;              // 没打包进来的数据集直接跳过
      const d = new SQL.Database();
      d.run(sql);
      this.instances[key] = d;
      this.clean[key] = d.export();
    }
    this.dataset = this.instances[DEFAULT_DATASET]
      ? DEFAULT_DATASET
      : Object.keys(this.instances)[0];
    this.db = this.instances[this.dataset];
    this.ready = true;
  },

  /** 切到另一套数据集；返回是否真的切换了 */
  use(key) {
    if (!this.instances[key] || key === this.dataset) return false;
    this.dataset = key;
    this.db = this.instances[key];
    this.invalidate();
    return true;
  },

  /** 当前数据集信息 */
  info() {
    return DATASETS[this.dataset] || DATASETS[DEFAULT_DATASET];
  },

  /** 当前数据集的初始快照（重置动作用它） */
  cleanExport() {
    return this.clean[this.dataset];
  },

  _decode(b64) {
    if (!b64) return undefined;
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  },

  /**
   * 在当前库的**只读副本**上执行 SQL。
   *
   * ⚠️ 两个坑都踩过，这里一并解决：
   *  1. `db.export()` 会在 Emscripten 虚拟文件系统里写临时文件。若每次查询都
   *     export，高频调用（右栏逐表刷新）会把 FS 撑爆，抛 `ErrnoError: FS error`
   *     之后所有查询永久失效 —— 所以这里不再每次 export。
   *  2. 副本实例只建一次并复用：把当前库的快照灌进去，用完不再 new/close。
   *     复用期间用 `restore` 语义（关闭 → 重建）代价很高，改为直接用
   *     `db.exec` 在副本上跑 —— 副本本身就是一次性查询用的，无需每轮刷新。
   */
  run(sql) {
    const db = this._ensureReadonly();
    const res = db.exec(sql);
    if (!res.length) return { columns: [], values: [] };
    const last = res[res.length - 1];
    return { columns: last.columns, values: last.values };
  },

  /** 取（或懒建）当前库的只读副本 */
  _ensureReadonly() {
    const src = this.db;
    if (this._ro && this._roSrc === src && this._roVersion === this._version) {
      return this._ro;
    }
    // 需要重建副本时才 export（低频：只在库内容变化后发生）
    if (this._ro) { try { this._ro.close(); } catch {} }
    this._ro = new this.SQL.Database(src.export());
    this._roSrc = src;
    this._roVersion = this._version;
    return this._ro;
  },

  /** 库内容发生变化（DML 执行 / 换库 / 恢复快照）后调用，让只读副本失效 */
  invalidate() {
    this._version = (this._version || 0) + 1;
  },

  /** 在快照副本上跑一段 SQL 再跑另一段（DML 关卡校验用），new/close 严格配对 */
  runThenProbe(snapshot, sql, probe) {
    const tmp = new this.SQL.Database(snapshot);
    try {
      tmp.run(sql);
      const res = tmp.exec(probe);
      if (!res.length) return { columns: [], values: [] };
      return { columns: res[0].columns, values: res[0].values };
    } finally {
      tmp.close();
    }
  },

  /**
   * 把数据库恢复到某个快照（Uint8Array），保证重复运行幂等。
   *
   * ⚠️ 关键：`this.db` 平时就是数据集注册表里的常驻实例。
   * 若在这里 close() 掉它，那个数据集会被永久废掉 —— 之后再切回它
   * 就报 `ErrnoError: FS error`，且不可恢复。
   *
   * 所以策略是：**原地重建**。把常驻实例从注册表里摘下来，创建一个新实例
   * 顶上（内容和快照一致），再把注册表指过去。旧实例照常 close。
   * 这样注册表永远持有可用实例，切来切去都安全。
   */
  restore(snapshot) {
    if (!snapshot) return;
    const old = this.db;
    const fresh = new this.SQL.Database(snapshot);

    // 找到 old 在注册表里的位置，替换成 fresh
    let swapped = false;
    for (const [k, v] of Object.entries(this.instances || {})) {
      if (v === old) {
        this.instances[k] = fresh;
        swapped = true;
      }
    }
    this.db = fresh;
    if (!swapped) {
      // old 不是常驻实例（少见）：直接关掉
      try { old.close(); } catch {}
    } else {
      try { old.close(); } catch {}
    }
    // 换了实例，只读副本必须重建
    this.invalidate();
  },

  /** 读表结构，供右侧面板展示 */
  schema() {
    const tables = [];
    const t = this.run(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    );
    for (const [name] of t.values) {
      const cols = this.run(`PRAGMA table_info("${name}")`).values.map((r) => ({
        name: r[1],
        type: r[2] || 'ANY',
        pk: r[5] === 1,
      }));
      tables.push({ name, cols, rows: this.count(name) });
    }
    // 外键关系，用于列上打 FK 标记
    for (const tbl of tables) {
      const fks = this.run(`PRAGMA foreign_key_list("${tbl.name}")`).values;
      for (const fk of fks) {
        const col = tbl.cols.find((c) => c.name === fk[3]);
        if (col) col.fk = `${fk[2]}.${fk[4]}`;
      }
    }
    return tables;
  },

  /** 当前库里某张表的行数（DML 关卡执行后会变，所以每次都现查） */
  count(table) {
    try {
      return this.run(`SELECT COUNT(*) FROM "${table}"`).values[0][0];
    } catch {
      return 0;
    }
  },

  /** 取某张表的真实数据 → { columns, values, total } */
  tableData(table, limit = 12) {
    const n = Math.max(1, Math.min(Number(limit) || 12, 500));
    let res;
    try {
      res = this.run(`SELECT * FROM "${table}" LIMIT ${n}`);
    } catch {
      return { columns: [], values: [], total: 0 };
    }
    return { columns: res.columns, values: res.values, total: this.count(table) };
  },
};

/* ------------------------------------------------------------ 值归一化 */
/** 把 SQL 值转成可稳定比较的字符串 */
function norm(v) {
  if (v === null || v === undefined) return '\u0000NULL';
  if (typeof v === 'number') {
    // 消除浮点误差：保留 6 位有效小数
    return String(Math.round(v * 1e6) / 1e6);
  }
  if (v instanceof Uint8Array) return 'blob:' + v.length;
  return String(v).trim();
}

function rowKey(row) {
  return row.map(norm).join('\u0001');
}

/* --------------------------------------------------------------- 比对器 */
const Compare = {
  /**
   * @returns {{ok:boolean, reason?:string, missing?:string[], extra?:string[]}}
   */
  check(level, got, want) {
    const mode = level.compare || 'columns';

    if (mode === 'scalar') {
      if (got.values.length !== 1 || got.values[0].length !== 1) {
        return {
          ok: false,
          reason: `这一关要返回**一个数字**，你返回了 ${got.values.length} 行 ${got.columns.length} 列。`,
        };
      }
      const a = Number(got.values[0][0]);
      const b = Number(want.values[0][0]);
      if (Number.isNaN(a) || Number.isNaN(b)) {
        return { ok: false, reason: '结果不是数字，检查一下聚合函数。' };
      }
      if (Math.abs(a - b) < 1e-6) return { ok: true };
      return {
        ok: false,
        reason: `数值不对。期望 **${b}**，你算出来是 **${a}**。`,
      };
    }

    if (mode === 'columns') {
      const wantCols = want.columns.map((c) => c.toLowerCase());
      const gotCols = got.columns.map((c) => c.toLowerCase());
      const colOk =
        wantCols.length === gotCols.length &&
        wantCols.every((c, i) => c === gotCols[i]);
      const setOk = this._sameSet(got.values, want.values);

      if (colOk && setOk) return { ok: true };

      if (!colOk) {
        return {
          ok: false,
          reason:
            `列对不上。\n\n期望的列：${want.columns.map((c) => `\`${c}\``).join('、')}\n` +
            `你返回的列：${got.columns.length ? got.columns.map((c) => `\`${c}\``).join('、') : '（无）'}` +
            (setOk ? '\n\n数据本身是对的，把列名/顺序对齐就行。' : ''),
          ...this._diff(got, want),
        };
      }
      return {
        ok: false,
        reason: `返回了 ${got.values.length} 行，应该是 ${want.values.length} 行。`,
        ...this._diff(got, want),
      };
    }

    // set / ordered
    const wantKeys = want.values.map(rowKey);
    const gotKeys = got.values.map(rowKey);

    if (mode === 'ordered') {
      if (gotKeys.length === wantKeys.length && gotKeys.every((k, i) => k === wantKeys[i])) {
        return { ok: true };
      }
      // 顺序对了但数据不对 → 给集合差异；否则提示排序
      const sameSet = this._sameSet(got.values, want.values);
      if (sameSet) {
        return {
          ok: false,
          reason:
            '数据是对的，但**顺序不对**。检查 `ORDER BY` 的列和升降序（`DESC`）。',
        };
      }
      return {
        ok: false,
        reason: `结果和期望不一致（你 ${gotKeys.length} 行，期望 ${wantKeys.length} 行）。`,
        ...this._diff(got, want),
      };
    }

    if (this._sameSet(got.values, want.values)) return { ok: true };

    return {
      ok: false,
      reason: `结果和期望不一致（你 ${gotKeys.length} 行，期望 ${wantKeys.length} 行）。`,
      ...this._diff(got, want),
    };
  },

  _sameSet(a, b) {
    if (a.length !== b.length) return false;
    const sa = a.map(rowKey).sort();
    const sb = b.map(rowKey).sort();
    return sa.every((k, i) => k === sb[i]);
  },

  /** 生成差异清单：缺少的行 / 多出的行 */
  _diff(got, want) {
    const MAX = 6;
    const gotKeys = got.values.map(rowKey);
    const wantKeys = want.values.map(rowKey);
    const gotSet = new Set(gotKeys);
    const wantSet = new Set(wantKeys);

    const missing = [];
    const seen = new Set();
    for (let i = 0; i < wantKeys.length; i++) {
      if (!gotSet.has(wantKeys[i]) && !seen.has(wantKeys[i])) {
        seen.add(wantKeys[i]);
        missing.push(want.values[i]);
      }
    }
    const extra = [];
    const seen2 = new Set();
    for (let i = 0; i < gotKeys.length; i++) {
      if (!wantSet.has(gotKeys[i]) && !seen2.has(gotKeys[i])) {
        seen2.add(gotKeys[i]);
        extra.push(got.values[i]);
      }
    }
    return { missing, extra, missingTotal: missing.length, extraTotal: extra.length, MAX };
  },
};

/* -------------------------------------------------------------- 关键字校验 */
function keywordCheck(level, sql) {
  for (const [label, re] of level.require || []) {
    if (!re.test(sql)) {
      return `这一关需要用到 \`${label}\`，你的 SQL 里没找到。`;
    }
  }
  for (const [label, re] of level.forbid || []) {
    if (re.test(sql)) {
      return `这一关不能用 \`${label}\`。`;
    }
  }
  return null;
}
