/* ==========================================================================
   SQL 自动补全
   --------------------------------------------------------------------------
   纯 textarea 上实现候选弹层，包含：
     · 词库：SQL 关键字 / 内置函数 / 表名 / 列名
     · 上下文感知排序（语句开头偏关键字、FROM 后偏表名、其余偏列名）
     · `表名.` 或 `别名.` 之后只提示该表的列（含 FROM/JOIN 里的别名解析）
     · 光标坐标测量（镜像 div），弹层跟随光标
     · ↑↓ 选择，Tab / Enter 插入，Esc 关闭，鼠标可点
   ========================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------------------ 词库常量 */
  const KEYWORDS = [
    'SELECT', 'FROM', 'WHERE', 'GROUP BY', 'HAVING', 'ORDER BY', 'LIMIT', 'OFFSET',
    'DISTINCT', 'AS', 'AND', 'OR', 'NOT', 'IN', 'BETWEEN', 'LIKE', 'GLOB',
    'IS NULL', 'IS NOT NULL', 'EXISTS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
    'WITH', 'UNION', 'UNION ALL', 'EXCEPT', 'INTERSECT',
    'JOIN', 'INNER JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'CROSS JOIN', 'ON', 'USING',
    'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM',
    'CREATE TABLE', 'DROP TABLE', 'ALTER TABLE',
    'ASC', 'DESC', 'NULL', 'DEFAULT', 'PRIMARY KEY', 'FOREIGN KEY', 'REFERENCES',
    'CAST', 'COLLATE', 'ALL', 'ANY', 'SOME', 'OVER', 'PARTITION BY',
  ];

  const FUNCTIONS = [
    'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'TOTAL', 'GROUP_CONCAT',
    'ROUND', 'ABS', 'RANDOM',
    'LENGTH', 'LOWER', 'UPPER', 'SUBSTR', 'TRIM', 'LTRIM', 'RTRIM',
    'REPLACE', 'INSTR', 'COALESCE', 'IFNULL', 'NULLIF', 'TYPEOF',
    'DATE', 'TIME', 'DATETIME', 'STRFTIME', 'JULIANDAY',
    'ROW_NUMBER', 'RANK', 'DENSE_RANK',
  ];

  const MAX_ITEMS = 12;

  /* -------------------------------------------------- 保留字（识别别名时排除） */
  // 比 KEYWORDS 更全：只要一个词可能出现在 FROM 后面却不是别名，就得在这里
  const RESERVED = new Set([
    ...KEYWORDS.flatMap((k) => k.split(' ')),
    ...FUNCTIONS,
    'ON', 'USING', 'WHERE', 'GROUP', 'ORDER', 'HAVING', 'LIMIT', 'OFFSET',
    'INNER', 'LEFT', 'RIGHT', 'FULL', 'OUTER', 'CROSS', 'NATURAL', 'JOIN',
    'UNION', 'EXCEPT', 'INTERSECT', 'WINDOW', 'FILTER', 'RETURNING',
    'ASC', 'DESC', 'COLLATE', 'ESCAPE', 'GLOB', 'REGEXP', 'MATCH',
    'AND', 'OR', 'NOT', 'IN', 'IS', 'LIKE', 'BETWEEN', 'EXISTS', 'CASE',
    'WHEN', 'THEN', 'ELSE', 'END', 'OVER', 'PARTITION', 'BY', 'AS',
    'NULLS', 'FIRST', 'LAST', 'ROWS', 'RANGE', 'PRECEDING', 'FOLLOWING',
    'CURRENT', 'ROW', 'UNBOUNDED', 'WITH', 'RECURSIVE', 'VALUES', 'SET',
    'SELECT', 'FROM', 'INTO', 'UPDATE', 'DELETE', 'INSERT', 'TABLE',
    'GROUP_CONCAT', 'STRFTIME', 'JULIANDAY',
  ].map((s) => s.toUpperCase()));

  /* -------------------------------------------------- 符号类型展示信息 */
  /** 派生表 / CTE 的哨兵值：它们没有静态列信息，只能按名字前缀宽松匹配 */
  const DERIVED = '\u0000derived';

  /* ------------------------------------------------------------ 工具函数 */
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );

  /** 把 label 里命中 token 的一段高亮 */
  function highlight(label, token) {
    if (!token) return esc(label);
    const i = label.toLowerCase().indexOf(token.toLowerCase());
    if (i < 0) return esc(label);
    return (
      esc(label.slice(0, i)) +
      '<b>' + esc(label.slice(i, i + token.length)) + '</b>' +
      esc(label.slice(i + token.length))
    );
  }

  /**
   * 屏蔽字符串字面量、注释和引号标识符，避免把里面的内容误当成 SQL 词汇。
   * 用双引号占位符替换，长度无关紧要，只要求结构不变。
   */
  function guard(sql) {
    return sql
      .replace(/--[^\n]*/g, ' ')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/'(?:[^']|'')*'/g, ' "" ');
  }

  function cmpRank(a, b) {
    for (let i = 0; i < a.length; i++) {
      if (a[i] < b[i]) return -1;
      if (a[i] > b[i]) return 1;
    }
    return 0;
  }

  /* -------------------------------------------------- 光标坐标（镜像测量） */
  let MIRROR = null;

  const MIRROR_PROPS = [
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant',
    'lineHeight', 'letterSpacing', 'wordSpacing', 'textIndent', 'textTransform',
    'whiteSpace', 'overflowWrap', 'wordBreak', 'tabSize',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'boxSizing',
  ];

  function mirrorFor(ta) {
    if (!MIRROR) {
      MIRROR = document.createElement('div');
      MIRROR.setAttribute('aria-hidden', 'true');
      document.body.appendChild(MIRROR);
    }
    const cs = getComputedStyle(ta);
    MIRROR.style.cssText =
      'position:absolute;top:0;left:-99999px;visibility:hidden;' +
      'height:auto;overflow:hidden;border:0;margin:0;';
    for (const p of MIRROR_PROPS) MIRROR.style[p] = cs[p];
    // 与 textarea 的内容盒等宽，保证换行位置一致
    MIRROR.style.width = ta.clientWidth + 'px';
    MIRROR.style.whiteSpace = 'pre-wrap';
    MIRROR.style.overflowWrap = cs.overflowWrap || 'anywhere';
    return MIRROR;
  }

  /** 返回光标相对 textarea 内容盒的 { left, top }（未扣滚动） */
  function caretPoint(ta, pos) {
    const m = mirrorFor(ta);
    const val = ta.value;
    m.textContent = val.slice(0, pos);
    // 光标正好在换行符之后时，需要占位字符才会产生新行高度
    if (val.charAt(pos - 1) === '\n') m.textContent += ' ';
    const marker = document.createElement('span');
    marker.textContent = val.slice(pos) || '.';
    m.appendChild(marker);
    const pt = { left: marker.offsetLeft, top: marker.offsetTop };
    m.removeChild(marker);
    return pt;
  }

  /* ================================================================ 主体 */
  const Autocomplete = {
    ta: null,
    pop: null,
    vocab: [],
    colsByTable: {},
    tables: [],
    items: [],
    idx: 0,
    token: '',
    start: 0,
    open: false,
    composing: false,
    enabled: true,

    /* ------------------------------------------------------------ 初始化 */
    attach(ta) {
      this.ta = ta;
      this.hide();
      if (!this.pop) this._buildPop();

      ta.addEventListener('input', () => {
        if (this.composing) return;
        this.update();
      });
      ta.addEventListener('keydown', (e) => this.onKeyDown(e));
      ta.addEventListener('compositionstart', () => { this.composing = true; this.hide(); });
      ta.addEventListener('compositionend', () => {
        this.composing = false;
        setTimeout(() => this.update(), 0);
      });
      ta.addEventListener('blur', () => this.hide());
      ta.addEventListener('click', () => this.update());
      ta.addEventListener('scroll', () => { if (this.open) this.position(); });

      // 点击候选项：用 mousedown + preventDefault，避免 textarea 失焦
      this.pop.addEventListener('mousedown', (e) => {
        const li = e.target.closest('.ac-item');
        if (!li) {
          // 点在弹层空白处（列表内边距、底部提示条）→ 收起，让位给下方编辑区
          this.hide();
          return;
        }
        e.preventDefault();
        const i = Number(li.dataset.i);
        if (Number.isInteger(i)) { this.idx = i; this.accept(); }
      });
      this.pop.addEventListener('mousemove', (e) => {
        const li = e.target.closest('.ac-item');
        if (!li) return;
        const i = Number(li.dataset.i);
        if (Number.isInteger(i) && i !== this.idx) {
          this.idx = i;
          this._paintActive();
        }
      });

      window.addEventListener('resize', () => { if (this.open) this.position(); });

      // 点页面别处 → 收起（全局只注册一次，切关重建编辑器时不会重复挂）
      if (!this._outsideBound) {
        this._outsideBound = true;
        document.addEventListener('mousedown', (e) => {
          if (!this.open) return;
          if (this.pop.contains(e.target) || e.target === this.ta) return;
          this.hide();
        });
      }
    },

    _buildPop() {
      const pop = document.createElement('div');
      pop.className = 'autocomplete';
      pop.hidden = true;
      pop.setAttribute('role', 'listbox');
      document.body.appendChild(pop);
      this.pop = pop;
    },

    /* -------------------------------------------------------- 构建词库 */
    refresh() {
      if (typeof Engine === 'undefined' || !Engine.ready) return;
      const tables = Engine.schema();
      const vocab = [];
      this.colsByTable = {};
      this.tables = tables.map((t) => t.name);

      for (const k of KEYWORDS) {
        vocab.push({ label: k, type: 'kw', insert: k + ' ', detail: '关键字' });
      }
      for (const f of FUNCTIONS) {
        vocab.push({ label: f, type: 'fn', insert: f + '(', detail: '函数' });
      }

      // 列名去重：同名列表在多张表里只留一条，detail 标注归属
      const colMap = new Map();
      for (const t of tables) {
        vocab.push({ label: t.name, type: 'table', insert: t.name, detail: `表 · ${t.rows} 行` });
        // detail 必须一起带上：作用域收敛后会直接拿这份缓存出候选，
        // 缺了它右侧的来源标签就是空白
        this.colsByTable[t.name] = t.cols.map((c) => ({
          label: c.name,
          type: 'col',
          insert: c.name,
          table: t.name,
          colType: c.type,
          detail: `列 · ${t.name}`,
        }));
        for (const c of t.cols) {
          if (!colMap.has(c.name)) colMap.set(c.name, { type: c.type || 'ANY', tables: [] });
          colMap.get(c.name).tables.push(t.name);
        }
      }
      for (const [name, info] of colMap) {
        vocab.push({
          label: name,
          type: 'col',
          insert: name,
          table: info.tables[0],
          detail: info.tables.length > 1 ? `列 · ${info.tables.length} 张表` : `列 · ${info.tables[0]}`,
        });
      }

      this.vocab = vocab;
      this.baseVocab = vocab;
    },

    /* ------------------------------------------------------ 文档内符号 */
    /**
     * 从当前 SQL 文本里抽取用户自己定义的符号，让它也进候选：
     *   SELECT COUNT(*) AS book_count ...   → book_count（别名）
     *   SELECT price * stock value ...      → value（省略 AS 的别名）
     *   WITH city_stat AS (...)             → city_stat（CTE 名）
     *   FROM (SELECT ...) AS t              → t（派生表别名，也算表）
     */
    extractSymbols(text) {
      const out = [];
      const seen = new Set();
      const add = (label, type, detail) => {
        const k = label.toLowerCase();
        if (seen.has(k)) return;
        seen.add(k);
        out.push({ label, type, insert: label, detail });
      };

      // 用一组「不可能出现在 SQL 里」的占位符屏蔽字符串字面量和注释，
      // 避免把 'HELLO' 里的内容或注释里的词当成别名
      const guarded = guard(text);

      // 派生表别名：FROM ( ... ) AS alias —— 必须紧跟 FROM/JOIN 后面的那个括号
      // 先于「显式别名」登记，这样 b 会被正确归类为派生表（可见其没有静态列）
      for (const m of guarded.matchAll(/\b(?:FROM|JOIN)\s*\([\s\S]*?\)\s*(?:AS\s+)?([A-Za-z_][A-Za-z0-9_]*)/gi)) {
        const alias = m[1];
        if (RESERVED.has(alias.toUpperCase())) continue;
        add(alias, 'sub', '派生表 · 本文定义');
      }

      // CTE 名
      for (const m of guarded.matchAll(/\bWITH\s+(?:RECURSIVE\s+)?([A-Za-z_][A-Za-z0-9_]*)\s+AS\s*\(/gi)) {
        add(m[1], 'cte', 'CTE · 本文定义');
      }
      for (const m of guarded.matchAll(/,\s*([A-Za-z_][A-Za-z0-9_]*)\s+AS\s*\(/gi)) {
        add(m[1], 'cte', 'CTE · 本文定义');
      }

      // 显式别名：expr AS name
      for (const m of guarded.matchAll(/\bAS\s+([A-Za-z_][A-Za-z0-9_]*)/gi)) {
        add(m[1], 'alias', '别名 · 本文定义');
      }

      // 隐式别名：SELECT 列表里省略 AS 的写法
      const selectList = this._selectListOf(guarded);
      if (selectList) {
        // 逐个逗号分段，取段尾的裸标识符
        for (const part of selectList.split(',')) {
          const m = part.match(/(?:^|[\s)])([A-Za-z_][A-Za-z0-9_]*)\s*$/);
          if (!m) continue;
          const word = m[1];
          if (RESERVED.has(word.toUpperCase())) continue;
          // 整段就是一个列名（SELECT title）时不算别名
          if (part.trim().toLowerCase() === word.toLowerCase()) continue;
          add(word, 'alias', '别名 · 本文定义');
        }
      }

      // 表别名：FROM/JOIN tbl alias
      for (const m of guarded.matchAll(/\b(?:FROM|JOIN)\s+([A-Za-z_][A-Za-z0-9_]*)\s+(?:AS\s+)?([A-Za-z_][A-Za-z0-9_]*)/gi)) {
        const alias = m[2];
        if (RESERVED.has(alias.toUpperCase())) continue;
        add(alias, 'table', '表别名 · 本文定义');
      }

      return out;
    },

    /** 取最外层 SELECT ... FROM 之间的内容（用于找隐式别名） */
    _selectListOf(sql) {
      const m = /\bSELECT\s+(?:DISTINCT\s+|ALL\s+)?([\s\S]*?)\bFROM\b/i.exec(sql);
      return m ? m[1] : null;
    },

    /* ------------------------------------------------------ 作用域解析 */
    /** 取光标所在的语句（按分号切，只保留光标那一条） */
    statementAt(text, pos) {
      let start = text.lastIndexOf(';', pos - 1) + 1;
      let end = text.indexOf(';', pos);
      if (end < 0) end = text.length;
      return text.slice(start, end);
    },

    /**
     * 解析当前语句真正引用了哪些表。
     *   FROM books / JOIN authors a / UPDATE customers / INSERT INTO orders
     *   WITH x AS (...)   —— CTE 名不算基表
     * 返回 { tables:[..], hasTable:boolean }
     *   hasTable=false 表示语句里还没写 FROM（比如刚敲 SELECT ），此时不收敛
     */
    scopeTables(stmt) {
      const guarded = guard(stmt);
      const names = [];
      const seen = new Set();
      const push = (n) => {
        // 去掉引号包裹，统一小写比较
        const clean = n.replace(/^["'`\[]|["'`\]]$/g, '');
        const k = clean.toLowerCase();
        if (seen.has(k)) return;
        seen.add(k);
        names.push(clean);
      };

      // CTE 名先收集，后面 FROM 到它们时不算基表
      const ctes = new Set();
      for (const m of guarded.matchAll(/\bWITH\s+(?:RECURSIVE\s+)?([A-Za-z_][A-Za-z0-9_]*)\s+AS\s*\(/gi)) {
        ctes.add(m[1].toLowerCase());
      }
      for (const m of guarded.matchAll(/,\s*([A-Za-z_][A-Za-z0-9_]*)\s+AS\s*\(/gi)) {
        ctes.add(m[1].toLowerCase());
      }

      // FROM / JOIN / UPDATE / INTO 后面的表名（含带引号写法）
      const re = /\b(?:FROM|JOIN|UPDATE|INTO)\s+("?[A-Za-z_][A-Za-z0-9_]*"?)/gi;
      let m;
      while ((m = re.exec(guarded))) {
        const name = m[1].replace(/"/g, '');
        if (RESERVED.has(name.toUpperCase())) continue;
        if (ctes.has(name.toLowerCase())) continue;
        // 只认真正存在于库里的表
        if (this.tables.includes(name)) push(name);
      }

      // DELETE FROM 已被上面的 FROM 覆盖；`UPDATE tbl` 也被覆盖
      return { tables: names, hasTable: names.length > 0 };
    },

    /**
     * 把 `b.` 里的 b 还原成真实表名：支持
     *   FROM books b / FROM books AS b
     *   FROM (SELECT ...) AS b   —— 派生表，列从内层 SELECT 推
     *   WITH x AS (...)          —— CTE 同理
     */
    resolveAlias(text, name) {
      if (this.tables.includes(name)) return name;
      const lower = name.toLowerCase();

      // 普通表别名
      const re = /\b(?:FROM|JOIN)\s+([A-Za-z_][A-Za-z0-9_]*)\s+(?:AS\s+)?([A-Za-z_][A-Za-z0-9_]*)/gi;
      let m;
      while ((m = re.exec(text))) {
        const alias = m[2];
        if (RESERVED.has(alias.toUpperCase())) continue;
        if (alias.toLowerCase() === lower) return m[1];
      }

      // 派生表：FROM ( ... ) AS b —— 带上括号内容，供 derivedColumns 解析
      const d = this._derivedBody(text, name);
      if (d !== null) return DERIVED;

      // CTE：WITH b AS ( ... )
      const c = this._cteBody(text, name);
      if (c !== null) return DERIVED;

      return null;
    },

    /** 取出 `FROM ( ... ) AS name` 里括号中的 SQL；找不到返回 null */
    _derivedBody(text, name) {
      const re = new RegExp(
        `\\b(?:FROM|JOIN)\\s*\\(([\\s\\S]*?)\\)\\s*(?:AS\\s+)?${name}\\b`,
        'i'
      );
      const m = re.exec(text);
      return m ? m[1] : null;
    },

    /** 取出 `WITH name AS ( ... )` 里括号中的 SQL；找不到返回 null */
    _cteBody(text, name) {
      const re = new RegExp(
        `\\b${name}\\s+AS\\s*\\(([\\s\\S]*?)\\)\\s*(?:,|SELECT|$)`,
        'i'
      );
      const m = re.exec(text);
      return m ? m[1] : null;
    },

    /**
     * 从派生表 / CTE 的内层 SELECT 推出可用列，返回候选数组。
     * 只处理 `SELECT a, b AS c` 这种直接取自基表的情况 —— 内层列能对上
     * 真实表就带出类型信息，对不上（表达式）就按别名当普通列提示。
     */
    derivedColumns(text, name) {
      if (!name) return [];
      const body = this._derivedBody(text, name) ?? this._cteBody(text, name);
      if (!body) return [];

      const list = this._selectListOf(body);
      if (!list) return [];

      // 内层 FROM 的表，用来给列配类型
      const fromM = /\bFROM\s+([A-Za-z_][A-Za-z0-9_]*)/i.exec(body);
      const srcCols = fromM && this.colsByTable[fromM[1]] ? this.colsByTable[fromM[1]] : [];

      const out = [];
      const seen = new Set();
      for (const raw of list.split(',')) {
        const part = raw.trim();
        if (!part) continue;

        // `expr AS name` 或 `expr name`
        let m = /\bAS\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/i.exec(part);
        if (!m) m = /(?:^|[\s)])([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(part);
        if (!m) continue;
        const col = m[1];
        if (RESERVED.has(col.toUpperCase())) continue;
        if (seen.has(col.toLowerCase())) continue;
        seen.add(col.toLowerCase());

        const src = srcCols.find((c) => c.label.toLowerCase() === col.toLowerCase());
        out.push({
          label: col,
          type: 'col',
          insert: col,
          detail: src ? `列 · ${fromM[1]}` : '派生列',
        });
      }
      return out;
    },

    contextAt(text, pos) {
      const before = text.slice(0, pos);

      // 1) `标识符.` 之后 —— 只提示该表的列
      const q = before.match(/([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z0-9_]*)$/);
      if (q) {
        const table = this.resolveAlias(text, q[1]);
        return {
          kind: 'qualified',
          table,
          aliasName: q[1],          // 派生表要用它找回内层 SELECT
          token: q[2],
          start: pos - q[2].length,
        };
      }

      // 2) 普通标识符前缀
      const t = before.match(/([A-Za-z_][A-Za-z0-9_]*)$/);
      const token = t ? t[1] : '';
      const start = pos - token.length;
      const pre = before.slice(0, start);

      // 3) 语句开头（文本开头或分号之后只剩空白）→ 关键字优先
      if (/(?:^|;)\s*$/.test(pre)) {
        return token ? { kind: 'statement-start', token, start } : null;
      }
      // 4) 表名位置：取**最后一个** FROM / JOIN / INTO / UPDATE / TABLE，
      //    再看它后面是不是干净的表名。
      //
      //    ⚠️ 不能用一条贪婪正则从第一个 FROM 开始匹配：
      //    `FROM orders o JOIN o` 会被整段吞掉，其中出现的 `JOIN` 又被当成
      //    「子句里已经有别的关键字」，于是判定失败、退化成列名上下文 ——
      //    结果 JOIN 后面只给列名和关键字，偏偏不给表名。
      const lead = [...pre.matchAll(/\b(FROM|JOIN|INTO|UPDATE|TABLE)\b/gi)].pop();
      if (lead) {
        const tail = pre.slice(lead.index + lead[0].length);
        const words = tail.trim().split(/[\s.,]+/).filter(Boolean);
        const body = words.slice(0, -1);
        const lastWord = words[words.length - 1] || '';
        // 出现括号说明已经在列清单里了（如 INSERT INTO t (a, b），那儿不该给表名
        const hasParen = /[()]/.test(tail);
        const dirty =
          hasParen ||
          body.some((w) => RESERVED.has(w.toUpperCase())) ||
          RESERVED.has(lastWord.toUpperCase());
        if (!dirty) return { kind: 'table', token, start };
      }
      // 5) 这些子句后面要的是列 / 别名，不是表名
      if (/\b(?:SELECT|WHERE|AND|OR|NOT|ON|HAVING|ORDER\s+BY|GROUP\s+BY|PARTITION\s+BY|SET|THEN|ELSE|WHEN|USING|BY)\s+[A-Za-z0-9_.\s,()*+/'-]*$/i.test(pre)) {
        if (!token) return null;
        return { kind: 'column', token, start };
      }
      // 6) 其余位置 → 列名优先
      if (!token) return null;
      return { kind: 'column', token, start };
    },

    /* ---------------------------------------------------------- 候选排序 */
    rank(item, tk, kind) {
      const label = item.label.toLowerCase();
      let match;
      if (!tk) match = 0;
      else if (label === tk) match = 0;
      else if (label.startsWith(tk)) match = 1;
      else if (label.includes(tk)) match = 3;
      else return null;

      const t = item.type;
      let type;
      // 用户自己定义的别名 / CTE 排在同类之前 —— 他刚写下它，说明正要用它
      if (kind === 'table') {
        // FROM 后面要的是表名，表名必须压过同前缀的列名（bo → books 而非 book_id）
        type = t === 'table' && this.tables.includes(item.label) ? 0
             : t === 'kw' ? 3
             : t === 'alias' || t === 'cte' ? 2
             : 4;
      } else if (kind === 'statement-start') {
        type = t === 'kw' ? 0 : t === 'cte' ? 1 : t === 'table' ? 1 : 2;
      } else {
        type = t === 'alias' ? 0 : t === 'cte' || t === 'sub' ? 0 : t === 'col' ? 1 : t === 'table' ? 2 : t === 'fn' ? 3 : 4;
      }
      // 文档内符号（别名/CTE）整体再提前半档
      if (t === 'alias' || t === 'cte' || t === 'sub') type -= 0.5;

      return [match, type, item.label.length, label];
    },

    /* -------------------------------------------------------------- 查询 */
    update() {
      const ta = this.ta;
      if (!ta || !this.enabled) return;
      const text = ta.value;
      const pos = ta.selectionStart;
      if (pos !== ta.selectionEnd) return this.hide();   // 有选区时不补全

      const ctx = this.contextAt(text, pos);
      if (!ctx || (ctx.kind === 'qualified' && !ctx.table)) return this.hide();
      // 限定前缀但没有该表信息时，退化为按前缀搜全部
      const tk = ctx.token.toLowerCase();

      // 用户自己定义的别名 / CTE 也要能补全 —— 每次按键重新解析，保证实时
      const symbols = this.extractSymbols(text);

      // 作用域：这条语句引用了哪几张表。一旦确定了表，列名就不再跨表乱给。
      const stmt = this.statementAt(text, pos);
      const scope = this.scopeTables(stmt);

      let pool;
      if (ctx.kind === 'qualified') {
        if (ctx.table === DERIVED) {
          // 派生表 / CTE：从它内部的 SELECT 推列；推不出就只给别名
          pool = this.derivedColumns(text, ctx.aliasName);
        } else {
          // 明确知道是哪张表 —— 只给这张表的列，不给任何跨表内容
          pool = this.colsByTable[ctx.table] || [];
        }
      } else if (ctx.kind === 'table') {
        // 表名位置：这里**只有表名（和 CTE 名）是合法的**。
        // 列名、函数、普通关键字放进来只会误导 —— 曾经 JOIN 后面给出列名，
        // 用户选中后拼出 `JOIN order_id` 这种跑不通的语句。
        pool = this.vocab.filter((v) => v.type === 'table').concat(
          symbols.filter((s) => s.type === 'cte')
        );
      } else if (scope.hasTable) {
        // 语句已经指明用哪张（几张）表 → 列名收敛到这些表
        pool = [];
        for (const t of scope.tables) {
          for (const c of this.colsByTable[t] || []) {
            const multi = scope.tables.length > 1;
            pool.push({
              ...c,
              detail: multi ? `列 · ${t}` : c.detail,
            });
          }
        }
        // 别名 / CTE 仍然可用，关键字与函数照给
        pool = pool.concat(
          symbols.filter((s) => s.type !== 'table'),
          this.vocab.filter((v) => v.type === 'kw' || v.type === 'fn')
        );
      } else {
        // 还没写 FROM → 用完整词库（这时用户可能想要任何东西）
        pool = symbols.concat(this.vocab);
      }

      const scored = [];
      const picked = new Set();
      for (const it of pool) {
        const r = this.rank(it, tk, ctx.kind === 'qualified' ? 'column' : ctx.kind);
        if (!r) continue;
        // 同名去重：文档内符号排在前面，优先保留
        const key = it.label.toLowerCase();
        if (picked.has(key)) continue;
        picked.add(key);
        scored.push([r, it]);
      }
      scored.sort((a, b) => cmpRank(a[0], b[0]));

      const items = scored.slice(0, MAX_ITEMS).map((x) => x[1]);
      if (!items.length) return this.hide();
      // 只有一条且已经精确匹配时，不再打扰
      if (items.length === 1 && items[0].label.toLowerCase() === tk) return this.hide();
      this.items = items;
      this.idx = 0;
      this.token = ctx.token;
      this.start = ctx.start;
      this.open = true;
      this.render();
      this.position();
    },

    /* -------------------------------------------------------------- 渲染 */
    render() {
      const pop = this.pop;
      pop.innerHTML =
        '<ul class="ac-list">' +
        this.items
          .map(
            (it, i) =>
              `<li class="ac-item${i === this.idx ? ' active' : ''}" data-i="${i}" role="option" aria-selected="${i === this.idx}">` +
              `<span class="ac-label">${highlight(it.label, this.token)}</span>` +
              `<span class="ac-detail">${esc(it.detail || '')}</span>` +
              '</li>'
          )
          .join('') +
        '</ul>' +
        '<div class="ac-foot"><b>↑</b><b>↓</b> 选择 · <b>Tab</b>/<b>Enter</b> 插入 · <b>Esc</b> 关闭</div>';
      pop.hidden = false;
      this._scrollActiveIntoView();
    },

    _paintActive() {
      this.pop.querySelectorAll('.ac-item').forEach((el, i) => {
        el.classList.toggle('active', i === this.idx);
        el.setAttribute('aria-selected', String(i === this.idx));
      });
      this._scrollActiveIntoView();
    },

    _scrollActiveIntoView() {
      const el = this.pop.querySelector('.ac-item.active');
      if (!el) return;
      const list = this.pop.querySelector('.ac-list');
      const top = el.offsetTop, bottom = top + el.offsetHeight;
      if (top < list.scrollTop) list.scrollTop = top;
      else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
    },

    /* ------------------------------------------------------------ 定位 */
    position() {
      const ta = this.ta, pop = this.pop;
      if (!ta || !pop || pop.hidden) return;
      const pt = caretPoint(ta, ta.selectionStart);
      const rect = ta.getBoundingClientRect();
      const lh = parseFloat(getComputedStyle(ta).lineHeight) || 20;

      let left = rect.left + pt.left - ta.scrollLeft;
      let top = rect.top + pt.top - ta.scrollTop + lh + 4;

      const pw = pop.offsetWidth, ph = pop.offsetHeight;
      const vw = window.innerWidth, vh = window.innerHeight;

      if (left + pw > vw - 8) left = vw - pw - 8;
      if (left < 8) left = 8;
      if (top + ph > vh - 8) {
        const above = rect.top + pt.top - ta.scrollTop - ph - 4;
        top = above >= 8 ? above : Math.max(8, vh - ph - 8);
      }
      pop.style.left = Math.round(left) + 'px';
      pop.style.top = Math.round(top) + 'px';
    },

    /* ------------------------------------------------------------ 交互 */
    isOpen() { return this.open; },

    move(delta) {
      const n = this.items.length;
      if (!n) return;
      this.idx = (this.idx + delta + n) % n;
      this._paintActive();
    },

    accept() {
      const ta = this.ta;
      const item = this.items[this.idx];
      if (!ta || !item) return;

      const end = ta.selectionStart;
      let ins = item.insert;

      // 后面已经是空格/逗号/右括号时，不再多余补空格
      const after = ta.value.slice(end);
      if (ins.endsWith(' ') && /^[\s,)]/.test(after)) ins = ins.replace(/\s+$/, '');

      // 用 execCommand 替换，保留浏览器原生撤销栈（⌘Z 可回退）
      ta.setSelectionRange(this.start, end);
      const ok = document.execCommand && document.execCommand('insertText', false, ins);
      if (!ok) {
        ta.setRangeText(ins, this.start, end, 'end');
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      }
      ta.setSelectionRange(this.start + ins.length, this.start + ins.length);
      this.hide();
      ta.focus();
    },

    hide() {
      if (!this.open) return;
      this.open = false;
      this.items = [];
      this.idx = 0;
      if (this.pop) this.pop.hidden = true;
    },

    onKeyDown(e) {
      if (!this.open) return;
      switch (e.key) {
        case 'ArrowDown': e.preventDefault(); this.move(1); return;
        case 'ArrowUp':   e.preventDefault(); this.move(-1); return;
        case 'Tab':       e.preventDefault(); this.accept(); return;
        case 'Enter':
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;  // ⌘↵ 留给「运行」
          e.preventDefault(); this.accept(); return;
        case 'Escape':    e.preventDefault(); this.hide(); return;
        case 'ArrowLeft': case 'ArrowRight': case 'Home': case 'End':
          this.hide(); return;
        default: return;
      }
    },
  };

  // 关键字 / 函数表对外暴露：语法高亮直接复用，避免两处各维护一份
  Autocomplete.KEYWORDS = KEYWORDS;
  Autocomplete.FUNCTIONS = FUNCTIONS;

  window.Autocomplete = Autocomplete;
})();
