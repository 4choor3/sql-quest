#!/usr/bin/env python3
"""生成 SQL 闯关工具用的示例数据库（书店业务场景）。

输出:
  data/schema.sql  —— 纯 SQL，可导入任意 SQLite 工具
  data/schema.js   —— window.SCHEMA_SQL，供 file:// 页面直接加载

用固定随机种子，保证每次生成结果一致。
"""
import json
import random
from pathlib import Path

random.seed(42)

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
DATA.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------- authors
authors = [
    (1, "村上春树", "日本", 1949),
    (2, "加西亚·马尔克斯", "哥伦比亚", 1927),
    (3, "伊塔洛·卡尔维诺", "意大利", 1923),
    (4, "豪尔赫·博尔赫斯", "阿根廷", 1899),
    (5, "石黑一雄", "英国", 1954),
    (6, "艾萨克·阿西莫夫", "美国", 1920),
    (7, "刘慈欣", "中国", 1963),
    (8, "阿加莎·克里斯蒂", "英国", 1890),
]

# ---------------------------------------------------------------- books
# (id, title, author_id, genre, price, stock, published_year)
books = [
    (1, "挪威的森林", 1, "小说", 42.00, 120, 1987),
    (2, "海边的卡夫卡", 1, "小说", 55.00, 86, 2002),
    (3, "1Q84", 1, "小说", 88.00, 34, 2009),
    (4, "百年孤独", 2, "魔幻现实主义", 68.00, 210, 1967),
    (5, "霍乱时期的爱情", 2, "小说", 52.00, 150, 1985),
    (6, "迷宫中的将军", 2, "历史小说", 45.00, 40, 1989),
    (7, "看不见的城市", 3, "小说", 38.00, 95, 1972),
    (8, "如果在冬夜，一个旅人", 3, "小说", 46.00, 62, 1979),
    (9, "宇宙奇趣全集", 3, "科幻", 59.00, 28, 1965),
    (10, "小径分岔的花园", 4, "短篇集", 35.00, 130, 1941),
    (11, "阿莱夫", 4, "短篇集", 39.00, 0, 1949),
    (12, "长日将尽", 5, "小说", 49.00, 77, 1989),
    (13, "别让我走", 5, "科幻", 45.00, 88, 2005),
    (14, "基地", 6, "科幻", 56.00, 145, 1951),
    (15, "我，机器人", 6, "科幻", 48.00, 112, 1950),
    (16, "苍穹微石", 6, "科幻", 62.00, 53, 1952),
    (17, "三体", 7, "科幻", 78.00, 320, 2008),
    (18, "三体Ⅱ·黑暗森林", 7, "科幻", 82.00, 240, 2008),
    (19, "三体Ⅲ·死神永生", 7, "科幻", 86.00, 180, 2010),
    (20, "球状闪电", 7, "科幻", 44.00, 96, 2004),
    (21, "无人生还", 8, "推理", 36.00, 260, 1939),
    (22, "东方快车谋杀案", 8, "推理", 34.00, 205, 1934),
    (23, "尼罗河上的惨案", 8, "推理", 37.00, 158, 1937),
    (24, "罗杰疑案", 8, "推理", 33.00, 0, 1926),
    (25, "沙之书（残稿）", 4, None, 25.00, 12, None),
]

# ---------------------------------------------------------------- customers
# (id, name, city, signup_date, level)
customers = [
    (1, "张伟", "北京", "2023-01-15", "黄金"),
    (2, "李娜", "上海", "2023-02-08", "白银"),
    (3, "王强", "广州", "2023-02-20", "普通"),
    (4, "刘洋", "深圳", "2023-03-05", "黄金"),
    (5, "陈静", "杭州", "2023-04-11", "白银"),
    (6, "杨帆", None, "2023-05-02", "普通"),
    (7, "赵敏", "成都", "2023-06-18", "普通"),
    (8, "孙悦", "武汉", "2023-07-23", "白银"),
    (9, "周杰", "北京", "2023-08-30", "黄金"),
    (10, "吴敏", "上海", "2023-09-14", "普通"),
    (11, "郑爽", "西安", "2023-10-09", "白银"),
    (12, "冯磊", "南京", "2024-01-20", "普通"),  # 故意不下单 -> LEFT JOIN 题
]

# ---------------------------------------------------------------- orders
# 每个客户的订单数，合计 30 单；客户 12 无订单
plan = {1: 4, 2: 2, 3: 3, 4: 5, 5: 2, 6: 1, 7: 3, 8: 2, 9: 4, 10: 1, 11: 3}

order_ids = list(range(1, sum(plan.values()) + 1))
# 状态分布：22 已完成 / 4 已取消 / 4 待付款，打散后分配
statuses = ["已完成"] * 22 + ["已取消"] * 4 + ["待付款"] * 4
random.shuffle(statuses)

# 下单日期：2024 上半年
dates = sorted(
    f"2024-{random.randint(1, 6):02d}-{random.randint(1, 28):02d}" for _ in order_ids
)

orders = []
items = []
oid = 1
for cid, n in plan.items():
    for _ in range(n):
        orders.append((oid, cid, dates[oid - 1], statuses[oid - 1]))
        oid += 1

for order in orders:
    oid = order[0]
    n_items = random.randint(1, 4)
    picked = random.sample(books, n_items)
    for b in picked:
        bid, price = b[0], b[4]
        # 八折~原价之间，部分订单恰好原价
        discount = random.choice([1.0, 1.0, 0.95, 0.9, 0.85, 0.8])
        unit_price = round(price * discount, 2)
        qty = random.randint(1, 3)
        items.append((len(items) + 1, oid, bid, qty, unit_price))

# ---------------------------------------------------------------- 输出 SQL
def esc(v):
    if v is None:
        return "NULL"
    if isinstance(v, str):
        return "'" + v.replace("'", "''") + "'"
    if isinstance(v, float):
        return f"{v:.2f}"
    return str(v)


def rows(table, cols, data):
    out = [f"INSERT INTO {table} ({', '.join(cols)}) VALUES"]
    vals = ",\n".join("  (" + ", ".join(esc(v) for v in r) + ")" for r in data)
    return out[0] + "\n" + vals + ";"


lines = []
lines.append("-- SQL 闯关训练场 · 示例数据库（书店业务）")
lines.append("-- 5 张表 / 25 本书 / 12 位客户 / 30 笔订单")
lines.append("")
lines.append("DROP TABLE IF EXISTS order_items;")
lines.append("DROP TABLE IF EXISTS orders;")
lines.append("DROP TABLE IF EXISTS books;")
lines.append("DROP TABLE IF EXISTS customers;")
lines.append("DROP TABLE IF EXISTS authors;")
lines.append("")
lines.append("""CREATE TABLE authors (
  id          INTEGER PRIMARY KEY,
  name        TEXT    NOT NULL,
  country     TEXT    NOT NULL,
  birth_year  INTEGER
);""")
lines.append("")
lines.append("""CREATE TABLE books (
  id             INTEGER PRIMARY KEY,
  title          TEXT    NOT NULL,
  author_id      INTEGER NOT NULL REFERENCES authors(id),
  genre          TEXT,
  price          REAL    NOT NULL,
  stock          INTEGER NOT NULL DEFAULT 0,
  published_year INTEGER
);""")
lines.append("")
lines.append("""CREATE TABLE customers (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  city        TEXT,
  signup_date TEXT NOT NULL,
  level       TEXT NOT NULL
);""")
lines.append("")
lines.append("""CREATE TABLE orders (
  id          INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  order_date  TEXT    NOT NULL,
  status      TEXT    NOT NULL
);""")
lines.append("")
lines.append("""CREATE TABLE order_items (
  id         INTEGER PRIMARY KEY,
  order_id   INTEGER NOT NULL REFERENCES orders(id),
  book_id    INTEGER NOT NULL REFERENCES books(id),
  quantity   INTEGER NOT NULL,
  unit_price REAL    NOT NULL
);""")
lines.append("")
lines.append(rows("authors", ["id", "name", "country", "birth_year"], authors))
lines.append("")
lines.append(
    rows(
        "books",
        ["id", "title", "author_id", "genre", "price", "stock", "published_year"],
        books,
    )
)
lines.append("")
lines.append(
    rows("customers", ["id", "name", "city", "signup_date", "level"], customers)
)
lines.append("")
lines.append(rows("orders", ["id", "customer_id", "order_date", "status"], orders))
lines.append("")
lines.append(
    rows(
        "order_items",
        ["id", "order_id", "book_id", "quantity", "unit_price"],
        items,
    )
)
lines.append("")

sql_text = "\n".join(lines)
(DATA / "schema.sql").write_text(sql_text, encoding="utf-8")
(DATA / "schema.js").write_text(
    "window.SCHEMA_SQL = " + json.dumps(sql_text, ensure_ascii=False) + ";\n",
    encoding="utf-8",
)

# ---------------------------------------------------------------- 自检统计
done = [o for o in orders if o[3] == "已完成"]
done_ids = {o[0] for o in done}
revenue = sum(i[3] * i[4] for i in items if i[1] in done_ids)
print(f"authors     : {len(authors)}")
print(f"books       : {len(books)}  (库存为 0: {sum(1 for b in books if b[5] == 0)} 本)")
print(f"customers   : {len(customers)}  (无城市: 1, 无订单: 1)")
print(f"orders      : {len(orders)}  已完成 {len(done)} / 已取消 4 / 待付款 4")
print(f"order_items : {len(items)}")
print(f"已完成订单销售额: {revenue:,.2f}")
print(f"输出 -> {DATA/'schema.sql'}  ({(DATA/'schema.sql').stat().st_size} B)")
