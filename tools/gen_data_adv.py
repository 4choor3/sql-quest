#!/usr/bin/env python3
"""生成进阶版示例数据库：校园选课系统。

比书店库更深：
  · 7 张表，含自引用（courses.prereq_id）、多对多（enrollments）
  · 真实量级：60 学生 / 24 课程 / 300+ 选课记录 / 成绩分布
  · 数据里埋了进阶题要用的结构：连续学期、退课、重修、未选课学生、无先修课课程

输出与 gen_data.py 一致：
  data/schema_adv.sql  —— 纯 SQL
  data/schema_adv.js   —— window.SCHEMA_ADV_SQL，供页面加载
"""
import json
import random
from pathlib import Path

random.seed(2024)

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
DATA.mkdir(parents=True, exist_ok=True)

# ------------------------------------------------------------------ 院系
departments = [
    (1, "计算机科学与技术", "工学"),
    (2, "数学", "理学"),
    (3, "外国语", "文学"),
    (4, "经济管理", "管理学"),
    (5, "物理学", "理学"),
]

# ------------------------------------------------------------------ 教师
surnames = "王李张刘陈杨黄赵吴周徐孙马朱胡林郭何高罗"
given = "伟芳娜秀英敏静丽强磊洋艳勇军杰娟涛明超霞平刚桂英"
teachers = []
for i in range(1, 19):
    name = random.choice(surnames) + "".join(random.sample(given, 2))
    dept = random.randint(1, 5)
    title = random.choice(["教授", "副教授", "讲师", "讲师", "助教"])
    hire_year = random.randint(2005, 2023)
    teachers.append((i, name, dept, title, hire_year))

# ------------------------------------------------------------------ 课程
# (id, code, name, dept_id, teacher_id, credits, capacity, prereq_id, semester)
COURSE_POOL = [
    ("CS101", "程序设计基础", 1, 4, None),
    ("CS102", "数据结构", 1, 4, "CS101"),
    ("CS201", "算法设计与分析", 1, 3, "CS102"),
    ("CS202", "数据库原理", 1, 3, "CS102"),
    ("CS203", "操作系统", 1, 4, "CS102"),
    ("CS204", "计算机网络", 1, 3, "CS102"),
    ("CS301", "机器学习导论", 1, 3, "CS201"),
    ("CS302", "编译原理", 1, 3, "CS201"),
    ("MA101", "高等数学（上）", 2, 5, None),
    ("MA102", "高等数学（下）", 2, 5, "MA101"),
    ("MA201", "线性代数", 2, 4, None),
    ("MA202", "概率论与数理统计", 2, 4, "MA102"),
    ("MA301", "离散数学", 2, 3, None),
    ("MA302", "数值分析", 2, 3, "MA201"),
    ("EN101", "大学英语（一）", 3, 3, None),
    ("EN102", "大学英语（二）", 3, 3, "EN101"),
    ("EN201", "学术写作", 3, 2, "EN102"),
    ("EC101", "微观经济学", 4, 3, None),
    ("EC102", "宏观经济学", 4, 3, "EC101"),
    ("EC201", "统计学", 4, 3, "MA202"),
    ("EC202", "会计学原理", 4, 3, None),
    ("PH101", "普通物理（一）", 5, 4, None),
    ("PH102", "普通物理（二）", 5, 4, "PH101"),
    ("PH201", "量子力学初步", 5, 3, "PH102"),
]

courses = []
code_to_id = {}
for cid, (code, name, dept, credits, prereq_code) in enumerate(COURSE_POOL, start=1):
    code_to_id[code] = cid
    # 先修课要先于本课开设，用学期号粗粒度排序
    courses.append([cid, code, name, dept, 0, credits, 0, None, 0])

for row in courses:
    cid, code, name, dept, _tid, credits, _cap, _pre, _sem = row
    # 教师按院系匹配
    teachers_in_dept = [t[0] for t in teachers if t[2] == dept]
    tid = random.choice(teachers_in_dept) if teachers_in_dept else random.randint(1, 18)
    pre_code = next((p for c, _n, _d, _cr, p in COURSE_POOL if c == code), None)
    prereq_id = code_to_id.get(pre_code) if pre_code else None
    # 难度越大容量越小；计算容量时先设 0，下面统一算
    row[4] = tid
    row[7] = prereq_id

# 开设学期：无先修 → 2023-1；有先修 → 先修课的下一学期，但不超过 2024-2
def sem_of(code):
    for c, _n, _d, _cr, p in COURSE_POOL:
        if c == code:
            return 1 if p is None else None
    return None

semesters = ["2023-1", "2023-2", "2024-1", "2024-2"]
for row in courses:
    cid, code = row[0], row[1]
    pre_code = next((p for c, _n, _d, _cr, p in COURSE_POOL if c == code), None)
    if pre_code is None:
        sem_idx = 0
    else:
        pre_row = next(r for r in courses if r[1] == pre_code)
        sem_idx = min(semesters.index(pre_row[8]) + 1, 3)
    row[8] = semesters[sem_idx]
    # 容量：基础课大、进阶课小
    level = int(code[2])
    row[6] = [120, 80, 50, 30][min(level // 100, 3)] if level < 400 else 30

# ------------------------------------------------------------------ 学生
majors = {1: "计算机科学与技术", 2: "数学与应用数学", 3: "英语", 4: "工商管理", 5: "物理学"}
students = []
for sid in range(1, 61):
    name = random.choice(surnames) + "".join(random.sample(given, 2))
    dept = random.choice([1, 1, 1, 2, 2, 3, 4, 4, 5])   # 计算机稍多
    grade = random.choice([2021, 2021, 2022, 2022, 2023])
    gender = random.choice(["男", "女"])
    # 少量学生没有邮箱，供 NULL 相关题目使用
    email = None if sid % 17 == 0 else f"stu{sid:03d}@campus.edu"
    students.append((sid, name, gender, dept, grade, email))

# ------------------------------------------------------------------ 选课
# (id, student_id, course_id, enroll_date, score, status)
STATUS = ["已修完", "已修完", "已修完", "已修完", "已退课", "在修"]

enrollments = []
seen = set()
for cid, code, name, dept, tid, credits, cap, prereq, sem in courses:
    # 课程热度差异很大：基础课爆满，高阶/枯燥课没人选。
    # 用「层级」+ 随机冷热因子决定报名率，制造出真实的区分度
    level = int(code[2])            # 101 / 201 / 301 …
    if level <= 102:
        rate = random.uniform(0.55, 0.95)      # 基础课：热门
    elif level <= 202:
        rate = random.uniform(0.25, 0.7)       # 中级课：中等
    else:
        rate = random.uniform(0.04, 0.4)       # 高阶课：冷门
    # 偶尔出现一门几乎没人选的课，给「冷门课程」题用
    if cid % 7 == 0:
        rate = random.uniform(0.02, 0.08)

    # 再叠一层 ±4 的随机扰动，避免一堆课撞在同一个数字上
    n = max(0, min(int(cap * rate) + random.randint(-4, 4), 52))
    pool = [s[0] for s in students]
    picked = random.sample(pool, min(n, len(pool)))
    for sid in picked:
        if (sid, cid) in seen:
            continue
        seen.add((sid, cid))
        # 多数为已修完，少量在修/退课
        st = random.choices(STATUS, weights=[70, 0, 0, 0, 8, 22])[0]
        # 成绩：正态分布，退课/在修无成绩
        if st in ("已退课", "在修"):
            score = None
        else:
            score = max(0, min(100, int(random.gauss(78, 11))))
        month = semesters.index(sem) * 6 + random.choice([3, 4, 9, 10])
        year = 2023 + month // 12
        m = month % 12 + 1
        date = f"{year}-{m:02d}-{random.randint(1, 28):02d}"
        enrollments.append((len(enrollments) + 1, sid, cid, date, score, st))

# 制造若干「一节课都没选」的学生 —— LEFT JOIN / NOT EXISTS 题要用。
# 让他们在 enrollments 里彻底不出现。
idle_ids = set(random.sample([s[0] for s in students], 5))
enrollments = [e for e in enrollments if e[1] not in idle_ids]
for idx, e in enumerate(enrollments, start=1):
    enrollments[idx - 1] = (idx,) + e[1:]

# ------------------------------------------------------------------ 输出
def esc(v):
    if v is None:
        return "NULL"
    if isinstance(v, str):
        return "'" + v.replace("'", "''") + "'"
    if isinstance(v, float):
        return f"{v:.2f}"
    return str(v)


def insert(table, cols, data):
    vals = ",\n".join("  (" + ", ".join(esc(v) for v in r) + ")" for r in data)
    return f"INSERT INTO {table} ({', '.join(cols)}) VALUES\n{vals};"


L = []
L.append("-- SQL 闯关训练场 · 进阶数据库（校园选课系统）")
L.append("-- 7 张表 / 5 院系 / 18 教师 / 24 课程 / 60 学生 / 选课记录若干")
L.append("")
for t in ["enrollments", "courses", "students", "teachers", "departments"]:
    L.append(f"DROP TABLE IF EXISTS {t};")
L.append("")
L.append("""CREATE TABLE departments (
  id    INTEGER PRIMARY KEY,
  name  TEXT NOT NULL,
  field TEXT NOT NULL
);""")
L.append("")
L.append("""CREATE TABLE teachers (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  dept_id    INTEGER NOT NULL REFERENCES departments(id),
  title      TEXT NOT NULL,
  hire_year  INTEGER NOT NULL
);""")
L.append("")
L.append("""CREATE TABLE courses (
  id          INTEGER PRIMARY KEY,
  code        TEXT    NOT NULL UNIQUE,
  name        TEXT    NOT NULL,
  dept_id     INTEGER NOT NULL REFERENCES departments(id),
  teacher_id  INTEGER NOT NULL REFERENCES teachers(id),
  credits     INTEGER NOT NULL,
  capacity    INTEGER NOT NULL,
  prereq_id   INTEGER REFERENCES courses(id),
  semester    TEXT    NOT NULL
);""")
L.append("")
L.append("""CREATE TABLE students (
  id      INTEGER PRIMARY KEY,
  name    TEXT NOT NULL,
  gender  TEXT NOT NULL,
  dept_id INTEGER NOT NULL REFERENCES departments(id),
  grade   INTEGER NOT NULL,
  email   TEXT
);""")
L.append("")
L.append("""CREATE TABLE enrollments (
  id          INTEGER PRIMARY KEY,
  student_id  INTEGER NOT NULL REFERENCES students(id),
  course_id   INTEGER NOT NULL REFERENCES courses(id),
  enroll_date TEXT    NOT NULL,
  score       INTEGER,
  status      TEXT    NOT NULL
);""")
L.append("")
L.append(insert("departments", ["id", "name", "field"], departments))
L.append("")
L.append(insert("teachers", ["id", "name", "dept_id", "title", "hire_year"], teachers))
L.append("")
L.append(insert("courses", ["id", "code", "name", "dept_id", "teacher_id", "credits", "capacity", "prereq_id", "semester"], courses))
L.append("")
L.append(insert("students", ["id", "name", "gender", "dept_id", "grade", "email"], students))
L.append("")
L.append(insert("enrollments", ["id", "student_id", "course_id", "enroll_date", "score", "status"], enrollments))
L.append("")

sql_text = "\n".join(L)
(DATA / "schema_adv.sql").write_text(sql_text, encoding="utf-8")
(DATA / "schema_adv.js").write_text(
    "window.SCHEMA_ADV_SQL = " + json.dumps(sql_text, ensure_ascii=False) + ";\n",
    encoding="utf-8",
)

# ------------------------------------------------------------------ 统计
done = [e for e in enrollments if e[2] is not None and e[5] == "已修完"]
print(f"departments : {len(departments)}")
print(f"teachers    : {len(teachers)}")
print(f"courses     : {len(courses)}  (有先修: {sum(1 for c in courses if c[7])})")
print(f"students    : {len(students)}  (无邮箱: {sum(1 for s in students if s[5] is None)})")
print(f"enrollments : {len(enrollments)}")
print(f"  已修完 {sum(1 for e in enrollments if e[5]=='已修完')} / 在修 {sum(1 for e in enrollments if e[5]=='在修')} / 已退课 {sum(1 for e in enrollments if e[5]=='已退课')}")
print(f"  有成绩 {sum(1 for e in enrollments if e[4] is not None)} 条")
no_enroll = [s[0] for s in students if not any(e[1] == s[0] for e in enrollments)]
print(f"  未选任何课的学生: {len(no_enroll)} 人")
print(f"输出 -> {DATA/'schema_adv.sql'} ({(DATA/'schema_adv.sql').stat().st_size:,} B)")
