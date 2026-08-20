/* Skill图书馆 · 本地知识管理（数据来自 lib.py API，交互参考 Local Skill Studio 原型） */

const TYPE_LABEL = { skill: "技能", prompt: "提示词", manual: "手册", tool: "工具" };
const KIND_LABEL = { skill: "技能", document: "文档" };

const SKILL_PRESENTATION = window.SKILL_GUIDES_ZH || {};

function presentationFor(title) {
  const meta = SKILL_PRESENTATION[title] || {};
  const cover = meta.cover
    ? `/static/assets/skills/${meta.cover}`
    : `/static/assets/skills/${encodeURIComponent(title)}.jpg`;
  return {
    cover,
    zh: meta.tagline || "本地可复用的 Skill，点击查看完整说明与使用方法。",
    guide: meta,
  };
}

const fallbackItems = [
  {
    id: "demo-1", title: "Cinematic Visual Director", kind: "skill", type: "skill",
    category: "视觉·设计", updated: "今天", updatedAt: Date.now(), favorite: false, opens: 0,
    tags: "", source: "", path: "skills/cinematic-director/SKILL.md", filename: "SKILL.md",
    description: "Create cinematic image and video generation instructions with consistent visual language.",
    content: "# Cinematic Visual Director\n\n## Purpose\nBuild cinematic prompts while preserving a consistent visual language.",
  },
  {
    id: "demo-2", title: "Research Brief Builder", kind: "skill", type: "skill",
    category: "数据·工具", updated: "3天前", updatedAt: Date.now() - 3 * 864e5, favorite: false, opens: 0,
    tags: "", source: "", path: "skills/research-brief/SKILL.md", filename: "SKILL.md",
    description: "Turn a broad topic into a structured research plan with source priorities.",
    content: "# Research Brief Builder\n\n## Checklist\n1. Define the decision.\n2. Separate facts and claims.",
  },
  {
    id: "demo-3", title: "Frontend Interaction Patterns", kind: "document", type: "manual",
    category: "开发·工具", updated: "1周前", updatedAt: Date.now() - 7 * 864e5, favorite: false, opens: 0,
    tags: "", source: "", path: "documents/frontend-patterns.md", filename: "frontend-patterns.md",
    description: "Notes on interaction patterns, motion and interface state for local tools.",
    content: "# Frontend Interaction Patterns\n\n## Motion\nUse motion to preserve spatial understanding.",
  },
];

const state = {
  route: "library",
  previousRoute: "library",
  items: [],
  selectedId: null,
  view: "orbit",
  live: false,
  filters: { type: "全部", category: "全部", updated: "全部", favorite: "全部" },
  previewVisible: true,
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const main = $("#main");
const footer = $("#footerFilter");

/* ---------------- 工具 ---------------- */

async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  return res.json();
}

function toast(msg) {
  const el = $("#toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 2200);
}

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return "—";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function typeLabel(item) {
  return TYPE_LABEL[item.type] || (item.kind === "skill" ? "技能" : "文档");
}

function copyText(text) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => toast("已复制到剪贴板"));
  } else {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    toast("已复制到剪贴板");
  }
}

/* ---------------- 数据 ---------------- */

function mapItem(r) {
  const path = r.path || "";
  const presentation = presentationFor(r.name);
  return {
    id: String(r.id),
    title: r.name || "未命名",
    kind: r.type === "skill" ? "skill" : "document",
    type: r.type,
    category: r.category || "未分类",
    updated: fmtDate(r.updated_at),
    updatedAt: Date.parse(r.updated_at) || Date.now(),
    favorite: !!r.favorite,
    opens: r.opens || 0,
    tags: r.tags || "",
    source: r.source || "",
    path,
    filename: path.split("/").pop() || "",
    description: r.description || "",
    zhDescription: presentation.zh,
    guide: presentation.guide,
    cover: presentation.cover,
    content: "",
  };
}

async function loadItems() {
  try {
    const rows = await api("/api/items");
    state.live = true;
    state.items = rows.map(mapItem);
  } catch (e) {
    state.live = false;
    state.items = fallbackItems.map((x) => {
      const p = presentationFor(x.title);
      return { ...x, cover: p.cover, zhDescription: p.zh };
    });
  }
  if (state.items.length) {
    if (!state.items.some((x) => x.id === state.selectedId)) {
      state.selectedId = state.items[0].id;
    }
  } else {
    state.selectedId = null;
  }
}

async function ensureContent(item) {
  if (!item || item.content || !state.live) return;
  try {
    const r = await api(`/api/items/${item.id}`);
    if (r.content) item.content = r.content;
    if (r.description && !item.description) item.description = r.description;
  } catch (e) { /* 保持空内容 */ }
}

function updatedMatch(ts, range) {
  const days = (Date.now() - ts) / 864e5;
  if (range === "今天") return days < 1;
  if (range === "本周") return days < 7;
  if (range === "本月") return days < 30;
  return true;
}

function filteredItems(kind = null) {
  return state.items.filter((item) => {
    if (kind && item.kind !== kind) return false;
    const f = state.filters;
    if (f.type === "技能" && item.kind !== "skill") return false;
    if (f.type === "文档" && item.kind !== "document") return false;
    if (f.category !== "全部" && item.category !== f.category) return false;
    if (f.updated !== "全部" && !updatedMatch(item.updatedAt, f.updated)) return false;
    if (f.favorite === "已收藏" && !item.favorite) return false;
    return true;
  });
}

function uniqueCategories() {
  return [...new Set(state.items.map((i) => i.category))];
}

/* ---------------- Markdown ---------------- */

function renderMarkdown(md = "") {
  let src = md.replace(/^---[\s\S]*?---\s*/, "");
  src = src
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/```([\s\S]*?)```/g, (_, c) => `<pre><code>${c.trim()}</code></pre>`)
    .replace(/^### (.*)$/gm, "<h3>$1</h3>")
    .replace(/^## (.*)$/gm, "<h2>$1</h2>")
    .replace(/^# (.*)$/gm, "<h1>$1</h1>")
    .replace(/^> (.*)$/gm, "<blockquote>$1</blockquote>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  const lines = src.split("\n");
  let html = "", inList = false;
  for (const line of lines) {
    if (/^\s*[-*]\s+/.test(line)) {
      if (!inList) { html += "<ul>"; inList = true; }
      html += `<li>${line.replace(/^\s*[-*]\s+/, "")}</li>`;
    } else if (/^\s*\d+\.\s+/.test(line)) {
      if (!inList) { html += "<ol>"; inList = true; }
      html += `<li>${line.replace(/^\s*\d+\.\s+/, "")}</li>`;
    } else {
      if (inList) { html += "</ul>"; inList = false; }
      if (!line.trim()) continue;
      if (/^<(h\d|pre|blockquote)/.test(line)) html += line;
      else html += `<p>${line}</p>`;
    }
  }
  if (inList) html += "</ul>";
  return html;
}

/* ---------------- 路由 ---------------- */

function setRoute(route, opts = {}) {
  if (!["detail", "editor"].includes(route)) state.previousRoute = route;
  state.route = route;
  const paint = () => {
    $$(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.route === route || (route === "detail" && b.dataset.route === "library")));
    footer.style.display = route === "editor" || route === "detail" ? "none" : "flex";
    render();
    if (opts.scrollTop !== false) window.scrollTo({ top: 0, behavior: "instant" });
  };
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (document.startViewTransition && !reduce && main.childElementCount) {
    const transition = document.startViewTransition(paint);
    transition.finished.catch(() => { /* 快速连续导航时，浏览器可主动跳过旧过渡 */ });
  } else {
    paint();
  }
}

function render() {
  if (state.route === "library") return renderLibrary();
  if (state.route === "skills") return renderList("skill");
  if (state.route === "documents") return renderList("document");
  if (state.route === "detail") return renderDetail();
  if (state.route === "editor") return renderEditor();
}

/* ---------------- 图书馆（Editorial Showcase） ---------------- */

function renderLibrary() {
  const tpl = $("#libraryTemplate").content.cloneNode(true);
  main.replaceChildren(tpl);
  const items = filteredItems();

  if (!items.length) {
    main.replaceChildren(emptyStateHTML());
    bindEmptyState();
    return;
  }

  $("#libraryEyebrow").textContent = state.live ? "LOCAL / INDEXED" : "LOCAL / DEMO";
  const initial = Math.max(0, items.findIndex((x) => x.id === state.selectedId));
  let activeIndex = initial;
  state.selectedId = items[activeIndex].id;

  renderShowcaseBackdrop(items);
  renderShowcaseScrubber(items);
  updateShowcase(items, activeIndex, false);

  let wheelValue = 0;
  let wheelLocked = false;
  const select = (nextIndex, direction = 1) => {
    const normalized = ((nextIndex % items.length) + items.length) % items.length;
    if (normalized === activeIndex) return;
    activeIndex = normalized;
    updateShowcase(items, activeIndex, true, direction);
  };

  $("#showcasePrev").addEventListener("click", () => select(activeIndex - 1, -1));
  $("#showcaseNext").addEventListener("click", () => select(activeIndex + 1, 1));
  $("#statusScan").addEventListener("click", scanSkills);
  $("#showcaseOpen").addEventListener("click", () => openItem(items[activeIndex].id));

  $$(".backdrop-card", $("#showcaseBackdrop")).forEach((card, index) => {
    card.addEventListener("mouseenter", () => select(index, index >= activeIndex ? 1 : -1));
    card.addEventListener("focus", () => select(index, index >= activeIndex ? 1 : -1));
    card.addEventListener("click", () => select(index, index >= activeIndex ? 1 : -1));
  });
  $$(".scrubber-dot", $("#stageScrubber")).forEach((dot, index) => {
    dot.addEventListener("click", () => select(index, index >= activeIndex ? 1 : -1));
  });

  const stage = $("#showcaseStage");
  stage.addEventListener("wheel", (event) => {
    if (items.length < 2) return;
    event.preventDefault();
    wheelValue += Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    if (wheelLocked || Math.abs(wheelValue) < 24) return;
    const direction = wheelValue > 0 ? 1 : -1;
    wheelValue = 0;
    wheelLocked = true;
    select(activeIndex + direction, direction);
    setTimeout(() => { wheelLocked = false; }, 440);
  }, { passive: false });

  const onKey = (event) => {
    if (state.route !== "library" || event.target.matches("input, textarea, select")) return;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      select(activeIndex + 1, 1);
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      select(activeIndex - 1, -1);
    }
    if (event.key === "Enter" && document.activeElement === document.body) openItem(items[activeIndex].id);
  };
  document.addEventListener("keydown", onKey, { signal: showcaseAbort.signal });
}

let showcaseAbort = new AbortController();

function renderShowcaseBackdrop(items) {
  showcaseAbort.abort();
  showcaseAbort = new AbortController();
  const backdrop = $("#showcaseBackdrop");
  backdrop.innerHTML = "";
  items.forEach((item, index) => {
    const button = document.createElement("button");
    button.className = "backdrop-card";
    button.type = "button";
    button.dataset.itemId = item.id;
    button.setAttribute("aria-label", `预览 ${item.title}`);
    button.innerHTML = `<img src="${item.cover}" alt="" loading="lazy" decoding="async" onerror="this.remove()" /><span>${String(index + 1).padStart(2, "0")}</span>`;
    backdrop.appendChild(button);
  });
}

function renderShowcaseScrubber(items) {
  const scrubber = $("#stageScrubber");
  scrubber.innerHTML = "";
  items.forEach((item, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "scrubber-dot";
    button.setAttribute("aria-label", `切换到 ${item.title}`);
    button.innerHTML = `<span>${String(index + 1).padStart(2, "0")}</span>`;
    scrubber.appendChild(button);
  });
}

function updateShowcase(items, index, animate = true, direction = 1) {
  const item = items[index];
  if (!item) return;
  state.selectedId = item.id;
  const guide = item.guide || {};
  $("#railCounter").textContent = `${String(index + 1).padStart(2, "0")} / ${String(items.length).padStart(2, "0")}`;
  $("#railCategory").textContent = `${item.category} / ${typeLabel(item)}`;
  $("#railTitle").textContent = item.title;
  $("#railDescription").textContent = item.zhDescription;
  const highlights = (guide.canDo || []).slice(0, 3);
  $("#railCapabilities").innerHTML = highlights.map((text, i) => `<div><span>0${i + 1}</span><p>${text}</p></div>`).join("");
  $("#railMeta").innerHTML = [
    ["类型", typeLabel(item)], ["分类", item.category], ["更新", item.updated], ["位置", state.live ? "LOCAL LIBRARY" : "DEMO"]
  ].map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join("");
  $("#stageIndex").textContent = `SKILL ${String(index + 1).padStart(2, "0")}`;
  $("#stageTitle").textContent = item.title;
  $("#stageKind").textContent = item.category;
  const image = $("#stageImage");
  image.onerror = () => { image.style.display = "none"; };
  image.onload = () => { image.style.display = ""; };
  image.src = item.cover;
  image.alt = `${item.title} 的视觉封面`;
  $("#showcaseOpen").onclick = () => openItem(item.id);

  $$(".backdrop-card", $("#showcaseBackdrop")).forEach((card, i) => card.classList.toggle("active", i === index));
  $$(".scrubber-dot", $("#stageScrubber")).forEach((dot, i) => dot.classList.toggle("active", i === index));

  const orbit = $("#stageOrbit");
  const degrees = 360 / Math.max(1, items.length);
  orbit.style.setProperty("--disc-rotation", `${index * -degrees}deg`);
  const frame = $("#stageFrame");
  if (animate && frame.animate && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    frame.getAnimations().forEach((animation) => animation.cancel());
    frame.animate([
      { opacity: .45, transform: `translate3d(${direction * 18}px, 0, 0) scale(.992)` },
      { opacity: 1, transform: "translate3d(0, 0, 0) scale(1)" }
    ], { duration: 620, easing: "cubic-bezier(.16,1,.3,1)" });
    const rail = $("#railTitle").closest(".showcase-rail");
    rail.getAnimations().forEach((animation) => animation.cancel());
    rail.animate([{ opacity: .72 }, { opacity: 1 }], { duration: 420, easing: "ease-out" });
  }
}

function emptyStateHTML() {
  return `
    <section class="workspace-empty page-enter">
      <h1>Skill图书馆</h1>
      <p>还没有馆藏。加入一个文件或技能目录，或者扫描本机的技能。</p>
      <div class="empty-actions">
        <button id="emptyAdd">＋ 入库</button>
        <button id="emptyScan">↻ 扫描技能</button>
      </div>
    </section>`;
}

function bindEmptyState() {
  $("#emptyAdd")?.addEventListener("click", openAddDialog);
  $("#emptyScan")?.addEventListener("click", scanSkills);
}

/* ---------------- 列表（Stack） ---------------- */

function renderList(kind) {
  const tpl = $("#listTemplate").content.cloneNode(true);
  main.replaceChildren(tpl);
  const items = filteredItems(kind);

  if (!items.length) {
    main.replaceChildren(emptyStateHTML());
    bindEmptyState();
    return;
  }

  const title = kind === "skill" ? "技能" : "文档";
  $("#listEyebrow").textContent = kind === "skill" ? "LOCAL / SKILLS" : "LOCAL / DOCUMENTS";
  $("#listTitle").textContent = title;
  $("#listIntro").textContent = kind === "skill"
    ? "本机可复用的能力文件，以图书馆而非文件夹的方式呈现。"
    : "提示词、手册与工具索引。";

  const gallery = $("#stackGallery");
  const index = document.createElement("div");
  index.className = "stack-index";
  const stage = document.createElement("div");
  stage.className = "stack-stage";
  gallery.append(index, stage);
  let activeIndex = 0;
  let wheelLock = false;

  items.forEach((item, i) => {
    const b = document.createElement("button");
    b.innerHTML = `<span class="idx">${String(i + 1).padStart(2, "0")}</span><span>${item.title}</span><span class="kind">${item.category}</span>`;
    b.classList.toggle("active", i === 0);
    b.addEventListener("mouseenter", () => activateStack(i));
    b.addEventListener("click", () => openItem(item.id));
    index.appendChild(b);
    const c = document.createElement("button");
    c.className = "stack-card";
    c.innerHTML = `<img src="${item.cover}" alt="" loading="lazy" decoding="async" onerror="this.remove()" /><span class="stack-kind">${typeLabel(item)}</span><span class="stack-title">${item.title}</span>`;
    c.addEventListener("mouseenter", () => activateStack(i));
    c.addEventListener("click", () => openItem(item.id));
    stage.appendChild(c);
  });

  function activateStack(active) {
    activeIndex = Math.max(0, Math.min(items.length - 1, active));
    $$(".stack-index button", gallery).forEach((b, i) => b.classList.toggle("active", i === activeIndex));
    $$(".stack-card", stage).forEach((c, i) => {
      const d = i - activeIndex;
      const distance = Math.abs(d);
      c.style.transform = `translate3d(${d * -30}px, ${d * -14}px, 0) scale(${Math.max(.80, 1 - distance * .038)}) rotate(${d * -.28}deg)`;
      c.style.opacity = distance > 6 ? "0" : String(Math.max(.16, 1 - distance * .125));
      c.style.zIndex = String(80 - Math.round(distance * 7));
      c.style.pointerEvents = distance > 6 ? "none" : "auto";
    });
  }

  gallery.addEventListener("wheel", (e) => {
    if (items.length < 2 || Math.abs(e.deltaY) < 5) return;
    e.preventDefault();
    if (wheelLock) return;
    wheelLock = true;
    setTimeout(() => wheelLock = false, 90);
    activateStack(activeIndex + (e.deltaY > 0 ? 1 : -1));
  }, { passive: false });

  activateStack(0);
}

/* ---------------- 详情 ---------------- */

async function openItem(id) {
  state.selectedId = id;
  await ensureContent(selectedItem());
  setRoute("detail");
}

function selectedItem() {
  return state.items.find((x) => x.id === state.selectedId);
}

function renderChineseGuide(item) {
  const guide = item.guide || {};
  const sections = [
    ["能做什么", guide.canDo],
    ["什么时候用", guide.when],
    ["它怎么工作", guide.workflow],
    ["会交付什么", guide.output],
  ];
  if (!sections.some(([, values]) => values?.length)) {
    return `<section class="guide-section"><h2>中文说明</h2><p>${item.zhDescription || "暂无中文详解。"}</p></section>`;
  }
  return sections.filter(([, values]) => values?.length).map(([title, values], sectionIndex) => `
    <section class="guide-section">
      <div class="guide-section-head"><span>${String(sectionIndex + 1).padStart(2, "0")}</span><h2>${title}</h2></div>
      <ul>${values.map((value) => `<li>${value}</li>`).join("")}</ul>
    </section>`).join("");
}

function renderDetail() {
  const item = selectedItem();
  if (!item) return setRoute("library");
  const tpl = $("#detailTemplate").content.cloneNode(true);
  main.replaceChildren(tpl);
  $("#detailKind").textContent = `${item.category} / ${typeLabel(item)}`;
  $("#detailTitle").textContent = item.title;
  $("#detailDescription").textContent = item.zhDescription || "本地 Markdown 内容。";
  const hero = $("#detailCover");
  const coverWrap = $("#detailCoverWrap");
  coverWrap.hidden = false;
  hero.onerror = () => { coverWrap.hidden = true; };
  hero.onload = () => { coverWrap.hidden = false; };
  hero.src = item.cover;
  hero.alt = `${item.title} 的生成封面`;
  $("#heroFilename").textContent = item.filename || "SKILL.md";
  $("#heroMeta").textContent = item.path || "local";
  const clean = (item.content || "").replace(/^---[\s\S]*?---\s*/, "").trim().split("\n").slice(0, 8).join("\n");
  $("#heroPreview").textContent = clean;
  $("#detailChinese").innerHTML = renderChineseGuide(item);
  $("#markdownBody").innerHTML = renderMarkdown(item.content);
  if (item.type === "manual") {
    $("#detailGuideLabel").textContent = "中文能力导读";
    $("#detailOriginalLabel").textContent = "原始手册";
    $("#detailOriginalLang").textContent = "ZH";
    $(".original-guide").setAttribute("lang", "zh-CN");
  }
  if (item.type === "prompt") {
    $("#detailGuideLabel").textContent = "中文能力导读";
    $("#detailOriginalLabel").textContent = "原始提示词库";
    $("#detailOriginalLang").textContent = "ZH";
    $(".original-guide").setAttribute("lang", "zh-CN");
  }
  const stats = [
    ["类型", typeLabel(item)],
    ["更新", item.updated],
    ["分类", item.category],
    ["使用", item.opens + " 次"],
    ["路径", item.path || "—"],
  ];
  $("#detailStats").innerHTML = stats.map(([label, value]) =>
    `<div class="stat"><span class="label">${label}</span><span class="value">${value}</span></div>`).join("");

  const favBtn = $("#favBtn");
  favBtn.textContent = (item.favorite ? "♥ 已收藏" : "♥ 收藏");
  favBtn.classList.toggle("on", !!item.favorite);
  favBtn.addEventListener("click", async () => {
    const next = item.favorite ? 0 : 1;
    const r = await api(`/api/items/${item.id}/favorite`, { method: "POST", body: JSON.stringify({ favorite: next }) });
    item.favorite = !!r.favorite;
    favBtn.textContent = item.favorite ? "♥ 已收藏" : "♥ 收藏";
    favBtn.classList.toggle("on", item.favorite);
    toast(item.favorite ? "已加入收藏" : "已取消收藏");
  });
  $("#copyBtn").addEventListener("click", () => copyText(item.content || item.description || item.title));
  $("#openBtn").addEventListener("click", async () => {
    await api(`/api/items/${item.id}/openfile`, { method: "POST", body: "{}" });
    toast("已在 Finder 中打开");
  });
  $("#editBtn").addEventListener("click", () => setRoute("editor"));
  $("#backBtn").addEventListener("click", () => setRoute(state.previousRoute || "library"));

  const orgCat = $("#orgCat");
  const orgTags = $("#orgTags");
  orgCat.value = item.category;
  orgTags.value = item.tags;
  const saveOrg = async () => {
    if (orgCat.value.trim() !== item.category) {
      await api(`/api/items/${item.id}/category`, { method: "POST", body: JSON.stringify({ category: orgCat.value.trim() || "未分类" }) });
      item.category = orgCat.value.trim() || "未分类";
    }
    await api(`/api/items/${item.id}/tags`, { method: "POST", body: JSON.stringify({ tags: orgTags.value.trim() }) });
    item.tags = orgTags.value.trim();
    toast("分类 / 标签已保存");
  };
  orgCat.addEventListener("change", saveOrg);
  orgTags.addEventListener("change", saveOrg);
}

/* ---------------- 编辑器 ---------------- */

function renderEditor() {
  const item = selectedItem();
  if (!item) return setRoute("library");
  const tpl = $("#editorTemplate").content.cloneNode(true);
  main.replaceChildren(tpl);
  const area = $("#editorArea"), preview = $("#editorPreview"), grid = $("#editorGrid"), saveState = $("#saveState");
  $("#editorName").textContent = item.path || item.title;
  area.value = item.content || "";
  preview.innerHTML = renderMarkdown(item.content);
  if (!state.previewVisible) grid.classList.add("preview-hidden");
  let previewTimer = 0;
  area.addEventListener("input", () => {
    saveState.textContent = "未保存";
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => { preview.innerHTML = renderMarkdown(area.value); }, 55);
  });
  $("#previewToggle").addEventListener("click", () => {
    state.previewVisible = !state.previewVisible;
    grid.classList.toggle("preview-hidden", !state.previewVisible);
  });
  $("#saveBtn").addEventListener("click", async () => {
    saveState.textContent = "保存中…";
    const r = await api(`/api/items/${item.id}/content`, { method: "POST", body: JSON.stringify({ content: area.value }) });
    if (r.ok) {
      item.content = area.value;
      item.updated = "刚刚";
      saveState.textContent = "已保存";
      toast("已保存到原文件");
    } else {
      saveState.textContent = "保存失败";
      toast(r.error || "保存失败（演示数据不可写）");
    }
  });
  $("#editorBack").addEventListener("click", () => setRoute("detail"));
}

/* ---------------- 搜索 ---------------- */

function openSearch() {
  const dlg = $("#searchDialog");
  if (!dlg.open) dlg.showModal();
  const input = $("#searchInput");
  input.value = "";
  renderSearch("");
  setTimeout(() => input.focus(), 20);
}

function renderSearch(q) {
  q = q.trim().toLowerCase();
  const results = state.items.filter((x) =>
    !q || [x.title, x.description, x.content, x.path, x.category, x.tags].join(" ").toLowerCase().includes(q)
  ).slice(0, 20);
  const box = $("#searchResults");
  if (!results.length) {
    box.innerHTML = '<div class="empty-search">没有匹配的本地条目。</div>';
    return;
  }
  const skills = results.filter((x) => x.kind === "skill");
  const docs = results.filter((x) => x.kind === "document");
  box.innerHTML = "";
  [["SKILLS", skills], ["DOCUMENTS", docs]].forEach(([label, list]) => {
    if (!list.length) return;
    const h = document.createElement("div");
    h.className = "result-group-title";
    h.textContent = label;
    box.appendChild(h);
    list.forEach((item, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "search-result";
      b.innerHTML = `<span class="r-idx">${String(i + 1).padStart(2, "0")}</span><span class="r-title">${item.title}</span><span class="r-kind">${item.category}</span>`;
      b.addEventListener("click", () => {
        $("#searchDialog").close();
        openItem(item.id);
      });
      box.appendChild(b);
    });
  });
}

/* ---------------- 筛选 ---------------- */

function showFilter(type) {
  const map = {
    type: ["全部", "技能", "文档"],
    category: ["全部", ...uniqueCategories()],
    updated: ["全部", "今天", "本周", "本月"],
    favorite: ["全部", "已收藏"],
  };
  const names = { type: "类型", category: "分类", updated: "更新", favorite: "收藏" };
  $("#filterTitle").textContent = names[type];
  const box = $("#filterOptions");
  box.innerHTML = "";
  map[type].forEach((v) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = v;
    b.addEventListener("click", () => {
      state.filters[type] = v;
      $("#filterDialog").close();
      render();
      updateFilterLabels();
    });
    box.appendChild(b);
  });
  $("#filterDialog").showModal();
}

function updateFilterLabels() {
  $$(".filter-item").forEach((b) => {
    const k = b.dataset.filter;
    const v = state.filters[k];
    const names = { type: "类型", category: "分类", updated: "更新", favorite: "收藏" };
    b.textContent = v === "全部" ? names[k] : `${names[k]}: ${v}`;
    b.classList.toggle("active", v !== "全部" || k === "type");
  });
}

/* ---------------- 入库 / 扫描 ---------------- */

function openAddDialog() {
  const opts = uniqueCategories();
  $("#catOptions").innerHTML = opts.map((c) => `<option value="${c}">`).join("");
  $("#addMsg").textContent = "";
  $("#addDialog").showModal();
  setTimeout(() => $("#addPath").focus(), 20);
}

async function scanSkills() {
  const r = await api("/api/scan", { method: "POST", body: "{}" });
  toast(r.ok ? `扫描完成，共 ${r.count} 个技能` : "扫描失败");
  await loadItems();
  updateFilterLabels();
  render();
}

/* ---------------- 初始化 ---------------- */

$$(".nav-item").forEach((b) => b.addEventListener("click", () => setRoute(b.dataset.route)));
$("#brandBtn").addEventListener("click", () => setRoute("library"));
$("#searchBtn").addEventListener("click", openSearch);
$("#addBtn").addEventListener("click", openAddDialog);
$("#searchInput").addEventListener("input", (e) => renderSearch(e.target.value));
$$(".filter-item").forEach((b) => b.addEventListener("click", () => showFilter(b.dataset.filter)));

$("#addDialog").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = JSON.stringify({
    path: $("#addPath").value.trim(),
    type: $("#addType").value,
    category: $("#addCat").value.trim() || "未分类",
    copy: $("#addCopy").checked,
  });
  const r = await api("/api/items/add", { method: "POST", body });
  if (r.ok) {
    $("#addMsg").textContent = "";
    $("#addDialog").close();
    $("#addPath").value = "";
    toast(r.message);
    await loadItems();
    updateFilterLabels();
    render();
  } else {
    $("#addMsg").textContent = r.message;
  }
});

$("#scanBtn").addEventListener("click", scanSkills);

document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    openSearch();
  }
});

async function init() {
  await loadItems();
  updateFilterLabels();
  render();
}

init();
