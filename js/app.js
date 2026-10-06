const SVG_NS = "http://www.w3.org/2000/svg";

const state = {
  tree: null,
  points: 15,
  hoveredId: null,
  focusedId: null,
  hoveredLock: null,
  selected: new Set(),
  learned: new Set(),
  nodeEls: {},
  skillMap: {},
  lockMap: {}
};

function $(id) {
  return document.getElementById(id);
}

function svgEl(name, attrs) {
  const el = document.createElementNS(SVG_NS, name);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  return el;
}

function ownedSet() {
  return new Set([...state.learned, ...state.selected]);
}

function lockSatisfied(lock, owned) {
  let n = 0;
  for (const s of state.tree.skills) {
    if (!lock.fromGroups.includes(s.group)) continue;
    if (s.lock === lock.id) continue;
    if (owned.has(s.id)) n++;
  }
  return n >= lock.count;
}

function canSelect(id, owned) {
  const s = state.skillMap[id];
  if (!s) return false;
  if ((s.requires || []).some(r => !owned.has(r))) return false;
  if (s.lock) {
    const lock = state.lockMap[s.lock];
    const others = new Set(owned);
    others.delete(id);
    if (!lockSatisfied(lock, others)) return false;
  }
  if ((s.exclusiveWith || []).some(e => owned.has(e))) return false;
  return true;
}

function pruneInvalidSelected() {
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of [...state.selected]) {
      const owned = ownedSet();
      if (!canSelect(id, owned)) {
        state.selected.delete(id);
        changed = true;
      }
    }
  }
}

function skillStatus(id) {
  if (state.learned.has(id)) return "learned";
  if (state.selected.has(id)) return "picked";
  if (state.hoveredId === id) return "hovered";
  return "";
}

function displaySkill() {
  if (state.hoveredId) return state.skillMap[state.hoveredId];
  if (state.focusedId) return state.skillMap[state.focusedId];
  return null;
}

async function loadJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error("无法加载 " + path);
  return res.json();
}

function charFromQuery(list) {
  const q = new URLSearchParams(location.search).get("char");
  return list.find(c => c.id === q) || list[0];
}

async function boot() {
  try {
    const index = await loadJSON("data/characters.json");
    const chars = index.characters || [];
    const current = charFromQuery(chars);
    fillCharSelect(chars, current.id);
    const tree = await loadJSON(current.data);
    initTree(tree);
  } catch (err) {
    $("load-error").hidden = false;
    $("load-error").textContent =
      "数据加载失败。GitHub Pages 或本地静态服务器下打开即可（不要用 file://）。\n" + err.message;
  }
}

function fillCharSelect(chars, currentId) {
  const sel = $("char-select");
  sel.innerHTML = "";
  chars.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = c.name;
    if (c.id === currentId) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.addEventListener("change", () => {
    location.search = "?char=" + encodeURIComponent(sel.value);
  });
}

function initTree(tree) {
  state.tree = tree;
  state.points = tree.points;
  state.skillMap = Object.fromEntries(tree.skills.map(s => [s.id, s]));
  state.lockMap = Object.fromEntries(tree.locks.map(l => [l.id, l]));
  $("char-title").textContent = tree.name;
  document.title = tree.name + " · 技能树";
  $("skill-total").textContent = String(tree.skills.length);

  buildNodes();
  buildDescColumns();
  fillBuildSelect();
  render();
}

function addLabel(x, y, w, h, text, fill, forId) {
  const t = svgEl("text", {
    x: x + w / 2,
    y: y + h / 2 + 4,
    "text-anchor": "middle",
    "font-size": forId ? "12" : "11",
    "font-weight": "bold",
    fill,
    "pointer-events": "none"
  });
  t.textContent = text;
  if (forId) t.dataset.labelFor = forId;
  $("node-labels").appendChild(t);
}

function buildNodes() {
  const nodes = $("nodes");
  const labels = $("node-labels");
  nodes.innerHTML = "";
  labels.innerHTML = "";
  state.nodeEls = {};

  state.tree.skills.forEach(s => {
    const el = svgEl("rect", {
      class: "node",
      x: s.x, y: s.y, width: s.w, height: s.h, rx: 4,
      fill: "#3a3a3a", stroke: "#666", "stroke-width": 1
    });
    el.dataset.id = s.id;
    el.style.cursor = "pointer";
    nodes.appendChild(el);
    state.nodeEls[s.id] = el;
    addLabel(s.x, s.y, s.w, s.h, String(s.n), "#ccc", s.id);
  });

  state.tree.locks.forEach(lock => {
    lock.nodes.forEach((n, i) => {
      const id = lock.id + "_" + i;
      const el = svgEl("rect", {
        class: "node lock",
        x: n.x, y: n.y, width: n.w, height: n.h, rx: 4,
        fill: "#2a2222", stroke: "#5a2020", "stroke-width": 1
      });
      el.dataset.lock = lock.id;
      el.dataset.id = id;
      el.style.cursor = "default";
      nodes.appendChild(el);
      state.nodeEls[id] = el;
      addLabel(n.x, n.y, n.w, n.h, "🔒", "#8b0000", null);
    });
  });
}

function buildDescColumns() {
  const panel = $("desc-panel");
  panel.innerHTML = "";
  state.tree.groups.forEach(g => {
    const col = document.createElement("div");
    col.className = "desc-col";
    col.dataset.group = g.id;
    col.style.left = ((g.x + 300) / 600) * 100 + "%";
    col.innerHTML =
      `<div class="parent-label">${g.name}</div>` +
      `<div class="col-body" data-body="${g.id}"></div>`;
    panel.appendChild(col);
  });
}

function fillBuildSelect() {
  const sel = $("build-select");
  sel.innerHTML = `<option value="">加点建议…</option>`;
  (state.tree.builds || []).forEach(b => {
    const opt = document.createElement("option");
    opt.value = b.id;
    opt.textContent = b.name;
    sel.appendChild(opt);
  });
}

function prereqText(skill) {
  const names = (skill.requires || []).map(id => state.skillMap[id]?.name || id);
  if (skill.lock) {
    const lock = state.lockMap[skill.lock];
    names.push(lock.desc);
  }
  if (skill.exclusiveWith) {
    const vs = skill.exclusiveWith.map(id => state.skillMap[id]?.name || id);
    names.push("与「" + vs.join("、") + "」互斥");
  }
  return names.length ? names.join("；") : "无";
}

function cardHTML(skill, extraClass) {
  const recipes = (skill.recipes || [])
    .map(r => `<li>${r}</li>`)
    .join("");
  return `
    <div class="desc-card ${extraClass}">
      <div class="desc-head">
        <span class="desc-num">${skill.n}</span>
        <span class="desc-name">${skill.name}</span>
      </div>
      <div class="desc-body">${skill.desc.replace(/\n/g, "<br>")}</div>
      ${recipes ? `<ul class="desc-recipes">${recipes}</ul>` : ""}
      <div class="desc-prereq">前置：${prereqText(skill)}</div>
    </div>`;
}

function updateDesc() {
  const skill = displaySkill();
  const lock = state.hoveredLock ? state.lockMap[state.hoveredLock] : null;

  document.querySelectorAll(".desc-col").forEach(col => {
    const gid = col.dataset.group;
    col.classList.toggle("active", !!(skill && skill.group === gid) || !!(lock && lock.group === gid));
    const body = col.querySelector(".col-body");
    if (skill && skill.group === gid) {
      body.innerHTML = cardHTML(skill, skillStatus(skill.id) || "hovered");
    } else if (lock && lock.group === gid && !skill) {
      body.innerHTML = `<div class="desc-card hovered lock-card">${lock.desc}</div>`;
    } else {
      body.innerHTML = "";
    }
  });
}

function updateNodeVisual(id) {
  const el = state.nodeEls[id];
  if (!el) return;

  if (el.dataset.lock) {
    const lock = state.lockMap[el.dataset.lock];
    const open = lockSatisfied(lock, ownedSet());
    el.setAttribute("fill", open ? "#3a3418" : "#2a2222");
    el.setAttribute("stroke", open ? "#c9a227" : "#5a2020");
    el.setAttribute("stroke-width", open ? "2" : "1");
    return;
  }

  const isLearned = state.learned.has(id);
  const isPicked = state.selected.has(id);
  const isHovered = state.hoveredId === id;
  const owned = ownedSet();
  const available = isLearned || isPicked || canSelect(id, new Set([...owned, id]));

  let fill = available ? "#3a3a3a" : "#2a2a2a";
  let stroke = available ? "#555" : "#3a3a3a";
  let sw = 1;
  let labelFill = available ? "#ccc" : "#666";

  if (isLearned) {
    fill = "#c9a227";
    stroke = "#f0d060";
    sw = 2;
    labelFill = "#1a1a1a";
  } else if (isPicked) {
    fill = "#3a3a3a";
    stroke = "#ffffff";
    sw = 2.5;
    labelFill = "#fff";
  } else if (isHovered) {
    fill = "#3a3a3a";
    stroke = "#9a9a9a";
    sw = 2;
    labelFill = "#ddd";
  }

  el.setAttribute("fill", fill);
  el.setAttribute("stroke", stroke);
  el.setAttribute("stroke-width", String(sw));
  const label = document.querySelector(`[data-label-for="${id}"]`);
  if (label) label.setAttribute("fill", labelFill);
}

function updateButtons() {
  const canLearn = state.selected.size > 0;
  const canReset = state.learned.size > 0 || state.selected.size > 0;
  $("btn-learn").style.cursor = canLearn ? "pointer" : "not-allowed";
  $("btn-reset").style.cursor = canReset ? "pointer" : "not-allowed";
  $("learn-bg").setAttribute("fill", canLearn ? "#c9a227" : "#3a3a3a");
  $("learn-bg").setAttribute("stroke", canLearn ? "#f0d060" : "#555");
  $("learn-text").setAttribute("fill", canLearn ? "#1a1a1a" : "#666");
  $("reset-bg").setAttribute("fill", canReset ? "#5a5a5a" : "#3a3a3a");
  $("reset-bg").setAttribute("stroke", canReset ? "#aaa" : "#555");
  $("reset-text").setAttribute("fill", canReset ? "#eee" : "#666");
}

function render() {
  Object.keys(state.nodeEls).forEach(updateNodeVisual);
  updateDesc();
  $("points-text").textContent = String(state.points - state.selected.size);
  $("learned-count").textContent = String(state.learned.size);
  $("picked-count").textContent = String(state.selected.size);
  updateButtons();
}

function pickNode(id) {
  if (state.learned.has(id)) {
    state.focusedId = id;
    render();
    return;
  }
  if (state.selected.has(id)) {
    state.selected.delete(id);
    pruneInvalidSelected();
    state.focusedId = id;
    render();
    return;
  }
  if (state.points - state.selected.size <= 0) return;
  const next = ownedSet();
  next.add(id);
  if (!canSelect(id, next)) return;
  state.selected.add(id);
  state.focusedId = id;
  render();
}

function learnSelected() {
  if (state.selected.size === 0) return;
  state.selected.forEach(id => state.learned.add(id));
  state.points -= state.selected.size;
  state.selected.clear();
  render();
}

function resetAll() {
  state.learned.clear();
  state.selected.clear();
  state.points = state.tree.points;
  state.hoveredId = null;
  state.focusedId = null;
  $("build-select").value = "";
  render();
}

function applyBuild(buildId) {
  const build = (state.tree.builds || []).find(b => b.id === buildId);
  if (!build) return;
  state.learned.clear();
  state.selected.clear();
  state.points = state.tree.points;
  for (const id of build.skills) {
    if (state.selected.size >= state.points) break;
    const next = ownedSet();
    next.add(id);
    if (canSelect(id, next)) state.selected.add(id);
  }
  state.focusedId = build.skills[build.skills.length - 1] || null;
  render();
}

$("nodes").addEventListener("click", e => {
  const el = e.target.closest(".node");
  if (!el || el.dataset.lock) return;
  pickNode(el.dataset.id);
});

$("nodes").addEventListener("mouseover", e => {
  const el = e.target.closest(".node");
  if (!el) return;
  if (el.dataset.lock) {
    state.hoveredLock = el.dataset.lock;
    state.hoveredId = null;
  } else {
    state.hoveredLock = null;
    state.hoveredId = el.dataset.id;
  }
  render();
});

$("nodes").addEventListener("mouseout", e => {
  const el = e.target.closest(".node");
  if (!el) return;
  state.hoveredId = null;
  state.hoveredLock = null;
  render();
});

$("btn-learn").addEventListener("click", learnSelected);
$("btn-reset").addEventListener("click", resetAll);
$("build-select").addEventListener("change", e => {
  if (e.target.value) applyBuild(e.target.value);
});

boot();
