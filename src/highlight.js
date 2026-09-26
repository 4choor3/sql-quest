/* ==========================================================================
   SQL 语法高亮
   --------------------------------------------------------------------------
   把 SQL 文本切成 token，产出带 class 的 HTML，喂给编辑器底层那个 <pre>。
   编辑器结构是「文字透明的 textarea + 底层高亮层」，所以这里只要保证
   输出的**字符与原文完全一致**（只加标签、不改内容），两层就不会错位。

   着色对象：关键字 / 内置函数 / 字符串 / 数字 / 注释 / 表名
   列名不着色 —— 一屏里列名太密集，全上色反而看不清结构。
   ========================================================================== */
(function () {
  'use strict';

  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );

  /**
   * 一次扫描切分。顺序很关键：
   * 注释和字符串必须排在前面，否则里面的关键字 / 数字会被误着色。
   * 字符串允许未闭合（`'?`）—— 写错了也要能一眼看出它是一段字符串。
   */
  const TOKEN =
    /(--[^\n]*|\/\*[\s\S]*?\*\/)|('(?:[^']|'')*'?)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_$]*)/g;

  const Highlighter = {
    enabled: true,
    tables: new Set(),
    columns: new Set(),
    wordKeywords: new Set(),
    functions: new Set(),

    /**
     * 关键字 / 函数表取自补全模块，避免两处各维护一份、久而久之不一致。
     * 多词关键字（GROUP BY 之类）在这里拆成单词，因为分词是按单词走的。
     */
    syncWordLists() {
      const A = window.Autocomplete;
      if (!A) return;
      this.wordKeywords = new Set(
        (A.KEYWORDS || [])
          .flatMap((k) => String(k).split(' '))
          .map((w) => w.toUpperCase())
          .filter(Boolean)
      );
      this.functions = new Set((A.FUNCTIONS || []).map((f) => String(f).toUpperCase()));
    },

    /** 表名列表来自表结构，用来把表名标成另一种颜色 */
    setSchema(tables) {
      if (!tables) return;
      this.tables = new Set(tables.map((t) => t.name.toLowerCase()));
      const cols = new Set();
      for (const t of tables) for (const c of t.cols) cols.add(c.name.toLowerCase());
      this.columns = cols;
    },

    /** SQL 文本 → 高亮 HTML（字符内容与原文逐字一致） */
    render(sql) {
      const text = String(sql == null ? '' : sql);
      if (!this.enabled) return esc(text);
      if (!this.wordKeywords.size) this.syncWordLists();

      let out = '';
      let last = 0;
      let m;
      TOKEN.lastIndex = 0;

      while ((m = TOKEN.exec(text)) !== null) {
        if (m.index > last) out += esc(text.slice(last, m.index));
        const full = m[0];
        const [, comment, str, num, word] = m;

        if (comment) {
          out += `<span class="t-com">${esc(full)}</span>`;
        } else if (str) {
          out += `<span class="t-str">${esc(full)}</span>`;
        } else if (num) {
          out += `<span class="t-num">${esc(full)}</span>`;
        } else if (word) {
          const up = word.toUpperCase();
          let cls = '';
          if (this.wordKeywords.has(up)) cls = 't-kw';
          else if (this.functions.has(up)) cls = 't-fn';
          else if (this.tables.has(word.toLowerCase())) cls = 't-tbl';
          out += cls ? `<span class="${cls}">${esc(word)}</span>` : esc(word);
        }

        last = m.index + full.length;
        if (full.length === 0) TOKEN.lastIndex++;   // 防零宽匹配死循环
      }

      out += esc(text.slice(last));
      return out;
    },

    /** 把高亮结果写进指定容器（编辑器底层那层） */
    renderInto(el, sql) {
      if (!el) return;
      el.innerHTML = this.render(sql);
    },
  };

  window.Highlighter = Highlighter;
})();
