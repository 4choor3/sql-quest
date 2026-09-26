/* ==========================================================================
   题库
   --------------------------------------------------------------------------
   每关字段说明：
     id        唯一标识
     title     关卡标题
     brief     任务描述（支持 `code` 反引号行内代码）
     hint      提示（可省略）
     starter   编辑器预填内容
     solution  参考 SQL —— 同时用于「看答案」和生成期望结果
     probe     可选。执行完用户 SQL 后再跑这段 SELECT 来检查数据库状态
               （DML 关卡用；SELECT 关卡不需要）
     compare   比对方式：
                 'columns' 列名 + 行集合（无序）
                 'ordered' 行顺序 + 行数据（不校验列名）
                 'set'     行集合（无序）
                 'scalar'  单个数值（容差 1e-6）
     require   必须出现的关键字正则数组，防止硬编码凑答案
     forbid    禁止出现的关键字正则数组
   ========================================================================== */

window.CHAPTERS = [
  /* ==================================================================== */
  {
    id: 'ch1',
    title: 'SELECT 基础',
    desc: '取数据、挑列、限行数、排顺序',
    levels: [
      {
        id: '1-1',
        title: '取出两列',
        brief: '列出所有书的**书名**和**价格**，列名分别叫 `title` 和 `price`。',
        starter: 'SELECT ',
        solution: 'SELECT title, price FROM books;',
        compare: 'columns',
      },
      {
        id: '1-2',
        title: '只要前 5 行',
        brief: '只看前 5 本书的 `id` 和 `title`，按 id 顺序。用 `LIMIT` 限制行数。',
        starter: 'SELECT id, title FROM books\n',
        solution: 'SELECT id, title FROM books ORDER BY id LIMIT 5;',
        compare: 'ordered',
        require: [['LIMIT', /\blimit\b/i], ['ORDER BY', /\border\s+by\b/i]],
      },
      {
        id: '1-3',
        title: '加个筛选条件',
        brief: '找出**价格超过 60 元**的书，返回 `title` 和 `price`。用 `WHERE` 过滤。',
        starter: 'SELECT title, price FROM books\n',
        solution: 'SELECT title, price FROM books WHERE price > 60;',
        compare: 'columns',
        require: [['WHERE', /\bwhere\b/i]],
        hint: 'WHERE 写在 FROM 后面，条件用 `price > 60`。',
      },
      {
        id: '1-4',
        title: '排个序',
        brief: '所有书按**价格从高到低**排序，返回 `title` 和 `price`。',
        starter: 'SELECT title, price FROM books\n',
        solution: 'SELECT title, price FROM books ORDER BY price DESC;',
        compare: 'ordered',
        require: [['ORDER BY', /\border\s+by\b/i]],
        hint: '`DESC` 是降序，`ASC`（默认）是升序。',
      },
      {
        id: '1-5',
        title: '有哪些分类',
        brief: '`books` 表里一共有哪些**图书分类**？每类只出现一次。',
        starter: 'SELECT ',
        solution: 'SELECT DISTINCT genre FROM books;',
        compare: 'set',
        require: [['DISTINCT', /\bdistinct\b|\bgroup\s+by\b/i]],
        hint: '`DISTINCT` 可以去重。注意有的书 `genre` 是空的。',
      },
    ],
  },

  /* ==================================================================== */
  {
    id: 'ch2',
    title: '条件筛选',
    desc: '比较、区间、集合、模糊匹配、空值',
    levels: [
      {
        id: '2-1',
        title: '缺货的书',
        brief: '找出所有**库存为 0** 的书，返回 `title` 和 `stock`。',
        starter: 'SELECT title, stock FROM books\n',
        solution: 'SELECT title, stock FROM books WHERE stock = 0;',
        compare: 'columns',
        require: [['WHERE', /\bwhere\b/i]],
      },
      {
        id: '2-2',
        title: '价格区间',
        brief: '价格在 **40 到 60 元之间（含 40 和 60）**的书，返回 `title` 和 `price`。用 `BETWEEN`。',
        starter: 'SELECT title, price FROM books\n',
        solution: 'SELECT title, price FROM books WHERE price BETWEEN 40 AND 60;',
        compare: 'columns',
        require: [['BETWEEN', /\bbetween\b/i]],
        hint: '`BETWEEN a AND b` 是闭区间，等价于 `>= a AND <= b`。',
      },
      {
        id: '2-3',
        title: '挑几个作者',
        brief: '作者 id 是 **1、6、8** 的书，返回 `title` 和 `author_id`。用 `IN`。',
        starter: 'SELECT title, author_id FROM books\n',
        solution: 'SELECT title, author_id FROM books WHERE author_id IN (1, 6, 8);',
        compare: 'columns',
        require: [['IN', /\bin\s*\(/i]],
        hint: '`IN (1, 6, 8)` 比写三个 `OR` 清爽。',
      },
      {
        id: '2-4',
        title: '模糊查找',
        brief: '书名里**包含「三体」**的书，返回 `title`。用 `LIKE`。',
        starter: 'SELECT title FROM books\n',
        solution: "SELECT title FROM books WHERE title LIKE '%三体%';",
        compare: 'set',
        require: [['LIKE', /\blike\b/i]],
        hint: '`%` 匹配任意多个字符。',
      },
      {
        id: '2-5',
        title: '空值陷阱',
        brief: '找出**没有填写城市**的客户，返回 `name` 和 `city`。',
        starter: 'SELECT name, city FROM customers\n',
        solution: 'SELECT name, city FROM customers WHERE city IS NULL;',
        compare: 'columns',
        require: [['IS NULL', /\bis\s+null\b/i]],
        hint: '空值不能用 `= NULL` 判断，必须用 `IS NULL`。',
      },
      {
        id: '2-6',
        title: '两个条件',
        brief: '**科幻类**并且**库存大于 100** 的书，返回 `title`、`genre`、`stock`。',
        starter: 'SELECT title, genre, stock FROM books\n',
        solution:
          "SELECT title, genre, stock FROM books WHERE genre = '科幻' AND stock > 100;",
        compare: 'columns',
        require: [['AND', /\band\b/i]],
      },
    ],
  },

  /* ==================================================================== */
  {
    id: 'ch3',
    title: '聚合与分组',
    desc: 'COUNT / SUM / AVG / MAX，GROUP BY 与 HAVING',
    levels: [
      {
        id: '3-1',
        title: '数一数',
        brief: '`books` 表里**一共多少本书**？返回一个数字，列名叫 `total`。',
        starter: 'SELECT ',
        solution: 'SELECT COUNT(*) AS total FROM books;',
        compare: 'scalar',
        require: [['COUNT()', /\bcount\s*\(/i]],
      },
      {
        id: '3-2',
        title: '最贵的一本',
        brief: '最贵的书**多少钱**？返回一个数字，列名叫 `max_price`。',
        starter: 'SELECT ',
        solution: 'SELECT MAX(price) AS max_price FROM books;',
        compare: 'scalar',
        require: [['MAX()', /\bmax\s*\(/i]],
      },
      {
        id: '3-3',
        title: '平均价格',
        brief: '所有书的**平均价格**，四舍五入保留 **2 位小数**，列名叫 `avg_price`。',
        starter: 'SELECT ',
        solution: 'SELECT ROUND(AVG(price), 2) AS avg_price FROM books;',
        compare: 'scalar',
        require: [['AVG()', /\bavg\s*\(/i], ['ROUND()', /\bround\s*\(/i]],
        hint: '`ROUND(AVG(price), 2)`。',
      },
      {
        id: '3-4',
        title: '分组计数',
        brief: '**每个分类**有多少本书？返回 `genre` 和数量（列名 `book_count`），按数量从多到少排。',
        starter: 'SELECT genre, COUNT(*) AS book_count FROM books\n',
        solution:
          'SELECT genre, COUNT(*) AS book_count FROM books GROUP BY genre ORDER BY book_count DESC;',
        compare: 'ordered',
        require: [['GROUP BY', /\bgroup\s+by\b/i]],
        hint: '`GROUP BY genre` 之后，`COUNT(*)` 统计的是每组的行数。',
      },
      {
        id: '3-5',
        title: '筛掉小分组',
        brief: '只保留**书数超过 2 本**的分类，返回 `genre` 和数量（列名 `book_count`）。用 `HAVING`。',
        starter: 'SELECT genre, COUNT(*) AS book_count FROM books\nGROUP BY genre\n',
        solution:
          'SELECT genre, COUNT(*) AS book_count FROM books GROUP BY genre HAVING COUNT(*) > 2;',
        compare: 'set',
        require: [['HAVING', /\bhaving\b/i]],
        hint: '`WHERE` 过滤行，`HAVING` 过滤分组 —— 聚合函数的结果只能用 HAVING 筛。',
      },
      {
        id: '3-6',
        title: '分组求平均',
        brief: '每个分类的**平均价格**（保留 2 位小数，列名 `avg_price`），按平均价从高到低排。',
        starter: 'SELECT genre, ',
        solution:
          'SELECT genre, ROUND(AVG(price), 2) AS avg_price FROM books GROUP BY genre ORDER BY avg_price DESC;',
        compare: 'ordered',
        require: [['GROUP BY', /\bgroup\s+by\b/i]],
      },
    ],
  },

  /* ==================================================================== */
  {
    id: 'ch4',
    title: '多表连接',
    desc: 'INNER JOIN / LEFT JOIN，把散落的表拼起来',
    levels: [
      {
        id: '4-1',
        title: '第一次 JOIN',
        brief: '查出每本书的 `title` 和它的**作者名**（列名 `author_name`）。两张表都要用上。',
        starter: 'SELECT b.title, a.name AS author_name\nFROM books b\n',
        solution:
          'SELECT b.title, a.name AS author_name FROM books b JOIN authors a ON a.id = b.author_id;',
        compare: 'set',
        require: [['JOIN', /\bjoin\b/i], ['ON', /\bon\b/i]],
        hint: '`JOIN authors a ON a.id = b.author_id`。',
      },
      {
        id: '4-2',
        title: '带条件的 JOIN',
        brief: '查出**中国作者**写的书，返回 `title` 和作者名（列名 `author_name`）。',
        starter: 'SELECT b.title, a.name AS author_name\nFROM books b\nJOIN authors a ON a.id = b.author_id\n',
        solution:
          "SELECT b.title, a.name AS author_name FROM books b JOIN authors a ON a.id = b.author_id WHERE a.country = '中国';",
        compare: 'set',
        require: [['JOIN', /\bjoin\b/i], ['WHERE', /\bwhere\b/i]],
      },
      {
        id: '4-3',
        title: '一个都不能少',
        brief:
          '统计**每位客户**下了多少笔订单，返回 `name` 和订单数（列名 `order_count`）。\n没下过单的客户也要出现，订单数为 **0**。',
        starter:
          'SELECT c.name, COUNT(o.id) AS order_count\nFROM customers c\n',
        solution:
          'SELECT c.name, COUNT(o.id) AS order_count FROM customers c LEFT JOIN orders o ON o.customer_id = c.id GROUP BY c.id, c.name ORDER BY c.id;',
        compare: 'set',
        require: [['LEFT JOIN', /\bleft\s+join\b/i]],
        hint: '`LEFT JOIN` 保留左表全部行。数订单要用 `COUNT(o.id)` 而不是 `COUNT(*)` —— 后者会把没订单的那行也数成 1。',
      },
      {
        id: '4-4',
        title: '三表连起来',
        brief:
          '列出订单明细：`order_id`、书名（列名 `title`）、数量（列名 `quantity`）。\n需要 `orders` → `order_items` → `books` 三张表。',
        starter: 'SELECT o.id AS order_id, b.title, oi.quantity\nFROM orders o\n',
        solution:
          'SELECT o.id AS order_id, b.title, oi.quantity FROM orders o JOIN order_items oi ON oi.order_id = o.id JOIN books b ON b.id = oi.book_id;',
        compare: 'set',
        require: [['两个 JOIN', /\bjoin\b[\s\S]*\bjoin\b/i]],
      },
      {
        id: '4-5',
        title: '找出沉默的客户',
        brief: '找出**从没下过订单**的客户，返回 `name`。',
        starter: 'SELECT c.name\nFROM customers c\n',
        solution:
          'SELECT c.name FROM customers c LEFT JOIN orders o ON o.customer_id = c.id WHERE o.id IS NULL;',
        compare: 'set',
        require: [['JOIN', /\bjoin\b/i]],
        hint: '左连接之后，右表没匹配上的行，其字段全是 `NULL`。',
      },
    ],
  },

  /* ==================================================================== */
  {
    id: 'ch5',
    title: '子查询',
    desc: '把一条查询的结果喂给另一条查询',
    levels: [
      {
        id: '5-1',
        title: '比平均价还贵',
        brief: '找出**价格高于全表平均价**的书，返回 `title` 和 `price`。',
        starter: 'SELECT title, price FROM books\nWHERE price > ',
        solution:
          'SELECT title, price FROM books WHERE price > (SELECT AVG(price) FROM books);',
        compare: 'set',
        require: [['子查询', /\(\s*select/i]],
        hint: '`(SELECT AVG(price) FROM books)` 会先算出一个数字，再拿去做比较。',
      },
      {
        id: '5-2',
        title: '谁买过三体',
        brief: '找出**买过《三体》**的客户姓名（列名 `name`），不要重复。',
        starter: 'SELECT DISTINCT c.name\nFROM customers c\n',
        solution:
          "SELECT DISTINCT c.name FROM customers c JOIN orders o ON o.customer_id = c.id JOIN order_items oi ON oi.order_id = o.id JOIN books b ON b.id = oi.book_id WHERE b.title = '三体';",
        compare: 'set',
        require: [['JOIN', /\bjoin\b/i]],
        hint: '这条用四表 JOIN 就能做。也可以把「买过三体的订单」写成子查询再 `IN`。',
      },
      {
        id: '5-3',
        title: '有过成交的客户',
        brief:
          '找出**至少有一笔「已完成」订单**的客户，返回 `name`。用 `EXISTS` 或 `IN` 子查询。',
        starter: 'SELECT c.name\nFROM customers c\nWHERE ',
        solution:
          "SELECT c.name FROM customers c WHERE EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id AND o.status = '已完成');",
        compare: 'set',
        require: [['EXISTS 或 IN 子查询', /\bexists\b|\bin\s*\(\s*select/i]],
        hint: '`EXISTS (子查询)` 只要子查询能查到行就为真，不关心查到什么。',
      },
      {
        id: '5-4',
        title: '各分类最贵的书',
        brief:
          '找出**每个分类里最贵的那本书**，返回 `genre` 和 `title`。\n提示：可以用相关子查询，也可以用窗口函数。',
        starter: 'SELECT b.genre, b.title\nFROM books b\nWHERE ',
        solution:
          'SELECT b.genre, b.title FROM books b WHERE b.price = (SELECT MAX(price) FROM books x WHERE x.genre IS b.genre);',
        compare: 'set',
        require: [['子查询', /\(\s*select/i]],
        hint: '`WHERE x.genre IS b.genre` 让子查询跟着外层的每一行变。用 `IS` 而不是 `=`，这样分类为空的书也能正确匹配。',
      },
    ],
  },

  /* ==================================================================== */
  {
    id: 'ch6',
    title: '函数与计算',
    desc: '算数、字符串、日期、CASE 分档',
    levels: [
      {
        id: '6-1',
        title: '算库存价值',
        brief:
          '算每本书的**库存总价值**（价格 × 库存），返回 `title` 和 `value`，按价值从高到低排。',
        starter: 'SELECT title, ',
        solution:
          'SELECT title, price * stock AS value FROM books ORDER BY value DESC;',
        compare: 'ordered',
        require: [['乘法运算', /\*/]],
        hint: 'SQL 里可以直接对列做四则运算，用 `AS` 起个别名。',
      },
      {
        id: '6-2',
        title: '书名有多长',
        brief: '找出**书名长度超过 8 个字**的书，返回 `title` 和长度（列名 `len`）。',
        starter: 'SELECT title, ',
        solution: 'SELECT title, LENGTH(title) AS len FROM books WHERE LENGTH(title) > 8;',
        compare: 'set',
        require: [['LENGTH()', /\blength\s*\(/i]],
      },
      {
        id: '6-3',
        title: '拼字符串',
        brief:
          '把书名和价格拼成一句话，格式：`三体 - 78.0 元`，列名 `label`。按 `id` 排序。\n用 `||` 拼接。',
        starter: "SELECT title || ' - ' || price AS label FROM books\n",
        solution:
          "SELECT title || ' - ' || price || ' 元' AS label FROM books ORDER BY id;",
        compare: 'ordered',
        require: [['|| 拼接', /\|\|/]],
        hint: '`||` 是 SQLite 的字符串拼接运算符，数字会被自动转成文本。',
      },
      {
        id: '6-4',
        title: '订单年份分布',
        brief:
          '统计**每年**有多少笔订单，返回年份（列名 `year`）和订单数（列名 `order_count`），按年份排。',
        starter: "SELECT strftime('%Y', order_date) AS year, ",
        solution:
          "SELECT strftime('%Y', order_date) AS year, COUNT(*) AS order_count FROM orders GROUP BY year ORDER BY year;",
        compare: 'ordered',
        require: [['strftime()', /strftime|substr/i]],
        hint: "`strftime('%Y', order_date)` 取出年份。",
      },
      {
        id: '6-5',
        title: '价格分档',
        brief:
          '给每本书打标签：价格 **≥ 70** 叫 `昂贵`，**≥ 45** 叫 `适中`，其余叫 `便宜`。\n返回 `title`、`price` 和档位（列名 `tier`），按 id 排序。用 `CASE WHEN`。',
        starter: 'SELECT title, price,\n  CASE\n',
        solution:
          "SELECT title, price, CASE WHEN price >= 70 THEN '昂贵' WHEN price >= 45 THEN '适中' ELSE '便宜' END AS tier FROM books ORDER BY id;",
        compare: 'ordered',
        require: [['CASE WHEN', /\bcase\b/i]],
        hint: '`CASE WHEN 条件 THEN 值 ... ELSE 值 END`，从上往下匹配，第一个成立的就返回。',
      },
    ],
  },

  /* ==================================================================== */
  {
    id: 'ch7',
    title: '窗口函数与 CTE',
    desc: '排名、累计、把复杂查询拆成积木',
    levels: [
      {
        id: '7-1',
        title: '给书排个名',
        brief:
          '按价格从高到低给书排名，返回 `title`、`price` 和名次（列名 `rn`）。\n用 `ROW_NUMBER() OVER (ORDER BY ...)`。',
        starter: 'SELECT title, price,\n  ',
        solution:
          'SELECT title, price, ROW_NUMBER() OVER (ORDER BY price DESC) AS rn FROM books ORDER BY rn;',
        compare: 'ordered',
        require: [['OVER()', /over\s*\(/i]],
        hint: '窗口函数不会把多行合并成一行，它给每行算一个值。',
      },
      {
        id: '7-2',
        title: '分类内排名',
        brief:
          '在每个**分类内部**按价格从高到低排名，返回 `genre`、`title`、`price` 和名次（列名 `rn`），按分类、名次排序。\n用 `PARTITION BY`。',
        starter: 'SELECT genre, title, price,\n  ',
        solution:
          'SELECT genre, title, price, ROW_NUMBER() OVER (PARTITION BY genre ORDER BY price DESC) AS rn FROM books ORDER BY genre, rn;',
        compare: 'ordered',
        require: [['PARTITION BY', /partition\s+by/i]],
        hint: '`PARTITION BY genre` 相当于「在每个分类里分别重新编号」。',
      },
      {
        id: '7-3',
        title: '用 CTE 拆步骤',
        brief:
          '先用 `WITH` 算出**每个城市的客户数**，再查出来。\n返回 `city` 和客户数（列名 `cust_count`），按客户数降序。',
        starter: 'WITH city_stat AS (\n  SELECT city, COUNT(*) AS cust_count FROM customers GROUP BY city\n)\n',
        solution:
          'WITH city_stat AS (SELECT city, COUNT(*) AS cust_count FROM customers GROUP BY city) SELECT city, cust_count FROM city_stat ORDER BY cust_count DESC;',
        compare: 'ordered',
        require: [['WITH', /\bwith\b/i]],
        hint: 'CTE 就是给一段查询起个名字，主查询把它当普通表用。',
      },
      {
        id: '7-4',
        title: '累计销售额',
        brief:
          '只看**已完成**的订单，按日期统计每天的销售额（列名 `day_amount`），并算出**累计到当天**的总额（列名 `running_total`）。\n返回 `order_date`、`day_amount`、`running_total`，按日期排序。',
        starter:
          'SELECT o.order_date,\n       SUM(oi.quantity * oi.unit_price) AS day_amount,\n       ',
        solution:
          "SELECT o.order_date, SUM(oi.quantity * oi.unit_price) AS day_amount, SUM(SUM(oi.quantity * oi.unit_price)) OVER (ORDER BY o.order_date) AS running_total FROM orders o JOIN order_items oi ON oi.order_id = o.id WHERE o.status = '已完成' GROUP BY o.order_date ORDER BY o.order_date;",
        compare: 'ordered',
        require: [['OVER()', /over\s*\(/i], ['JOIN', /\bjoin\b/i]],
        hint: '窗口函数的 `OVER (ORDER BY ...)` 不加 PARTITION 时，默认从第一行累加到当前行。',
      },
    ],
  },

  /* ==================================================================== */
  {
    id: 'ch8',
    title: '改数据',
    desc: 'INSERT / UPDATE / DELETE —— 这一章会真的改动数据',
    levels: [
      {
        id: '8-1',
        title: '插入一位作者',
        brief:
          '往 `authors` 表插入一位新作者：id = **99**，姓名 `弗兰茨·卡夫卡`，国家 `奥地利`，出生年 **1883**。',
        starter: 'INSERT INTO authors (id, name, country, birth_year)\nVALUES ',
        solution:
          "INSERT INTO authors (id, name, country, birth_year) VALUES (99, '弗兰茨·卡夫卡', '奥地利', 1883);",
        probe: 'SELECT id, name, country, birth_year FROM authors WHERE id = 99;',
        compare: 'set',
        require: [['INSERT INTO', /\binsert\s+into\b/i]],
      },
      {
        id: '8-2',
        title: '更新客户等级',
        brief: '把**所有北京客户**的 `level` 改成 `钻石`。',
        starter: 'UPDATE customers\n',
        solution: "UPDATE customers SET level = '钻石' WHERE city = '北京';",
        probe: "SELECT name, city, level FROM customers WHERE city = '北京';",
        compare: 'set',
        require: [['UPDATE', /\bupdate\b/i], ['SET', /\bset\b/i]],
        hint: '`UPDATE 表 SET 列 = 值 WHERE 条件` —— 忘了 WHERE 会把全表都改掉。',
      },
      {
        id: '8-3',
        title: '删掉一本书',
        brief: '从 `books` 表里**删除《沙之书（残稿）》**这本书。',
        starter: 'DELETE FROM books\n',
        solution: "DELETE FROM books WHERE title = '沙之书（残稿）';",
        probe: "SELECT COUNT(*) AS n FROM books WHERE title = '沙之书（残稿）';",
        compare: 'scalar',
        require: [['DELETE FROM', /\bdelete\s+from\b/i], ['WHERE', /\bwhere\b/i]],
      },
      {
        id: '8-4',
        title: '全类涨价',
        brief:
          '把**所有科幻类**图书的价格**上调 5%**，结果保留 2 位小数。\n用 `ROUND(price * 1.05, 2)`。',
        starter: "UPDATE books\nSET price = \nWHERE genre = '科幻';",
        solution: "UPDATE books SET price = ROUND(price * 1.05, 2) WHERE genre = '科幻';",
        probe: "SELECT title, price FROM books WHERE genre = '科幻';",
        compare: 'set',
        require: [['UPDATE', /\bupdate\b/i], ['ROUND()', /\bround\s*\(/i]],
      },
    ],
  },
];
