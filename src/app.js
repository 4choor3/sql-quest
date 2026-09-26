/* ==========================================================================
   主应用：状态管理 + 界面渲染 + 交互
   ========================================================================== */

const App = {
  state: Store.load(),
  flat: [],
  current: null,
  expect: {},
  snapshot: null,
  booted: false,

  /* ------------------------------------------------------------ 初始化 */
  async boot() {
    // 基础题库 + 进阶题库，合成一条关卡链
    this.chapters = [...(window.CHAPTERS || []), ...(window.ADV_CHAPTERS || [])];
    this.flat = [];
    for (const ch of this.chapters) {
      for (const lv of ch.levels) {
        lv._chapter = ch;
        lv._index = this.flat.length;
        lv.dataset = lv.dataset || ch.dataset || 'bookstore';
        this.flat.push(lv);
      }
    }

    setStatus('正在加载 SQL 引擎…');
    try {
      await Engine.init();
    } catch (e) {
      setStatus('SQL 引擎加载失败：' + e.message, true);
      return;
    }

    setStatus('正在编译关卡…');
    // 期望值要按每关自己的数据集算，所以临时切库再切回来
    for (const lv of this.flat) {
      const prev = Engine.dataset;
      try {
        Engine.use(lv.dataset);
        this.expect[lv.id] = this._computeExpect(lv);
      } catch (e) {
        console.error(`关卡 ${lv.id} 参考答案执行失败：`, e);
        this.expect[lv.id] = null;
      } finally {
        Engine.use(prev);
      }
    }

    this.booted = true;
    document.getElementById('boot').remove();
    document.getElementById('app').hidden = false;

    this._bindGlobal();
    // 先建右栏骨架：open() → renderWork() 会调用 focusSchemaOn，
    // 那时 #schema-scroll 必须已经有 .tbl 节点了
    renderSchema();

    // 补全词库依赖表结构，必须等 Engine 就绪后再建
    if (window.Autocomplete) {
      Autocomplete.refresh();
      Autocomplete.enabled = Settings.get('autocomplete');
    }
    if (window.Highlighter) Highlighter.enabled = Settings.get('syntaxHighlight');

    const start =
      (this.state.current && this.flat.find((l) => l.id === this.state.current)) ||
      this.flat.find((l) => !this.state.done[l.id]) ||
      this.flat[0];
    this.open(start.id);
  },

  /**
   * 用参考 SQL 生成期望结果。
   * 始终在「当前数据集」的干净快照上算 —— 调用方负责先 Engine.use(level.dataset)。
   */
  _computeExpect(level) {
    const snap = Engine.cleanExport();
    // DML 关卡：先跑参考 SQL 再跑 probe；纯查询关卡直接跑参考 SQL。
    // 统一走 Engine 的方法，保证 WASM 副本实例 new/close 严格配对。
    return level.probe
      ? Engine.runThenProbe(snap, level.solution, level.probe)
      : Engine.run(level.solution);
  },

  /* -------------------------------------------------------- 关卡切换 */
  open(id) {
    const level = this.flat.find((l) => l.id === id);
    if (!level) return;

    clearTimeout(this._advanceTimer);

    // 存下当前草稿
    if (this.current) {
      const el = document.getElementById('editor');
      if (el) this.state.drafts[this.current.id] = el.value;
    }

    this.current = level;
    this.state.current = id;
    this.state.drafts = this.state.drafts || {};
    Store.save(this.state);

    // 换到这一关所属的数据集（进阶关用校园库，其余用书店库）。
    // 必须在取快照、渲染右栏、建补全词库之前完成。
    // 用 try 包住：右栏重建即使出问题也不能阻断下面的关卡/编辑器刷新 ——
    // 否则界面会「卡在上一关」，表现为点击没反应。
    const switched = Engine.use(level.dataset);
    if (switched) {
      try {
        renderSchema();
        if (window.Autocomplete) Autocomplete.refresh();
      } catch (e) {
        console.error('切换数据集后重建右栏失败：', e);
      }
    }

    // 记录本关起点的数据库状态，保证重复运行幂等
    this.snapshot = Engine.db.export();

    renderLevels();
    try {
      renderWork();
      refreshSchemaRows();
      updateDatasetBadge();
    } catch (e) {
      console.error('渲染关卡内容失败：', e);
    }
    markMobileTab('work');
  },

  /** 当前关卡是否已通过 */
  isDone(id) {
    return !!this.state.done[id];
  },

  /**
   * 这一关涉及哪些表 —— 取「用户正在写的」与「参考答案需要的」并集：
   *   · 草稿里已经出现的表（他正准备查这些）优先排前面
   *   · 答案里出现、草稿还没写的表也一并展开（这关迟早要用到）
   * 按库中表顺序输出，保证右栏顺序稳定。
   */
  levelTables() {
    const lv = this.current;
    if (!lv || !Engine.ready) return [];
    const names = Engine.schema().map((t) => t.name);

    const hit = (text) => {
      if (!text) return new Set();
      const guarded = String(text)
        .replace(/--[^\n]*/g, ' ')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/'(?:[^']|'')*'/g, ' "" ');
      const s = new Set();
      for (const n of names) {
        if (new RegExp(`\\b${n}\\b`, 'i').test(guarded)) s.add(n);
      }
      return s;
    };

    const ed = document.getElementById('editor');
    const draft = ed ? ed.value : this.state.drafts[lv.id];
    const inDraft = hit(draft);
    const inAnswer = hit(lv.solution);
    const union = new Set([...inDraft, ...inAnswer]);

    // 按库中定义顺序返回，右栏列表不会跳来跳去
    return names.filter((n) => union.has(n));
  },

  /* ------------------------------------------------------------ 执行 */
  run() {
    const level = this.current;
    if (!level) return;

    const sql = document.getElementById('editor').value.trim();
    this.state.drafts[level.id] = document.getElementById('editor').value;
    Store.save(this.state);

    if (!sql) {
      showVerdict('err', '还没写 SQL', '在编辑器里写下你的查询，再按运行。');
      return;
    }

    const expect = this.expect[level.id];
    if (!expect) {
      showVerdict('err', '这一关暂时无法校验', '参考答案执行出错，请反馈。');
      return;
    }

    // 恢复本关起点 → 执行用户 SQL → 取结果
    let got;
    try {
      Engine.restore(this.snapshot);
      Engine.db.run(sql);
      const probeSql = level.probe || sql;
      const res = Engine.db.exec(probeSql);
      got = res.length
        ? { columns: res[res.length - 1].columns, values: res[res.length - 1].values }
        : { columns: [], values: [] };
    } catch (e) {
      Engine.restore(this.snapshot);
      document.getElementById('editor-shell').classList.add('is-err');
      showVerdict('err', 'SQL 报错', `<code>${esc(e.message)}</code>`);
      hideTable();
      return;
    }
    document.getElementById('editor-shell').classList.remove('is-err');

    // DML 可能刚改过数据，同步右侧面板的行数和预览
    refreshSchemaRows();

    // 关键字校验（防止硬编码凑答案）
    const kwErr = keywordCheck(level, sql);
    if (kwErr && !this.isDone(level.id)) {
      showVerdict('err', '还差一点', md(kwErr));
      renderTable(got, '你的结果');
      return;
    }

    const verdict = Compare.check(level, got, expect);

    if (verdict.ok) {
      const first = !this.isDone(level.id);
      this.state.done[level.id] = true;
      Store.save(this.state);
      renderLevels();
      renderWorkStats();

      showVerdict(
        'ok',
        '通关',
        first ? '结果正确，这一关拿下。' : '结果依然正确。'
      );
      renderTable(got, '你的结果');
      if (first) this._celebrate(level);
    } else {
      showVerdict('err', '结果不对', md(verdict.reason || '再检查一下。'));
      renderDiff(verdict, expect);
      renderTable(got, '你的结果');
    }
  },

  _celebrate(level) {
    const next = this.flat[level._index + 1];
    const allDone = this.flat.every((l) => this.isDone(l.id));
    toast(allDone ? '全部关卡通关' : '通关！', allDone ? 'sparkle' : 'check');

    if (allDone) {
      document.getElementById('finish-banner').classList.add('show');
      return;
    }
    // 短暂停留后自动进入下一关。
    // 但用户如果已经开始敲下一条 SQL，就别把他拽走 —— 输入会取消这个跳转。
    if (next) {
      clearTimeout(this._advanceTimer);
      this._advanceTimer = setTimeout(() => {
        if (this.current && this.current.id === level.id) this.open(next.id);
      }, 1100);
    }
  },

  /* ---------------------------------------------------------- 辅助动作 */
  showHint() {
    const box = document.getElementById('hint-box');
    if (box) box.classList.toggle('show');
  },

  showAnswer() {
    const d = document.getElementById('ref-answer');
    if (d) d.open = true;
  },

  /** 一键格式化编辑器里的 SQL（sql-formatter，SQLite 方言） */
  formatSql() {
    const ed = document.getElementById('editor');
    if (!ed) return;
    const src = ed.value;

    if (!src.trim()) {
      toast('还没有内容可以格式化', 'alert');
      return;
    }
    if (!window.SqlFormatter) {
      toast('格式化组件未加载', 'alert');
      return;
    }
    if (window.Autocomplete) Autocomplete.hide();

    let out;
    try {
      out = window.SqlFormatter.formatSqlite(src, {
        keywordCase: 'upper',
        tabWidth: 2,
        linesBetweenQueries: 1,
      });
    } catch (e) {
      const msg = String((e && e.message) || e).split('\n')[0].slice(0, 70);
      toast('格式化失败：' + msg, 'alert');
      return;
    }

    const next = out.replace(/\s+$/, '');
    if (next === src.replace(/\s+$/, '')) {
      toast('已经是格式化过的了', 'format');
      return;
    }
    setEditorText(ed, next);
    toast('已格式化', 'format');
  },

  resetLevel() {
    const el = document.getElementById('editor');
    el.value = this.current.starter || '';
    refreshHighlight();
    this.state.drafts[this.current.id] = el.value;
    Store.save(this.state);
    Engine.restore(this.snapshot);
    el.focus();
    hideVerdict();
    hideTable();
  },

  resetAll() {
    if (!confirm('清空所有通关记录和草稿，从头开始？')) return;
    Store.reset();
    this.state = { done: {}, current: null, drafts: {} };
    Engine.restore(Engine.cleanExport());
    document.getElementById('finish-banner').classList.remove('show');
    renderLevels();
    this.open(this.flat[0].id);
    toast('进度已重置', 'refresh');
  },

  next() {
    const n = this.flat[this.current._index + 1];
    if (n) this.open(n.id);
  },

  _bindGlobal() {
    document.addEventListener('keydown', (e) => {
      // ⌘/Ctrl + Enter → 运行
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        this.run();
        return;
      }
      // Shift + Alt + F → 格式化（VS Code / Prettier 同款快捷键）
      // 用 e.code 判断：macOS 上 Option 组合键会改写 e.key
      if (e.shiftKey && e.altKey && e.code === 'KeyF') {
        e.preventDefault();
        this.formatSql();
      }
    });
  },
};

/* ==========================================================================
   用户设置
   --------------------------------------------------------------------------
   存在 localStorage，与闯关进度分开存。所有项都有默认值，读不到就用默认。
   ========================================================================== */
const SETTINGS_KEY = 'sql-quest-settings-v1';

const Settings = {
  defaults: {
    theme: 'dark',            // dark | light
    starterFormatted: true,   // 进关时起始代码是否格式化后再显示
    autocomplete: true,       // 输入时自动补全
    syntaxHighlight: true,    // 编辑器语法着色
    schemaFocus: true,        // 右栏是否跟随当前关卡的表
  },

  data: null,

  load() {
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
    } catch { /* 隐私模式：用默认值 */ }
    this.data = Object.assign({}, this.defaults, saved);
    return this.data;
  },

  get(key) {
    return (this.data || this.defaults)[key];
  },

  set(key, value) {
    this.data[key] = value;
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.data));
    } catch { /* 忽略 */ }
    this.apply(key);
  },

  reset() {
    this.data = Object.assign({}, this.defaults);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.data));
    } catch { /* 忽略 */ }
    this.applyAll();
  },

  applyAll() {
    this.applyTheme();
    this.syncControls();
    if (window.Autocomplete) {
      Autocomplete.enabled = this.get('autocomplete');
      if (!Autocomplete.enabled) Autocomplete.hide();
    }
    if (window.Highlighter) {
      Highlighter.enabled = this.get('syntaxHighlight');
      refreshHighlight();
    }
    if (App.current) {
      renderWork();
      if (this.get('schemaFocus')) focusSchemaOn(App.levelTables());
    }
  },

  apply(key) {
    if (key === 'theme' || !key) this.applyTheme();
    if (key === 'autocomplete' || !key) {
      if (window.Autocomplete) {
        Autocomplete.enabled = this.get('autocomplete');
        if (!Autocomplete.enabled) Autocomplete.hide();
      }
    }
    if (key === 'syntaxHighlight' || !key) {
      if (window.Highlighter) {
        Highlighter.enabled = this.get('syntaxHighlight');
        refreshHighlight();
      }
    }
    if (key === 'starterFormatted') {
      // 只影响「还没写过草稿」的关卡
      if (App.current && !hasDraft(App.current.id)) renderWork();
    }
    if (key === 'schemaFocus') {
      if (this.get('schemaFocus') && App.current) focusSchemaOn(App.levelTables());
    }
    this.syncControls();
  },

  applyTheme() {
    const t = this.get('theme') === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', t);
  },

  /** 把当前设置反映到面板控件上 */
  syncControls() {
    const set = (sel, attr, val, on) =>
      document.querySelectorAll(sel).forEach((el) => el.setAttribute(attr, String(el.dataset[val] === on)));
    set('[data-theme-pick]', 'aria-checked', 'themePick', this.get('theme'));
    set('[data-starter-pick]', 'aria-checked', 'starterPick', this.get('starterFormatted') ? 'formatted' : 'raw');
    set('[data-ac-pick]', 'aria-checked', 'acPick', this.get('autocomplete') ? 'on' : 'off');
    set('[data-hl-pick]', 'aria-checked', 'hlPick', this.get('syntaxHighlight') ? 'on' : 'off');
    set('[data-focus-pick]', 'aria-checked', 'focusPick', this.get('schemaFocus') ? 'on' : 'off');
  },
};

const hasDraft = (id) =>
  App.state.drafts && App.state.drafts[id] !== undefined && App.state.drafts[id] !== '';

/** 起始代码：按设置决定是否先格式化再放进编辑器 */
function starterText(level, text) {
  if (!text || !Settings.get('starterFormatted') || !window.SqlFormatter) return text;
  try {
    return window.SqlFormatter
      .formatSqlite(text, { keywordCase: 'upper', tabWidth: 2 })
      .replace(/\s+$/, '');
  } catch {
    return text;   // 起始代码本身不完整时，原样显示
  }
}

function openSettings() {
  Settings.syncControls();
  document.getElementById('settings').hidden = false;
}

function closeSettings() {
  const el = document.getElementById('settings');
  if (el) el.hidden = true;
}


/* ---------------------------------------------------------------- 工具 */
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

/** 极简 markdown：**粗体** 与 `代码` */
function md(s) {
  return esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
}

function setStatus(text, isErr) {
  const el = document.getElementById('boot-status');
  if (el) {
    el.textContent = text;
    if (isErr) el.classList.add('err');
  }
}

/** 编辑器随内容自动增高（4 行起步，最多 26 行后转为内部滚动） */
/** 重画编辑器底层的高亮层（textarea 的文字是透明的，看到的就是这一层） */
function refreshHighlight() {
  const ed = document.getElementById('editor');
  const hl = document.getElementById('hl');
  if (!ed || !hl) return;
  if (window.Highlighter) Highlighter.renderInto(hl, ed.value);
  hl.scrollTop = ed.scrollTop;
}

/**
 * 编辑器高度随内容增长。
 * 行高从计算样式里读，不写死数值 —— 字号一调整这里就得跟着改，太容易漏。
 */
function autoGrow(ed) {
  const cs = getComputedStyle(ed);
  const line = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.7 || 24;
  const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  const MIN = Math.round(line * 4 + pad);    // 至少 4 行高
  const MAX = Math.round(line * 30 + pad);   // 超过 30 行转为内部滚动

  ed.style.height = 'auto';
  const need = ed.scrollHeight;
  ed.style.height = Math.min(Math.max(need, MIN), MAX) + 'px';
  ed.style.overflowY = need > MAX ? 'auto' : 'hidden';

  // 高度可能刚变化，底层高亮层的滚动位置跟着同步
  const hl = document.getElementById('hl');
  if (hl) hl.scrollTop = ed.scrollTop;
}

/** 整体替换编辑器内容。走 execCommand 以保留浏览器原生撤销栈（⌘Z 可回退） */
function setEditorText(ed, text) {
  ed.focus();
  ed.setSelectionRange(0, ed.value.length);
  const ok = document.execCommand && document.execCommand('insertText', false, text);
  if (!ok) {
    ed.value = text;
    ed.dispatchEvent(new Event('input', { bubbles: true }));
  }
  ed.setSelectionRange(text.length, text.length);
  autoGrow(ed);
}

function icon(name, size = 16) {
  const p = {
    check: '<path d="M20 6L9 17l-5-5"/>',
    play: '<path d="M5 3l14 9-14 9V3z"/>',
    bulb: '<path d="M9 18h6M10 22h4M12 2a7 7 0 00-4 12.7V17h8v-2.3A7 7 0 0012 2z"/>',
    eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
    rotate: '<path d="M3 12a9 9 0 109-9 9 9 0 00-6.4 2.6L3 8"/><path d="M3 3v5h5"/>',
    db: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5"/><path d="M3 12c0 1.7 4 3 9 3s9-1.3 9-3"/>',
    chev: '<path d="M9 18l6-6-6-6"/>',
    alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
    sparkle: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    expand: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
    close: '<path d="M18 6L6 18M6 6l12 12"/>',
    format: '<path d="M3 6h18M3 12h12M3 18h15"/>',
  }[name] || '';
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round"
    stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}

/* ------------------------------------------------------------ 关卡列表 */
function renderLevels() {
  const done = App.state.done;
  const cur = App.current ? App.current.id : null;

  let html = '';
  for (const ch of App.chapters) {
    const n = ch.levels.filter((l) => done[l.id]).length;
    const all = n === ch.levels.length;
    html += `<div class="chapter">
      <div class="chapter-head">
        <span class="chapter-name">${esc(ch.title)}</span>
        <span class="chapter-count ${all ? 'done' : ''}">${n}/${ch.levels.length}</span>
      </div>
      <div class="chapter-desc">${esc(ch.desc)}</div>`;

    for (const lv of ch.levels) {
      const cls = [
        'level-item',
        done[lv.id] ? 'done' : '',
        lv.id === cur ? 'active' : '',
      ].join(' ');
      html += `<button class="${cls}" data-level="${lv.id}">
        <span class="level-dot">${done[lv.id] ? icon('check', 11) : ''}</span>
        <span class="level-name">${esc(lv.title)}</span>
      </button>`;
    }
    html += '</div>';
  }

  const box = document.getElementById('levels-scroll');
  box.innerHTML = html;
  box.querySelectorAll('[data-level]').forEach((b) =>
    b.addEventListener('click', () => App.open(b.dataset.level))
  );

  renderProgress();
}

function renderProgress() {
  const total = App.flat.length;
  const n = App.flat.filter((l) => App.isDone(l.id)).length;
  const pct = total ? (n / total) * 100 : 0;

  document.getElementById('progress-num').innerHTML =
    `${n}<span class="dim"> / ${total}</span>`;
  document.getElementById('progress-fill').style.width = pct + '%';
  document.getElementById('progress-label').textContent =
    n === total ? '全部通关' : `已完成 ${Math.round(pct)}%`;

  const allDone = n === total;
  document.getElementById('finish-banner').classList.toggle('show', allDone);
}

/* ------------------------------------------------------------ 练习区 */
function renderWork() {
  const lv = App.current;
  const ch = lv._chapter;
  const done = App.isDone(lv.id);
  // 写过草稿就恢复草稿；没有则用起始代码（按设置决定是否先格式化）
  const saved = App.state.drafts && App.state.drafts[lv.id];
  const draft = saved !== undefined ? saved : starterText(lv, lv.starter || '');

  document.getElementById('work-inner').innerHTML = `
    <div class="level-head ${done ? 'is-done' : ''}" id="level-head">
      <div class="level-kicker">
        <span>${esc(ch.title)}</span>
        <span class="sep">/</span>
        <span>第 ${lv._index + 1} 关，共 ${App.flat.length} 关</span>
      </div>
      <h1 class="level-title">
        ${esc(lv.title)}
        <span class="level-done-tag">${icon('check', 12)} 已通关</span>
      </h1>
      <div class="brief">${md(lv.brief)}</div>
      ${
        lv.hint
          ? `<div class="hint-box" id="hint-box">${icon('bulb', 15)}
               <div>${md(lv.hint)}</div></div>`
          : ''
      }
    </div>

    <div class="editor-block">
      <div class="block-label">
        <span>写你的 SQL</span>
        <span class="spacer"></span>
        <span class="hintkey">⌘ + Enter 运行</span>
      </div>
      <div class="editor-shell" id="editor-shell">
        <div class="editor-stack">
          <!-- 底层：语法高亮。textarea 的文字是透明的，看到的就是这一层 -->
          <pre class="hl" id="hl" aria-hidden="true"></pre>
          <textarea id="editor" spellcheck="false" autocomplete="off"
            autocapitalize="off" autocorrect="off"
            placeholder="-- 在这里写 SQL"></textarea>
        </div>
      </div>
      <div class="actions">
        <button class="btn btn-primary" id="btn-run">
          ${icon('play', 13)} 运行 <span class="kbd">⌘↵</span>
        </button>
        <button class="btn" id="btn-format" title="把 SQL 排版成规范格式（Shift + Option + F）">
          ${icon('format', 14)} 格式化
        </button>
        ${
          lv.hint
            ? `<button class="btn" id="btn-hint">${icon('bulb', 14)} 提示</button>`
            : ''
        }
        <button class="btn" id="btn-answer">${icon('eye', 14)} 参考答案</button>
        <button class="btn btn-ghost" id="btn-reset">${icon('rotate', 14)} 重置本关</button>
        <span class="spacer"></span>
        <button class="btn btn-ghost" id="btn-next">下一关 ${icon('arrow', 14)}</button>
      </div>
    </div>

    <div class="result-block">
      <div class="verdict" id="verdict"></div>
      <div class="diff-block" id="diff-block">
        <div class="diff-head">差异对比</div>
        <div class="diff-body" id="diff-body"></div>
      </div>
      <div id="table-slot"></div>

      <details class="ref" id="ref-answer">
        <summary>
          <span class="chev">${icon('chev', 13)}</span>
          参考答案
          <span class="spacer"></span>
          <span style="color:var(--muted);font-size:11px">先自己想，卡住了再看</span>
        </summary>
        <div class="ref-body">
          <pre class="code">${esc(lv.solution)}</pre>
        </div>
      </details>
    </div>
  `;

  const ed = document.getElementById('editor');
  ed.value = draft;
  refreshHighlight();
  autoGrow(ed);
  ed.focus();
  ed.setSelectionRange(ed.value.length, ed.value.length);

  // 编辑器每次切关都会被重建，监听器必须在这里绑（不能只绑一次）
  ed.addEventListener('input', () => {
    App.state.drafts[App.current.id] = ed.value;
    Store.save(App.state);
    refreshHighlight();
    autoGrow(ed);
    document.getElementById('editor-shell').classList.remove('is-err');
    // 用户已经在编辑了，取消「通关后自动跳下一关」
    clearTimeout(App._advanceTimer);
    // 右栏跟着他写的表走（去抖，避免每个字符都重排）
    clearTimeout(App._focusTimer);
    if (Settings.get('schemaFocus')) {
      App._focusTimer = setTimeout(() => focusSchemaOn(App.levelTables()), 380);
    }
  });
  // Tab 键插入两个空格而不是跳出输入框
  // 补全弹层打开时 Tab 是「选中候选」，这里必须让路
  ed.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    if (window.Autocomplete && Autocomplete.isOpen()) return;
    e.preventDefault();
    const s = ed.selectionStart, t = ed.selectionEnd;
    ed.value = ed.value.slice(0, s) + '  ' + ed.value.slice(t);
    ed.selectionStart = ed.selectionEnd = s + 2;
    App.state.drafts[App.current.id] = ed.value;
    Store.save(App.state);
    autoGrow(ed);
  });

  // 编辑器内部滚动时，底层高亮层要跟着走，否则文字会错位
  ed.addEventListener('scroll', () => {
    const hl = document.getElementById('hl');
    if (hl) hl.scrollTop = ed.scrollTop;
  });

  // SQL 自动补全：关键字 / 函数 / 表名 / 列名
  if (window.Autocomplete) Autocomplete.attach(ed);

  // 右栏跟随本关涉及的表。
  // 关闭跟随时要给一个干净起点（只留第一张表展开）—— 否则会残留上一关的表，
  // 看起来像是「跟随没关掉」。
  if (Settings.get('schemaFocus')) {
    focusSchemaOn(App.levelTables());
  } else {
    resetSchemaView();
  }

  document.getElementById('btn-run').addEventListener('click', () => App.run());
  document.getElementById('btn-format').addEventListener('click', () => App.formatSql());
  document.getElementById('btn-answer').addEventListener('click', () => App.showAnswer());
  document.getElementById('btn-reset').addEventListener('click', () => App.resetLevel());
  document.getElementById('btn-next').addEventListener('click', () => App.next());
  const bh = document.getElementById('btn-hint');
  if (bh) bh.addEventListener('click', () => App.showHint());
}

function renderWorkStats() {
  const head = document.getElementById('level-head');
  if (head) head.classList.add('is-done');
}

/** 右栏顶部显示当前关卡用的是哪套数据库 */
function updateDatasetBadge() {
  const el = document.getElementById('dataset-badge');
  if (!el) return;
  const info = Engine.info();
  el.textContent = info.label;
  el.title = `${info.label} · ${info.desc}`;
}

/* ------------------------------------------------------------ 表结构 */
let SCHEMA_CACHE = null;

function renderSchema() {
  SCHEMA_CACHE = Engine.schema();
  // 表名要参与语法着色，表结构变了就同步过去
  if (window.Highlighter) Highlighter.setSchema(SCHEMA_CACHE);
  const box = document.getElementById('schema-scroll');

  let html = '';
  for (const t of SCHEMA_CACHE) {
    html += `<div class="tbl" data-tbl="${esc(t.name)}">
      <button class="tbl-head">
        <span class="chev">${icon('chev', 13)}</span>
        <span class="tbl-name">${esc(t.name)}</span>
        <span class="tbl-rows">${t.rows} 行</span>
      </button>
      <div class="tbl-body"></div>
    </div>`;
  }
  html += `<div class="schema-tip">
    点表名展开字段和真实数据。<code>PK</code> 是主键，<code>FK</code> 是外键 ——
    外键指向另一张表的主键，JOIN 就是靠它把表连起来的。
  </div>`;

  box.innerHTML = html;

  box.querySelectorAll('.tbl-head').forEach((b) =>
    b.addEventListener('click', () => {
      const wrap = b.parentElement;
      const opened = wrap.classList.toggle('open');
      if (opened) fillTableBody(wrap);
    })
  );
  // 展开哪张表交给 open() → focusSchemaOn / resetSchemaView 决定，
  // 这里不预设，避免首屏闪一下再跳走。
}

/**
 * 让右栏聚焦到指定的一批表：把它们展开、其余收起，并滚动到第一张。
 * 表不存在或列表为空时什么都不做（保留用户当前的手动展开状态）。
 */
function focusSchemaOn(tables) {
  const box = document.getElementById('schema-scroll');
  if (!box) return;
  // 拿不到涉及的表（比如关卡还没写 FROM）就退回第一张，别让右栏空着
  if (!tables || !tables.length) return resetSchemaView();

  const set = new Set(tables);
  const wraps = [...box.querySelectorAll('.tbl')];
  let firstHit = null;

  for (const wrap of wraps) {
    const on = set.has(wrap.dataset.tbl);
    wrap.classList.toggle('open', on);
    if (on) {
      fillTableBody(wrap);
      if (!firstHit) firstHit = wrap;
    }
  }

  if (firstHit) {
    // 只滚动右栏自己的滚动容器，不影响主页面
    const top = firstHit.offsetTop - box.offsetTop;
    box.scrollTo({ top: Math.max(0, top - 8), behavior: 'smooth' });
  }
}

/**
 * 重置右栏到「未跟随」的中性状态：只展开第一张表。
 * 用于关闭「右栏跟随」后切关，避免残留上一关的展开状态。
 */
function resetSchemaView() {
  const box = document.getElementById('schema-scroll');
  if (!box) return;
  box.querySelectorAll('.tbl').forEach((wrap, i) => {
    wrap.classList.toggle('open', i === 0);
    if (i === 0) fillTableBody(wrap);
  });
  box.scrollTo({ top: 0 });
}

/** 把某张表的字段定义 + 真实数据填进已展开的容器 */
function fillTableBody(wrap) {
  const name = wrap.dataset.tbl;
  const meta = SCHEMA_CACHE.find((t) => t.name === name);
  const body = wrap.querySelector('.tbl-body');
  if (!meta || !body) return;

  const data = Engine.tableData(name, 12);

  // 行数实时刷新（第 8 章改过数据后要跟着变）
  const rowsEl = wrap.querySelector('.tbl-rows');
  if (rowsEl) rowsEl.textContent = data.total + ' 行';

  body.innerHTML = `
    <div class="cols-block">
      ${meta.cols
        .map(
          (c) => `<div class="col-row">
            <span class="col-name">${esc(c.name)}</span>
            ${c.pk ? '<span class="col-flag">PK</span>' : ''}
            ${c.fk ? '<span class="col-flag fk">FK</span>' : ''}
            <span class="col-type">${esc(c.type)}</span>
          </div>`
        )
        .join('')}
    </div>
    <div class="data-block">
      <div class="data-head">
        <span>实际数据</span>
        <span class="spacer"></span>
        <button class="mini-btn" data-zoom="${esc(name)}">
          ${icon('expand', 11)} 放大
        </button>
      </div>
      ${grid(data, { compact: true })}
      <div class="data-foot">
        显示 ${data.values.length} 行 / 共 ${data.total} 行
      </div>
    </div>`;

  const zoom = body.querySelector('[data-zoom]');
  if (zoom) {
    zoom.addEventListener('click', (e) => {
      e.stopPropagation();
      openTableModal(name);
    });
  }
  body.dataset.filled = '1';
}

/** DML 执行后刷新右侧行数与已展开的数据 */
function refreshSchemaRows() {
  const box = document.getElementById('schema-scroll');
  if (!box) return;
  box.querySelectorAll('.tbl').forEach((wrap) => {
    const n = Engine.count(wrap.dataset.tbl);
    const el = wrap.querySelector('.tbl-rows');
    if (el) el.textContent = n + ' 行';
    if (wrap.classList.contains('open')) fillTableBody(wrap);
  });
}

/* ---------------------------------------------------------- 通用表格 */
/** 把结果集渲染成表格 HTML（右侧预览与放大浮层共用） */
/**
 * 渲染结果表格（只返回 <table>，滚动容器交给调用方）。
 *
 * 两个踩过的坑：
 *  1. 数字右对齐、表头却左对齐 → 表头与数据错位（实测第一列文字差 57px）。
 *     所以先按列判断是不是数值列，给 th 和 td 加同一个 class，保证同一种对齐。
 *  2. 表格 width:100% 时，多余空间按比例摊给每一列，短列（id）会被撑得很宽；
 *     而 max-width 在 table cell 上根本不生效（实测 title 360px > 设定的 320px）。
 *     所以数值列收缩到内容宽，末尾补一个吸收剩余宽度的空列，
 *     长文本的截断交给内层 span。
 */
function gridTable(res, opts = {}) {
  const rows = opts.limit ? res.values.slice(0, opts.limit) : res.values;
  if (!rows.length) return `<div class="empty-note sm">这张表里还没有数据</div>`;

  // 数值列 = 该列所有非空值都是数字
  const numeric = res.columns.map((_, i) => {
    let seen = false;
    for (const r of rows) {
      const v = r[i];
      if (v === null || v === undefined) continue;
      seen = true;
      if (typeof v !== 'number') return false;
    }
    return seen;
  });

  // 让**最后一个文本列**吸收剩余宽度 —— 文本列变宽只有好处（能多显示内容），
  // 数值列变宽只会让数字贴着右边、中间空一大截。
  // 整张表全是数值列时，退化为末尾补一个空列来吸收。
  let flexIdx = -1;
  for (let i = res.columns.length - 1; i >= 0; i--) {
    if (!numeric[i]) { flexIdx = i; break; }
  }

  const head =
    res.columns
      .map((c, i) => {
        const cls = [numeric[i] ? 'num' : 'txt', i === flexIdx ? 'flex' : ''].filter(Boolean).join(' ');
        return `<th class="${cls}">${esc(c)}</th>`;
      })
      .join('') + (flexIdx < 0 ? '<th class="fill"></th>' : '');

  const body = rows
    .map(
      (row) =>
        '<tr>' +
        row
          .map((v, i) => {
            const num = numeric[i] ? ' num' : '';
            if (v === null) return `<td class="null${num}">NULL</td>`;
            if (typeof v === 'number') return `<td class="num">${esc(fmtNum(v))}</td>`;
            return `<td class="txt" title="${esc(v)}"><span class="cell">${esc(v)}</span></td>`;
          })
          .join('') +
        (flexIdx < 0 ? '<td class="fill"></td>' : '') +
        '</tr>'
    )
    .join('');

  return `<table class="grid${opts.compact ? ' compact' : ''}">
    <thead><tr>${head}</tr></thead><tbody>${body}</tbody>
  </table>`;
}

/** 带滚动容器的版本，给右栏预览用 */
function grid(res, opts = {}) {
  if (!res.values || !res.values.length) {
    return `<div class="empty-note sm">这张表里还没有数据</div>`;
  }
  return `<div class="grid-scroll">${gridTable(res, opts)}</div>`;
}

/* -------------------------------------------------------- 放大浮层 */
function openTableModal(name) {
  const data = Engine.tableData(name, 500);
  const modal = document.getElementById('modal');
  modal.querySelector('.modal-title').textContent = name;
  modal.querySelector('.modal-meta').textContent =
    `${data.total} 行 × ${data.columns.length} 列` +
    (data.total > data.values.length ? `　（显示前 ${data.values.length} 行）` : '');
  // 用 gridTable 而不是 grid：modal-body 本身就是滚动容器，
  // 再套一层 .grid-scroll（有 max-height）会变成嵌套滚动
  modal.querySelector('.modal-body').innerHTML = gridTable(data);
  modal.hidden = false;
  modal.querySelector('.modal-close').focus();
}

function closeTableModal() {
  const modal = document.getElementById('modal');
  if (modal) modal.hidden = true;
}

/* ------------------------------------------------------------ 结果展示 */
function showVerdict(kind, title, body) {
  const v = document.getElementById('verdict');
  const ic = kind === 'ok' ? 'check' : kind === 'err' ? 'alert' : 'db';
  v.className = 'verdict show ' + kind;
  v.innerHTML = `${icon(ic, 17)}<div><span class="vtitle">${esc(title)}</span>${body}</div>`;
}

function hideVerdict() {
  const v = document.getElementById('verdict');
  if (v) v.className = 'verdict';
}

function hideTable() {
  const s = document.getElementById('table-slot');
  if (s) s.innerHTML = '';
  const d = document.getElementById('diff-block');
  if (d) d.classList.remove('show');
}

function renderTable(res, label) {
  const slot = document.getElementById('table-slot');
  if (!slot) return;

  if (!res.values.length) {
    slot.innerHTML = `<div class="table-wrap">
      <div class="empty-note">查询没有返回任何行</div></div>`;
    return;
  }

  slot.innerHTML = `<div class="block-label" style="margin-top:4px">
      <span>${esc(label)}</span>
    </div>
    <div class="table-wrap">
      ${gridTable(res, { limit: 200 })}
      <div class="table-meta">
        <span>${res.values.length} 行</span>
        <span>·</span>
        <span>${res.columns.length} 列</span>
        ${res.values.length > 200 ? '<span class="spacer"></span><span>仅显示前 200 行</span>' : ''}
      </div>
    </div>`;
}

function fmtNum(n) {
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 1e6) / 1e6);
}

function renderDiff(verdict, expect) {
  const block = document.getElementById('diff-block');
  const body = document.getElementById('diff-body');
  if (!block || !body) return;

  const miss = verdict.missing || [];
  const extra = verdict.extra || [];

  if (!miss.length && !extra.length) {
    block.classList.remove('show');
    return;
  }

  let html = '';
  if (miss.length) {
    html += `<div class="diff-more" style="padding-top:8px">期望有、但你的结果里没有：</div>`;
    html += miss
      .slice(0, 6)
      .map(
        (r) =>
          `<div class="diff-row miss"><span class="diff-sign">−</span><span>${esc(
            r.map(fmtCell).join('  |  ')
          )}</span></div>`
      )
      .join('');
    if (verdict.missingTotal > 6)
      html += `<div class="diff-more">…还有 ${verdict.missingTotal - 6} 行</div>`;
  }
  if (extra.length) {
    html += `<div class="diff-more" style="padding-top:8px">你的结果里有、但期望没有：</div>`;
    html += extra
      .slice(0, 6)
      .map(
        (r) =>
          `<div class="diff-row extra"><span class="diff-sign">+</span><span>${esc(
            r.map(fmtCell).join('  |  ')
          )}</span></div>`
      )
      .join('');
    if (verdict.extraTotal > 6)
      html += `<div class="diff-more">…还有 ${verdict.extraTotal - 6} 行</div>`;
  }

  body.innerHTML = html;
  block.classList.add('show');
}

function fmtCell(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return fmtNum(v);
  return String(v);
}

/* ------------------------------------------------------------ 移动端 */
function markMobileTab(which) {
  document.querySelectorAll('.mobile-tabs button').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === which);
  });
  const map = { levels: '.levels-panel', work: '.work-panel', schema: '.schema-panel' };
  Object.entries(map).forEach(([k, sel]) => {
    document.querySelector(sel).classList.toggle('mobile-active', k === which);
  });
}

/* ------------------------------------------------------------ Toast */
function toast(text, kind = 'check') {
  const layer = document.getElementById('toast-layer');
  const el = document.createElement('div');
  el.className = 'toast' + (kind === 'alert' ? ' alert' : '');
  const ic = { alert: 'alert', sparkle: 'sparkle', refresh: 'rotate', format: 'format' }[kind] || 'check';
  el.innerHTML = icon(ic, 15) + `<span>${esc(text)}</span>`;
  layer.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 300);
  }, 2200);
}

// 暴露到 window：便于自动化测试读取状态，也方便在控制台排查
window.App = App;
window.Engine = Engine;
window.Settings = Settings;

/* ------------------------------------------------------------ 启动 */
window.addEventListener('DOMContentLoaded', () => {
  Settings.load();
  Settings.applyTheme();      // 尽早应用，避免深色闪一下再变浅色
  App.state.drafts = App.state.drafts || {};
  App.boot();

  document.querySelectorAll('.mobile-tabs button').forEach((b) =>
    b.addEventListener('click', () => markMobileTab(b.dataset.tab))
  );
  const rb = document.getElementById('btn-reset-all');
  if (rb) rb.addEventListener('click', () => App.resetAll());

  // 表数据浮层：点遮罩 / 点关闭 / 按 Esc 都能关
  const modal = document.getElementById('modal');
  modal.querySelectorAll('[data-close]').forEach((el) =>
    el.addEventListener('click', closeTableModal)
  );
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const settings = document.getElementById('settings');
    if (!settings.hidden) return closeSettings();
    if (!modal.hidden) closeTableModal();
  });

  /* ---------------------------------------------------------- 设置面板 */
  const panel = document.getElementById('settings');
  document.getElementById('btn-settings').addEventListener('click', openSettings);
  panel.querySelectorAll('[data-close-settings]').forEach((el) =>
    el.addEventListener('click', closeSettings)
  );
  panel.querySelectorAll('[data-theme-pick]').forEach((b) =>
    b.addEventListener('click', () => Settings.set('theme', b.dataset.themePick))
  );
  panel.querySelectorAll('[data-starter-pick]').forEach((b) =>
    b.addEventListener('click', () =>
      Settings.set('starterFormatted', b.dataset.starterPick === 'formatted')
    )
  );
  panel.querySelectorAll('[data-ac-pick]').forEach((b) =>
    b.addEventListener('click', () => Settings.set('autocomplete', b.dataset.acPick === 'on'))
  );
  panel.querySelectorAll('[data-focus-pick]').forEach((b) =>
    b.addEventListener('click', () => Settings.set('schemaFocus', b.dataset.focusPick === 'on'))
  );
  panel.querySelectorAll('[data-hl-pick]').forEach((b) =>
    b.addEventListener('click', () => Settings.set('syntaxHighlight', b.dataset.hlPick === 'on'))
  );
  document.getElementById('btn-settings-reset').addEventListener('click', () => {
    Settings.reset();
    toast('设置已恢复默认', 'refresh');
  });
});
