#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
知识图书馆（Skill Library）
零依赖的本地「md + 技能」管理工具：SQLite 目录 + 本地网页 + 命令行。

常用命令：
  python3 lib.py serve           启动网页（默认 http://127.0.0.1:8765）
  python3 lib.py open            启动服务并自动打开浏览器
  python3 lib.py scan            扫描 ~/.codex/skills 里的技能并入库
  python3 lib.py add <路径>      把 md / 技能加入图书馆（会询问类型、分类）
  python3 lib.py list            列出馆藏

只监听本机 127.0.0.1，不会联网。
"""

import argparse
import json
import mimetypes
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import threading
import urllib.parse
import webbrowser
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LIB_ROOT = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(LIB_ROOT, "library.db")
PLUGIN_CACHE = os.path.expanduser("~/.codex/plugins/cache")
PROMPT_DIR = os.path.join(LIB_ROOT, "prompts")
MANUAL_DIR = os.path.join(LIB_ROOT, "manuals")
STATIC_DIR = os.path.join(LIB_ROOT, "app", "static")
PORT = int(os.environ.get("LIB_PORT", "8765"))

TYPES = {"skill": "技能", "prompt": "提示词", "manual": "手册", "tool": "工具"}
CONTENT_LIMIT = 60000

# 支持扫描的 AI agent 来源：kind=skill 扫描目录里的 SKILL.md；kind=rule 扫描 .md/.mdc 规则文件
AGENTS = {
    "codex": {"label": "Codex", "dirs": ["~/.codex/skills"], "kind": "skill"},
    "claude": {"label": "Claude Code", "dirs": ["~/.claude/skills"], "kind": "skill"},
    "cursor": {"label": "Cursor", "dirs": ["~/.cursor/rules"], "kind": "rule"},
    "trae": {"label": "Trae", "dirs": ["~/.trae/rules", "~/.trae-cn/rules"], "kind": "rule"},
}

# 技能自动分类：先按名称匹配（更可靠），再按描述匹配（顺序即优先级）。
# 规则是通用领域关键词，不是针对某个人的技能库，因此换一批技能也能自动归入对应分类；
# 分类名是动态字符串，规则命中哪个就存入哪个，前端会自动列出新分类。
NAME_RULES = [
    # 精确技能名优先，避免被描述里的宽泛词（封面 / 动画 / 图标等）误判
    (["library-manager", "skill-library", "skill-creator", "skill-installer", "plugin-creator", "template-creator", "karpathy", "make-interfaces", "libtv"], "开发工具"),
    (["beautiful-html", "codex-ppt", "ppt", "slide"], "文档办公"),
    (["frontend-design"], "图像设计"),
    (["seedance", "sora", "veo", "kling", "runway", "video", "film", "screenwriting"], "视频创作"),
    (["stock", "finance", "trading", "quant", "crypto"], "金融数据"),
    (["imagegen", "image", "photo", "design", "figma", "adobe", "poster", "zine", "pet", "hatch"], "图像设计"),
    (["audio", "music", "voice", "tts", "podcast", "sound"], "音频音乐"),
    (["writing", "writer", "copywriting", "translate", "translation"], "写作翻译"),
    (["marketing", "ecommerce", "seo", "brand", "ads", "advertise"], "营销电商"),
    (["education", "teaching", "tutorial", "course", "learn"], "教育学习"),
    (["game", "gaming"], "游戏娱乐"),
    (["health", "medical", "fitness", "psychology", "nutrition"], "健康医疗"),
    (["security", "privacy", "compliance", "legal", "copyright", "encrypt"], "安全合规"),
    (["devops", "docker", "kubernetes", "deploy", "cloud", "server"], "运维部署"),
    (["data", "scraper", "crawler", "xhs", "analytics", "visualize"], "数据工具"),
    (["document", "presentation", "spreadsheet", "pdf", "excel"], "文档办公"),
    (["browser", "chrome", "computer-use", "selenium", "code", "dev", "plugin", "git", "cli"], "开发工具"),
]

DESC_RULES = [
    (["stock", "fund", "finance", "金融", "股票", "证券", "基金", "etf", "期权", "期货", "sec filing", "融资融券", "龙虎榜", "北向", "港股", "美股", "a股", "crypto", "加密货币", "比特币", "trading", "行情", "k线"], "金融数据"),
    (["seedance", "sora", "veo", "kling", "runway", "video", "视频", "剪辑", "电影", "film", "短片", "长片", "剧本", "编剧", "screenwriting", "影视"], "视频创作"),
    (["audio", "音乐", "声音", "sound", "语音", "voice", "speech", "tts", "配音", "歌曲", "podcast", "播客", "旋律", "音频"], "音频音乐"),
    (["imagegen", "image", "视觉", "图像", "图片", "photo", "照片", "设计", "visual", "海报", "poster", "mockup", "插画", "illustration", "绘画", "drawing", "art", "美术", "logo", "艺术", "zine", "宠物", "pet"], "图像设计"),
    (["writing", "写作", "文案", "copywriting", "翻译", "translate", "translation", "文章", "article", "博客", "blog", "小说", "novel", "校对", "proofread", "编辑", "editing", "总结", "summarize"], "写作翻译"),
    (["marketing", "营销", "广告", "电商", "ecommerce", "商品", "带货", "直播", "销售", "sales", "品牌", "brand", "seo", "流量", "推广"], "营销电商"),
    (["education", "教育", "学习", "课程", "教学", "讲师", "tutorial", "培训", "考试", "辅导", "语言学习"], "教育学习"),
    (["game", "游戏", "gaming", "娱乐", "entertainment", "电竞"], "游戏娱乐"),
    (["health", "健康", "医疗", "医学", "medical", "养生", "健身", "fitness", "营养", "nutrition", "心理", "psychology", "疾病"], "健康医疗"),
    (["security", "安全", "渗透", "漏洞", "隐私", "privacy", "合规", "compliance", "版权", "copyright", "加密", "encryption", "法律", "legal"], "安全合规"),
    (["devops", "运维", "部署", "deploy", "服务器", "server", "云", "cloud", "docker", "kubernetes", "k8s", "监控", "monitor"], "运维部署"),
    (["data", "数据", "爬虫", "crawler", "scraping", "采集", "xhs", "小红书", "分析", "analytics", "可视化", "visualization", "图表", "chart", "数据库", "database", "sql"], "数据工具"),
    (["document", "presentation", "spreadsheet", "pdf", "docx", "xlsx", "ppt", "文档", "办公", "office", "演示", "幻灯片", "表格", "邮件", "email", "会议"], "文档办公"),
    (["code", "代码", "编程", "programming", "开发", "dev", "工程", "engineering", "git", "github", "测试", "test", "调试", "debug", "重构", "refactor", "skill-creator", "skill-installer", "plugin", "template", "karpathy", "browser", "chrome", "computer-use", "selenium", "自动化", "automation", "cli", "命令行", "python", "javascript"], "开发工具"),
]


def infer_skill_category(name, description):
    """根据技能名称与描述推断稳定大类（如 金融数据 / 图像设计 / 视频创作…）。"""
    name_l = name.lower()
    for keywords, category in NAME_RULES:
        for kw in keywords:
            if kw in name_l:
                return category
    text = description.lower()
    for keywords, category in DESC_RULES:
        for kw in keywords:
            if kw in text:
                return category
    return "未分类"


# ---------------------------------------------------------------- 数据库

def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db():
    os.makedirs(PROMPT_DIR, exist_ok=True)
    os.makedirs(MANUAL_DIR, exist_ok=True)
    conn = db()
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS items (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT NOT NULL,
            type        TEXT NOT NULL,
            category    TEXT DEFAULT '未分类',
            description TEXT DEFAULT '',
            path        TEXT,
            source      TEXT DEFAULT '',
            tags        TEXT DEFAULT '',
            favorite    INTEGER DEFAULT 0,
            opens       INTEGER DEFAULT 0,
            created_at  TEXT,
            updated_at  TEXT
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_items_type ON items(type)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_items_path ON items(path)")
    conn.commit()
    conn.close()


def upsert_item(name, type_, path, category="未分类", description="", source="", tags=""):
    """按路径去重入库：已存在则更新信息，不存在则新建。"""
    now = datetime.now().isoformat(timespec="seconds")
    conn = db()
    row = conn.execute("SELECT id FROM items WHERE path = ?", (path,)).fetchone()
    if row:
        conn.execute(
            """
            UPDATE items SET name=?, type=?, category=?, description=?,
                            source=?, tags=?, updated_at=?
            WHERE id=?
            """,
            (name, type_, category, description, source, tags, now, row["id"]),
        )
    else:
        conn.execute(
            """
            INSERT INTO items (name, type, category, description, path, source,
                               tags, favorite, opens, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)
            """,
            (name, type_, category, description, path, source, tags, now, now),
        )
    conn.commit()
    conn.close()


# ---------------------------------------------------------------- 解析 skill

FRONT_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n?", re.S | re.M)


def parse_frontmatter(text):
    m = FRONT_RE.match(text)
    if not m:
        return {}
    meta = {}
    key = None
    for line in m.group(1).splitlines():
        mm = re.match(r"^\s*([A-Za-z0-9_-]+):\s*(.*)$", line)
        if mm:
            key = mm.group(1)
            val = mm.group(2).strip()
            if key not in meta:
                meta[key] = val
        elif key and meta.get(key) and re.match(r"^\s+\S", line):
            # 处理 YAML 折叠续行（description: > ...）
            meta[key] = meta[key] + " " + line.strip()
    for k in list(meta):
        v = meta[k]
        if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
            meta[k] = v[1:-1]
    return meta


def find_plugin_skill_roots(base, maxdepth=6):
    roots = []
    if not os.path.isdir(base):
        return roots
    for dirpath, dirnames, _ in os.walk(base):
        depth = dirpath[len(base):].count(os.sep)
        if depth > maxdepth:
            dirnames[:] = []
            continue
        if os.path.basename(dirpath) == "skills":
            roots.append(dirpath)
    return roots


def _scan_skill_root(root, agent_key):
    """扫描一个 agent 的技能目录（每个子目录含 SKILL.md），返回登记的名字列表。"""
    found = []
    if not os.path.isdir(root):
        return found
    for entry in sorted(os.listdir(root)):
        skill_dir = os.path.join(root, entry)
        sk = os.path.join(skill_dir, "SKILL.md")
        if not os.path.isfile(sk):
            continue
        try:
            with open(sk, encoding="utf-8", errors="replace") as fh:
                text = fh.read()
        except Exception:
            continue
        meta = parse_frontmatter(text)
        name = meta.get("name") or entry
        desc = (meta.get("description") or "").strip()
        source = meta.get("source") or meta.get("repo") or meta.get("github") or agent_key
        category = infer_skill_category(name, desc)
        # 保留用户手动改过的分类，只在仍为默认值时更新
        conn = db()
        existing = conn.execute("SELECT category FROM items WHERE path = ?", (skill_dir,)).fetchone()
        if existing and existing["category"] not in ("技能", "未分类"):
            category = existing["category"]
        conn.close()
        upsert_item(name=name, type_="skill", path=skill_dir, category=category, description=desc, source=source)
        found.append(name)
    return found


def _scan_rule_root(root, agent_key):
    """扫描一个 agent 的规则文件（.md / .mdc），返回登记的名字列表。"""
    found = []
    if not os.path.isdir(root):
        return found
    for entry in sorted(os.listdir(root)):
        if not entry.lower().endswith((".md", ".mdc")):
            continue
        fpath = os.path.join(root, entry)
        if not os.path.isfile(fpath):
            continue
        try:
            with open(fpath, encoding="utf-8", errors="replace") as fh:
                text = fh.read()
        except Exception:
            continue
        meta = parse_frontmatter(text)
        name = meta.get("name") or os.path.splitext(entry)[0]
        desc = (meta.get("description") or "").strip()
        if not desc:
            for line in text.splitlines():
                line = line.strip()
                if line and not line.startswith("#") and not line.startswith("---"):
                    desc = line[:200]
                    break
        category = infer_skill_category(name, desc)
        conn = db()
        existing = conn.execute("SELECT category FROM items WHERE path = ?", (fpath,)).fetchone()
        if existing and existing["category"] not in ("技能", "未分类"):
            category = existing["category"]
        conn.close()
        upsert_item(name=name, type_="prompt", path=fpath, category=category, description=desc, source=agent_key)
        found.append(name)
    return found


def scan_skills(include_system=False, quiet=False):
    """扫描各 AI agent（Codex / Claude / Cursor / Trae）的技能与规则并入库。"""
    found = []
    for agent_key, agent in AGENTS.items():
        for d in agent["dirs"]:
            root = os.path.expanduser(d)
            if agent["kind"] == "skill":
                found += _scan_skill_root(root, agent_key)
            else:
                found += _scan_rule_root(root, agent_key)
    if include_system:
        for root in find_plugin_skill_roots(PLUGIN_CACHE):
            found += _scan_skill_root(root, "codex")
    if not quiet:
        print(f"扫描完成，共登记 {len(found)} 条")
    return found


# ---------------------------------------------------------------- 增删改查

def add_path(path, type_=None, category=None, name=None, copy=True):
    """把文件或技能目录加入图书馆。返回 (ok, message)。"""
    path = os.path.abspath(os.path.expanduser(path.strip()))
    if not os.path.exists(path):
        return False, f"路径不存在：{path}"

    # 目录且含 SKILL.md → 自动识别为技能
    if os.path.isdir(path):
        sk = os.path.join(path, "SKILL.md")
        if os.path.isfile(sk):
            type_ = type_ or "skill"
            category = category or "技能"
            if type_ == "skill":
                try:
                    with open(sk, encoding="utf-8", errors="replace") as fh:
                        meta = parse_frontmatter(fh.read())
                    desc = (meta.get("description") or "").strip()
                    name = meta.get("name") or name or os.path.basename(path)
                except Exception:
                    desc = ""
                    name = name or os.path.basename(path)
                category = category if (category and category != "技能") else infer_skill_category(name, desc)
                upsert_item(name, "skill", path, category, desc, "", "")
                return True, f"技能「{name}」已登记"
        return False, "这是一个目录，但没有找到 SKILL.md，暂不支持"

    if not os.path.isfile(path):
        return False, f"不是有效文件：{path}"

    type_ = type_ or "prompt"
    category = category or "未分类"
    name = name or os.path.splitext(os.path.basename(path))[0]

    final_path = path
    moved = False
    if copy and type_ in ("prompt", "manual") and not path.startswith(LIB_ROOT):
        target_dir = PROMPT_DIR if type_ == "prompt" else MANUAL_DIR
        os.makedirs(target_dir, exist_ok=True)
        final_path = os.path.join(target_dir, os.path.basename(path))
        if os.path.abspath(final_path) != path:
            shutil.copy2(path, final_path)
            moved = True

    desc = ""
    if final_path.lower().endswith(".md"):
        try:
            with open(final_path, encoding="utf-8", errors="replace") as fh:
                head = fh.read(2000)
            meta = parse_frontmatter(head)
            desc = (meta.get("description") or "").strip()
            if not desc:
                lines = [l for l in head.splitlines() if l.strip() and not l.strip().startswith("#")]
                desc = lines[0][:200] if lines else ""
        except Exception:
            pass

    upsert_item(name, type_, final_path, category, desc, "", "")
    tip = f"，已复制到 {os.path.dirname(final_path)}" if moved else ""
    return True, f"「{name}」已入库{tip}"


def list_items(q="", type_=None, cat=None, fav=None):
    conn = db()
    sql = "SELECT * FROM items WHERE 1=1"
    params = []
    if q:
        sql += " AND (name LIKE ? OR description LIKE ? OR tags LIKE ?)"
        like = f"%{q}%"
        params += [like, like, like]
    if type_:
        sql += " AND type=?"
        params.append(type_)
    if cat:
        sql += " AND category=?"
        params.append(cat)
    if fav is not None:
        sql += " AND favorite=?"
        params.append(int(fav))
    sql += " ORDER BY favorite DESC, updated_at DESC, id DESC"
    rows = conn.execute(sql, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_item(item_id):
    conn = db()
    row = conn.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone()
    conn.close()
    return dict(row) if row else None


def read_content(item):
    p = item.get("path") if item else None
    if not p or not os.path.exists(p):
        return ""
    candidates = []
    if os.path.isdir(p):
        for cand in ("SKILL.md", "README.md", "readme.md", "index.md"):
            candidates.append(os.path.join(p, cand))
    elif os.path.isfile(p):
        candidates.append(p)
    for f in candidates:
        if os.path.isfile(f):
            try:
                with open(f, encoding="utf-8", errors="replace") as fh:
                    data = fh.read(CONTENT_LIMIT + 10)
                if len(data) > CONTENT_LIMIT:
                    data = data[:CONTENT_LIMIT] + "\n\n> 内容过长，已截断展示。"
                return data
            except Exception:
                continue
    return ""


def open_in_finder(path):
    target = path if (path and os.path.isdir(path)) else os.path.dirname(path or ".")
    if sys.platform == "darwin":
        subprocess.Popen(["open", target])
    elif sys.platform == "win32":
        os.startfile(target)
    else:
        subprocess.Popen(["xdg-open", target])


def stats():
    conn = db()
    rows = conn.execute("SELECT type, COUNT(*) AS c FROM items GROUP BY type").fetchall()
    by_type = {r["type"]: r["c"] for r in rows}
    cats = conn.execute(
        "SELECT category, COUNT(*) AS c FROM items GROUP BY category ORDER BY c DESC"
    ).fetchall()
    total = conn.execute("SELECT COUNT(*) AS c FROM items").fetchone()["c"]
    opens = conn.execute("SELECT COALESCE(SUM(opens),0) AS c FROM items").fetchone()["c"]
    favs = conn.execute("SELECT COUNT(*) AS c FROM items WHERE favorite=1").fetchone()["c"]
    conn.close()
    return {
        "total": total,
        "opens": opens,
        "favorites": favs,
        "by_type": by_type,
        "categories": [{"name": r["category"], "count": r["c"]} for r in cats],
    }


# ---------------------------------------------------------------- HTTP 服务

class Handler(BaseHTTPRequestHandler):
    server_version = "SkillLibrary/1.0"

    def log_message(self, fmt, *args):  # 安静模式
        pass

    def _send(self, code, body, ctype="application/json; charset=utf-8"):
        data = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _body(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0:
                return {}
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except Exception:
            return {}

    # ---- GET

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        qs = urllib.parse.parse_qs(parsed.query)

        if path == "/api/health":
            return self._send(200, {"ok": True})

        if path == "/api/stats":
            return self._send(200, stats())

        if path == "/api/items":
            q = (qs.get("q") or [""])[0].strip()
            type_ = (qs.get("type") or [None])[0]
            cat = (qs.get("cat") or [None])[0]
            fav = (qs.get("fav") or [None])[0]
            fav = None if fav is None else (fav == "1")
            return self._send(200, list_items(q=q, type_=type_, cat=cat, fav=fav))

        m = re.match(r"^/api/items/(\d+)$", path)
        if m:
            item = get_item(int(m.group(1)))
            if not item:
                return self._send(404, {"error": "not found"})
            item["content"] = read_content(item)
            return self._send(200, item)

        # 静态文件
        if path == "/":
            rel = "index.html"
        elif path.startswith("/static/"):
            rel = urllib.parse.unquote(path[len("/static/"):])
        else:
            return self._send(404, {"error": "not found"})
        file_path = os.path.normpath(os.path.join(STATIC_DIR, rel))
        if not file_path.startswith(STATIC_DIR) or not os.path.isfile(file_path):
            return self._send(404, {"error": "not found"})
        ctype = mimetypes.guess_type(file_path)[0] or "application/octet-stream"
        with open(file_path, "rb") as fh:
            self._send(200, fh.read(), ctype)

    # ---- POST

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        data = self._body()

        if path == "/api/items/add":
            ok, msg = add_path(
                data.get("path", ""),
                type_=data.get("type"),
                category=data.get("category"),
                name=data.get("name"),
                copy=bool(data.get("copy", True)),
            )
            return self._send(200 if ok else 400, {"ok": ok, "message": msg})

        if path == "/api/scan":
            found = scan_skills(include_system=False)
            return self._send(200, {"ok": True, "count": len(found)})

        if path == "/api/openlib":
            open_in_finder(LIB_ROOT)
            return self._send(200, {"ok": True})

        m = re.match(r"^/api/items/(\d+)/(favorite|category|tags|open|openfile|delete|content)$", path)
        if not m:
            return self._send(404, {"error": "not found"})
        item_id = int(m.group(1))
        action = m.group(2)
        item = get_item(item_id)
        if not item:
            return self._send(404, {"error": "not found"})

        conn = db()
        now = datetime.now().isoformat(timespec="seconds")
        if action == "favorite":
            conn.execute("UPDATE items SET favorite=?, updated_at=? WHERE id=?", (1 if data.get("favorite") else 0, now, item_id))
            conn.commit()
            conn.close()
            return self._send(200, {"ok": True, "favorite": 1 if data.get("favorite") else 0})
        if action == "category":
            conn.execute("UPDATE items SET category=?, updated_at=? WHERE id=?", (data.get("category", "未分类"), now, item_id))
            conn.commit()
            conn.close()
            return self._send(200, {"ok": True})
        if action == "tags":
            conn.execute("UPDATE items SET tags=?, updated_at=? WHERE id=?", (data.get("tags", ""), now, item_id))
            conn.commit()
            conn.close()
            return self._send(200, {"ok": True})
        if action == "open":
            conn.execute("UPDATE items SET opens=opens+1, updated_at=? WHERE id=?", (now, item_id))
            conn.commit()
            opens = conn.execute("SELECT opens FROM items WHERE id=?", (item_id,)).fetchone()["opens"]
            conn.close()
            return self._send(200, {"ok": True, "opens": opens})
        if action == "openfile":
            conn.close()
            open_in_finder(item.get("path"))
            return self._send(200, {"ok": True})
        if action == "delete":
            conn.execute("DELETE FROM items WHERE id=?", (item_id,))
            conn.commit()
            conn.close()
            return self._send(200, {"ok": True})
        if action == "content":
            conn.close()
            p = item.get("path")
            if not p or not os.path.isfile(p):
                return self._send(400, {"ok": False, "error": "文件不存在，无法保存"})
            with open(p, "w", encoding="utf-8") as fh:
                fh.write(data.get("content", ""))
            conn = db()
            conn.execute("UPDATE items SET updated_at=? WHERE id=?", (now, item_id))
            conn.commit()
            conn.close()
            return self._send(200, {"ok": True})


def start_server(open_browser=False, quiet=False):
    init_db()
    try:
        scan_skills(include_system=False, quiet=True)
    except Exception:
        pass
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    url = f"http://127.0.0.1:{PORT}"
    if not quiet:
        print(f"Skill图书馆已启动：{url}  （按 Ctrl+C 停止）")
    if open_browser:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


# ---------------------------------------------------------------- 命令行

def cli_list(args):
    rows = list_items(q=args.q, type_=args.type, cat=args.cat, fav=1 if args.fav else None)
    if not rows:
        print("馆藏为空。先运行：lib.py scan，或 lib.py add <路径>")
        return
    for r in rows:
        fav = "★" if r["favorite"] else " "
        print(f"{fav} [{TYPES.get(r['type'], r['type'])}] {r['name']}  ({r['category']})  {r['path']}")
    print(f"\n共 {len(rows)} 件")


def cli_add(args):
    if not args.path:
        print("用法：python3 lib.py add <文件或技能目录路径>")
        sys.exit(1)
    type_ = args.type
    category = args.category
    # 交互询问（若未提供）
    if not type_:
        options = list(TYPES)
        print("选择类型：")
        for i, t in enumerate(options, 1):
            print(f"  {i}. {TYPES[t]}")
        ans = input(f"请输入数字（默认 2 提示词）: ").strip()
        type_ = options[int(ans) - 1] if ans.isdigit() and 1 <= int(ans) <= len(options) else "prompt"
    if not category:
        category = input("分类（直接回车 = 未分类）: ").strip() or "未分类"
    ok, msg = add_path(args.path, type_=type_, category=category, copy=not args.no_copy)
    print(msg)
    if not ok:
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(prog="lib", description="知识图书馆 · 本地 md 与技能管理")
    sub = parser.add_subparsers(dest="cmd")

    sub.add_parser("serve", help="启动本地网页")
    p_open = sub.add_parser("open", help="启动并打开浏览器")
    p_open.add_argument("--port", type=int, default=None)

    p_scan = sub.add_parser("scan", help="扫描技能入库")
    p_scan.add_argument("--system", action="store_true", help="同时收录内置插件技能")

    p_add = sub.add_parser("add", help="加入图书馆")
    p_add.add_argument("path", nargs="?", help="文件或技能目录路径")
    p_add.add_argument("-t", "--type", choices=list(TYPES), help="类型")
    p_add.add_argument("-c", "--category", help="分类")
    p_add.add_argument("--no-copy", action="store_true", help="不复制文件到图书馆目录")

    p_list = sub.add_parser("list", help="列出馆藏")
    p_list.add_argument("-q", help="搜索关键词")
    p_list.add_argument("--type", choices=list(TYPES))
    p_list.add_argument("--cat")
    p_list.add_argument("--fav", action="store_true")

    args = parser.parse_args()
    if args.cmd == "serve":
        start_server(open_browser=False)
    elif args.cmd == "open":
        global PORT
        if getattr(args, "port", None):
            PORT = args.port
        start_server(open_browser=True)
    elif args.cmd == "scan":
        init_db()
        scan_skills(include_system=args.system)
    elif args.cmd == "add":
        init_db()
        cli_add(args)
    elif args.cmd == "list":
        init_db()
        cli_list(args)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
