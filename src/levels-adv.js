/* ==========================================================================
   进阶题库 —— 校园选课系统
   --------------------------------------------------------------------------
   难度说明：不涉及冷门语法，全部是基础指令的组合运用。
   难点在三处：
     1. 表多、关系深 —— 要自己想清楚「从哪张表出发、怎么连过去」
     2. 需要拆步骤 —— 多数题要先算中间结果，再基于它算最终答案
     3. 边界情况 —— NULL、除零、无记录的分组、并列名次

   每关字段说明见 src/levels.js 顶部注释。
   ========================================================================== */

window.ADV_CHAPTERS = [
  /* ==================================================================== */
  {
    id: 'adv1',
    title: '进阶 · 多表穿梭',
    desc: '在 5 张表之间找到正确的连接路径',
    dataset: 'campus',
    levels: [
      {
        id: 'a-1',
        title: '课程全貌',
        brief:
          '列出每门课的**课程代码**（列名 `code`）、**课程名**（`name`）、' +
          '**开课院系名**（`dept_name`）和**任课教师名**（`teacher_name`）。\n' +
          '按 `code` 排序。',
        starter: 'SELECT c.code, c.name,\n       ',
        solution:
          'SELECT c.code, c.name, d.name AS dept_name, t.name AS teacher_name ' +
          'FROM courses c ' +
          'JOIN departments d ON d.id = c.dept_id ' +
          'JOIN teachers t ON t.id = c.teacher_id ' +
          'ORDER BY c.code;',
        compare: 'ordered',
        require: [['两个 JOIN', /\bjoin\b[\s\S]*\bjoin\b/i], ['ORDER BY', /\border\s+by\b/i]],
        hint: '`courses` 上有两个外键：`dept_id` 指向院系，`teacher_id` 指向教师。两次 JOIN 分别连过去。',
      },
      {
        id: 'a-2',
        title: '每门课多少人选',
        brief:
          '统计**每门课**的选课人数（列名 `student_count`），返回 `code`、`name` 和人数。\n' +
          '**没人选的课也要出现，人数为 0。** 按人数从多到少排。',
        starter: 'SELECT c.code, c.name, COUNT(e.id) AS student_count\nFROM courses c\n',
        solution:
          'SELECT c.code, c.name, COUNT(e.id) AS student_count ' +
          'FROM courses c LEFT JOIN enrollments e ON e.course_id = c.id ' +
          'GROUP BY c.id, c.code, c.name ORDER BY student_count DESC;',
        compare: 'ordered',
        require: [['LEFT JOIN', /\bleft\s+join\b/i], ['COUNT(e.id)', /\bcount\s*\(\s*e\./i]],
        hint: '用 `LEFT JOIN` 保留所有课程；计数要用 `COUNT(e.id)`，用 `COUNT(*)` 会把没人选的课算成 1。',
      },
      {
        id: 'a-3',
        title: '忙不过来的老师',
        brief:
          '找出**授课门数超过 1 门**的教师，返回教师名（列名 `teacher_name`）和课程数（列名 `course_count`）。\n' +
          '按课程数从多到少排。',
        starter: 'SELECT t.name AS teacher_name, COUNT(*) AS course_count\nFROM teachers t\n',
        solution:
          'SELECT t.name AS teacher_name, COUNT(*) AS course_count ' +
          'FROM teachers t JOIN courses c ON c.teacher_id = t.id ' +
          'GROUP BY t.id, t.name HAVING COUNT(*) > 1 ORDER BY course_count DESC;',
        compare: 'ordered',
        require: [['HAVING', /\bhaving\b/i], ['JOIN', /\bjoin\b/i]],
        hint: '「超过 1 门」是对**分组结果**的筛选，所以用 `HAVING` 而不是 `WHERE`。',
      },
      {
        id: 'a-4',
        title: '先修链',
        brief:
          '查出**有先修课**的课程：返回课程名（列名 `name`）和它的**先修课名**（列名 `prereq_name`）。\n' +
          '按课程 `code` 排序。',
        starter: 'SELECT c.name, ',
        solution:
          'SELECT c.name, p.name AS prereq_name ' +
          'FROM courses c JOIN courses p ON p.id = c.prereq_id ' +
          'ORDER BY c.code;',
        compare: 'ordered',
        require: [['自连接', /from\s+courses\s+\w+[\s\S]*join\s+courses/i]],
        hint: '`courses` 的 `prereq_id` 指向**同一张表**的 `id`。给同一张表起两个别名（`c` 和 `p`）再 JOIN 自己。',
      },
    ],
  },

  /* ==================================================================== */
  {
    id: 'adv2',
    title: '进阶 · 分组与排名',
    desc: '窗口函数、并列名次、分组内取前几',
    dataset: 'campus',
    levels: [
      {
        id: 'a-5',
        title: '各院系课程数排名',
        brief:
          '统计每个院系的课程数（列名 `course_count`），并按课程数从多到少给出名次（列名 `rk`）。\n' +
          '返回 `name`（院系名）、`course_count`、`rk`，按 `rk` 排序。',
        starter: 'SELECT d.name, COUNT(c.id) AS course_count,\n       ',
        solution:
          'SELECT d.name, COUNT(c.id) AS course_count, ' +
          'RANK() OVER (ORDER BY COUNT(c.id) DESC) AS rk ' +
          'FROM departments d LEFT JOIN courses c ON c.dept_id = d.id ' +
          'GROUP BY d.id, d.name ORDER BY rk;',
        compare: 'ordered',
        require: [['OVER()', /over\s*\(/i], ['GROUP BY', /\bgroup\s+by\b/i]],
        hint: '窗口函数可以写在聚合查询里，`ORDER BY COUNT(c.id) DESC` 就是对聚合后的值排名。名次有并列时用 `RANK()` 而不是 `ROW_NUMBER()`。',
      },
      {
        id: 'a-6',
        title: '每门课的前三名',
        brief:
          '找出**每门课成绩最高的 3 名**学生：返回课程代码（`code`）、学生名（`student_name`）、成绩（`score`）。\n' +
          '只要**已修完且有成绩**的记录。按 `code`、成绩从高到低排序。',
        starter:
          'WITH ranked AS (\n  SELECT c.code, s.name AS student_name, e.score,\n         ',
        solution:
          'WITH ranked AS (SELECT c.code, s.name AS student_name, e.score, ' +
          'ROW_NUMBER() OVER (PARTITION BY c.id ORDER BY e.score DESC) AS rn ' +
          "FROM enrollments e JOIN courses c ON c.id = e.course_id " +
          "JOIN students s ON s.id = e.student_id WHERE e.status = '已修完' AND e.score IS NOT NULL) " +
          'SELECT code, student_name, score FROM ranked WHERE rn <= 3 ORDER BY code, score DESC;',
        compare: 'ordered',
        require: [['PARTITION BY', /partition\s+by/i], ['WITH', /\bwith\b/i]],
        hint: '先用窗口函数在**每门课内部**编号（`PARTITION BY c.id`），再在外层筛 `rn <= 3`。窗口函数不能直接写在 `WHERE` 里，所以要套一层 CTE。',
      },
      {
        id: 'a-7',
        title: '高于本院系平均分',
        brief:
          '找出**成绩高于本课程平均分**的记录：返回课程代码（`code`）、学生名（`student_name`）、成绩（`score`）。\n' +
          '只要已修完且有成绩的。按 `code`、`score` 从高到低排。',
        starter: 'SELECT c.code, s.name AS student_name, e.score\nFROM enrollments e\n',
        solution:
          'SELECT c.code, s.name AS student_name, e.score ' +
          'FROM enrollments e JOIN courses c ON c.id = e.course_id ' +
          'JOIN students s ON s.id = e.student_id ' +
          "WHERE e.status = '已修完' AND e.score IS NOT NULL " +
          'AND e.score > (SELECT AVG(e2.score) FROM enrollments e2 WHERE e2.course_id = e.course_id AND e2.score IS NOT NULL) ' +
          'ORDER BY c.code, e.score DESC;',
        compare: 'ordered',
        require: [['相关子查询', /\(\s*select[\s\S]*e\.course_id/i]],
        hint: '子查询里要写 `WHERE e2.course_id = e.course_id`，让平均值**跟着外层每一行**变成该课程的平均分。',
      },
    ],
  },

  /* ==================================================================== */
  {
    id: 'adv3',
    title: '进阶 · 组合与递归',
    desc: '集合运算、递归 CTE、行列转换',
    dataset: 'campus',
    levels: [
      {
        id: 'a-8',
        title: '一门课都没选的学生',
        brief:
          '找出**从未选过任何课**的学生，返回学生名（`name`）和学号（`id`）。按 `id` 排序。\n' +
          '这一关的数据里确实有这样的学生。',
        starter: 'SELECT s.id, s.name\nFROM students s\n',
        solution:
          'SELECT s.id, s.name FROM students s ' +
          'WHERE NOT EXISTS (SELECT 1 FROM enrollments e WHERE e.student_id = s.id) ' +
          'ORDER BY s.id;',
        compare: 'ordered',
        require: [['NOT EXISTS 或 LEFT JOIN', /not\s+exists|left\s+join/i]],
        hint: '`NOT EXISTS (子查询)` 表示「子查询查不到任何行」。也可以用 `LEFT JOIN ... WHERE e.id IS NULL`。',
      },
      {
        id: 'a-9',
        title: '哪些课无人问津',
        brief:
          '找出**选课人数少于 15 人**的课程（含 0 人），返回课程代码（`code`）、课程名（`name`）和人数（`student_count`）。\n' +
          '按人数升序排。',
        starter:
          'SELECT c.code, c.name, COUNT(e.id) AS student_count\nFROM courses c\nLEFT JOIN enrollments e ON e.course_id = c.id\n',
        solution:
          'SELECT c.code, c.name, COUNT(e.id) AS student_count ' +
          'FROM courses c LEFT JOIN enrollments e ON e.course_id = c.id ' +
          'GROUP BY c.id, c.code, c.name HAVING COUNT(e.id) < 15 ORDER BY student_count;',
        compare: 'ordered',
        require: [['HAVING', /\bhaving\b/i], ['LEFT JOIN', /\bleft\s+join\b/i]],
        hint: '条件是针对**分组后的人数**，所以用 `HAVING`，并且计数同样要写 `COUNT(e.id)`。',
      },
      {
        id: 'a-10',
        title: '先修课程的完整链条',
        brief:
          '从**没有先修课**的课程出发，用**递归 CTE** 展开每一层后继课程。\n' +
          '返回课程代码（`code`）、课程名（`name`）和层级（列名 `lvl`，基础课为 1）。按 `lvl`、`code` 排序。',
        starter:
          'WITH RECURSIVE chain AS (\n  SELECT id, code, name, prereq_id, 1 AS lvl\n  FROM courses\n  WHERE ',
        solution:
          'WITH RECURSIVE chain AS (' +
          'SELECT id, code, name, prereq_id, 1 AS lvl FROM courses WHERE prereq_id IS NULL ' +
          'UNION ALL ' +
          'SELECT c.id, c.code, c.name, c.prereq_id, ch.lvl + 1 ' +
          'FROM courses c JOIN chain ch ON ch.id = c.prereq_id) ' +
          'SELECT code, name, lvl FROM chain ORDER BY lvl, code;',
        compare: 'ordered',
        require: [['递归 CTE', /with\s+recursive/i], ['UNION ALL', /union\s+all/i]],
        hint: '递归 CTE 是两段用 `UNION ALL` 拼接：第一段取起点（`prereq_id IS NULL`），第二段拿 `courses` 去连自己已经算出的结果 `chain`。',
      },
      {
        id: 'a-11',
        title: '每个学生的成绩单',
        brief:
          '把每个学生**已修完**的课程，按**院系**转成列，值是**平均分**（保留 1 位小数）。\n' +
          '返回学生名（`student_name`）以及各院系列：`cs`（计算机）、`math`（数学）、`eng`（外国语）、`econ`（经济管理）、`phys`（物理）。\n' +
          '按学生 `id` 排序，只统计有成绩的记录。',
        starter:
          "SELECT s.name AS student_name,\n       ROUND(AVG(CASE WHEN d.id = 1 THEN e.score END), 1) AS cs,\n       ",
        solution:
          "SELECT s.name AS student_name, " +
          "ROUND(AVG(CASE WHEN d.id = 1 THEN e.score END), 1) AS cs, " +
          "ROUND(AVG(CASE WHEN d.id = 2 THEN e.score END), 1) AS math, " +
          "ROUND(AVG(CASE WHEN d.id = 3 THEN e.score END), 1) AS eng, " +
          "ROUND(AVG(CASE WHEN d.id = 4 THEN e.score END), 1) AS econ, " +
          "ROUND(AVG(CASE WHEN d.id = 5 THEN e.score END), 1) AS phys " +
          "FROM students s JOIN enrollments e ON e.student_id = s.id " +
          "JOIN courses c ON c.id = e.course_id JOIN departments d ON d.id = c.dept_id " +
          "WHERE e.score IS NOT NULL " +
          "GROUP BY s.id, s.name ORDER BY s.id;",
        compare: 'ordered',
        require: [['CASE WHEN', /\bcase\b/i], ['AVG', /\bavg\s*\(/i]],
        hint: '`AVG(CASE WHEN 条件 THEN score END)` —— 不满足条件时 CASE 返回 NULL，`AVG` 会自动忽略 NULL，于是只对满足条件的行求平均。',
      },
    ],
  },
];
