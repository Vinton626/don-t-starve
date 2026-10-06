const SVG_NS = "http://www.w3.org/2000/svg";

const state = {
  tree: null,
  points: 15,
  hoveredId: null,
  stickyId: null,
  focusedId: null,
  hoveredLock: null,
  hoveredLockNode: null,
  lockTip: null,
  lunar: false,
  shadow: false,
  players: null,
  preset: false,
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

function skillLockIds(skill) {
  if (Array.isArray(skill.locks) && skill.locks.length) return skill.locks;
  if (skill.lock) return [skill.lock];
  return [];
}

function scopeGroupIds(scope, lock) {
  if (scope === "其他" || scope === "其它") {
    return state.tree.groups.filter(g => g.id !== lock.group).map(g => g.id);
  }
  const names = scope.split(/和|与|、|或|及/).map(s => s.trim()).filter(Boolean);
  const ids = [];
  names.forEach(name => {
    state.tree.groups.forEach(g => {
      if (g.name === name) ids.push(g.id);
    });
  });
  return ids;
}

function learnedMatches(lock, owned, groupIds, nameNeedle) {
  let n = 0;
  for (const s of state.tree.skills) {
    if (skillLockIds(s).includes(lock.id)) continue;
    if (groupIds) {
      if (!groupIds.includes(s.group)) continue;
    } else if (!s.name || !s.name.includes(nameNeedle)) {
      continue;
    }
    if (owned.has(s.id)) n++;
  }
  return n;
}

// 锁开不开只看描述里写的条件，不再默认「亲和要 12 个」。
function lockTextMet(text, lock, owned) {
  const raw = text || "";
  const counted = raw.match(/学习\s*(\d+)\s*个(.+?)技能/);
  if (counted) {
    const need = Number(counted[1]);
    const scope = counted[2].trim();
    const groupIds = scopeGroupIds(scope, lock);
    const n = groupIds.length
      ? learnedMatches(lock, owned, groupIds)
      : learnedMatches(lock, owned, null, scope);
    return n >= need;
  }
  const named = raw.match(/需要学会「([^」]+)」/);
  if (named) {
    const skill = state.tree.skills.find(s => s.name === named[1]);
    return !!(skill && owned.has(skill.id));
  }
  return true;
}

function lockSatisfied(lock, owned) {
  return lockTextMet(lock.desc || "", lock, owned);
}

function affinityTaken(kind) {
  const needle = "获得" + kind + "亲和";
  for (const id of new Set([...state.selected, ...state.learned])) {
    const skill = state.skillMap[id];
    if (skill && skill.desc && skill.desc.includes(needle)) return true;
  }
  return false;
}

function nodeIsSealed(node, lock) {
  const text = `${(node && node.tip) || ""} ${lock.desc || ""}`;
  if (text.includes("没有月亮亲和") && affinityTaken("月亮")) return true;
  if (text.includes("没有暗影亲和") && affinityTaken("暗影")) return true;
  return false;
}

function pointsLeft() {
  return state.points - state.selected.size;
}

function canSelect(id, owned) {
  const s = state.skillMap[id];
  if (!s) return false;
  if ((s.requires || []).some(r => !owned.has(r))) return false;
  for (const lockId of skillLockIds(s)) {
    const lock = state.lockMap[lockId];
    if (!lock) continue;
    const others = new Set(owned);
    others.delete(id);
    if (!lockSatisfied(lock, others)) return false;
  }
  const taken = new Set([...owned, ...state.selected, ...state.learned]);
  if ((s.exclusiveWith || []).some(e => e !== id && taken.has(e))) return false;
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
  if (state.hoveredId === id || state.stickyId === id) return "hovered";
  return "";
}

function displaySkill() {
  const id = state.hoveredId || state.stickyId;
  return id ? state.skillMap[id] : null;
}

async function loadJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error("无法加载 " + path);
  return res.json();
}

function hasSkillTree(c) {
  return c.skillTree !== false && !!c.data;
}

function charFromQuery(list) {
  const playable = list.filter(hasSkillTree);
  const q = new URLSearchParams(location.search).get("char");
  return playable.find(c => c.id === q) || playable[0] || list[0];
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
  const btn = $("char-picker-btn");
  const menu = $("char-picker-menu");
  const current = chars.find(c => c.id === currentId);
  $("char-picker-label").textContent = current ? current.name : "选择人物";
  menu.innerHTML = "";
  chars.forEach(c => {
    const opt = document.createElement("button");
    opt.type = "button";
    opt.className = "char-option";
    opt.textContent = c.name;
    if (c.id === currentId) opt.classList.add("current");
    if (!hasSkillTree(c)) {
      opt.classList.add("is-locked");
      opt.dataset.tip = "该角色尚未领悟技能树";
    }
    opt.addEventListener("click", e => {
      e.stopPropagation();
      if (!hasSkillTree(c)) {
        showModeTip(opt, true);
        return;
      }
      location.search = "?char=" + encodeURIComponent(c.id);
    });
    opt.addEventListener("mouseenter", () => {
      if (!hasSkillTree(c)) showModeTip(opt, true);
    });
    opt.addEventListener("mouseleave", hideModeTip);
    menu.appendChild(opt);
  });
  btn.addEventListener("click", e => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
    if (menu.hidden) hideModeTip();
  });
  document.addEventListener("click", () => {
    menu.hidden = true;
    hideModeTip();
  });
}

function initTree(tree) {
  state.tree = tree;
  state.points = tree.points;
  state.skillMap = Object.fromEntries(tree.skills.map(s => [s.id, s]));
  state.lockMap = Object.fromEntries(tree.locks.map(l => [l.id, l]));
  document.title = tree.name + " · 技能树";
  $("skill-total").textContent = String(tree.skills.length);

  buildNodes();
  fitViewBox();
  buildDescColumns();
  fillBuildSelect();
  state.preset = false;
  state.lunar = false;
  state.shadow = false;
  state.players = null;
  syncPresetChrome();
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
      fill: "#2c241c", stroke: "#6a5434", "stroke-width": 1
    });
    el.dataset.id = s.id;
    el.style.cursor = "pointer";
    nodes.appendChild(el);
    state.nodeEls[s.id] = el;
    addLabel(s.x, s.y, s.w, s.h, String(s.n), "#e6d3a4", s.id);
  });

  buildGroupTitles();

  state.tree.locks.forEach(lock => {
    lock.nodes.forEach((n, i) => {
      const id = lock.id + "_" + i;
      const el = svgEl("rect", {
        class: "node lock",
        x: n.x, y: n.y, width: n.w, height: n.h, rx: 4,
        fill: "#241816", stroke: "#6a3030", "stroke-width": 1
      });
      el.dataset.lock = lock.id;
      el.dataset.id = id;
      el.setAttribute("data-tip", n.tip || "在这里写锁的描述");
      el.style.cursor = "pointer";
      nodes.appendChild(el);
      state.nodeEls[id] = el;
      addLabel(n.x, n.y, n.w, n.h, "🔒", "#8b0000", null);
    });
  });
}

function groupFrame(groupId, fallbackX) {
  const boxes = [];
  state.tree.skills.forEach(s => {
    if (s.group === groupId) boxes.push(s);
  });
  state.tree.locks.forEach(lock => {
    if (lock.group !== groupId) return;
    lock.nodes.forEach(n => boxes.push(n));
  });
  if (!boxes.length) {
    return { cx: fallbackX, cy: -96, top: -112, left: fallbackX, width: 0, height: 0 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  boxes.forEach(b => {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  });
  const width = maxX - minX;
  const height = maxY - minY;
  return {
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    top: minY,
    left: minX,
    width,
    height
  };
}

function titlePoint(frame, group) {
  if (group && group.titleAt) {
    return { x: group.titleAt.x, y: group.titleAt.y, middle: true };
  }
  // 名称在这一块自己的上沿正中，不跟其他列对齐。
  return { x: frame.cx, y: frame.top - 16, middle: false };
}

function appendGroupTitle(layer, g, frame) {
  const texts = [];
  if (g.titleSide === "left" || g.titleSide === "right") {
    const chars = Array.from(g.name);
    const step = 18;
    let x;
    let start;
    if (g.titlePin) {
      const skill = state.tree.skills.find(s => s.n === g.titlePin.n);
      const cy = skill.y + skill.h / 2;
      const idx = Math.max(0, chars.indexOf(g.titlePin.char));
      start = cy - idx * step;
      const gap = 20;
      x = g.titleSide === "left" ? skill.x - gap : skill.x + skill.w + gap;
    } else if (g.titleSide === "left") {
      x = frame.left - 20;
      start = frame.cy - ((chars.length - 1) * step) / 2;
    } else {
      x = frame.left + frame.width + 20;
      start = frame.cy - ((chars.length - 1) * step) / 2;
    }
    chars.forEach((ch, i) => {
      const title = svgEl("text", {
        class: "group-title",
        x,
        y: start + i * step,
        "text-anchor": "middle",
        "dominant-baseline": "middle",
        "font-size": "14",
        "font-weight": "bold",
        fill: "#8a7030"
      });
      title.dataset.group = g.id;
      title.textContent = ch;
      layer.appendChild(title);
      texts.push(title);
    });
  } else {
    const at = titlePoint(frame, g);
    const attrs = {
      class: "group-title",
      x: at.x,
      y: at.y,
      "text-anchor": "middle",
      "font-size": "14",
      "font-weight": "bold",
      "letter-spacing": "3",
      fill: "#8a7030"
    };
    if (at.middle) attrs["dominant-baseline"] = "middle";
    const title = svgEl("text", attrs);
    title.dataset.group = g.id;
    title.textContent = g.name;
    layer.appendChild(title);
    texts.push(title);
  }

  const hit = svgEl("rect", {
    class: "group-title-hit",
    fill: "transparent"
  });
  hit.dataset.group = g.id;
  if (g.tip) {
    hit.classList.add("has-note");
    texts.forEach(title => title.classList.add("has-note"));
    hit.dataset.tip = g.tip;
    hit.addEventListener("mouseenter", () => showNoteTip(hit));
    hit.addEventListener("mouseleave", scheduleHideNoteTip);
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  texts.forEach(title => {
    const box = title.getBBox();
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  });
  hit.setAttribute("x", minX - 4);
  hit.setAttribute("y", minY - 2);
  hit.setAttribute("width", Math.max(1, maxX - minX + 8));
  hit.setAttribute("height", Math.max(1, maxY - minY + 4));
  layer.appendChild(hit);
}

function buildGroupTitles() {
  const layer = $("group-titles");
  layer.innerHTML = "";
  state.tree.groups.forEach(g => {
    appendGroupTitle(layer, g, groupFrame(g.id, g.x != null ? g.x : 0));
  });
}

function fitViewBox() {
  const svg = document.querySelector(".app svg");
  let minY = Infinity;
  let maxY = -Infinity;
  svg.querySelectorAll("#group-titles text, #group-titles rect, #nodes rect, #buttons rect").forEach(el => {
    const box = el.getBBox();
    minY = Math.min(minY, box.y);
    maxY = Math.max(maxY, box.y + box.height);
  });
  if (!Number.isFinite(minY)) return;
  const top = minY - 14;
  const bottom = maxY + 18;
  svg.setAttribute("viewBox", `-300 ${top} 600 ${bottom - top}`);
  const bg = $("tree-bg");
  bg.setAttribute("y", String(top));
  bg.setAttribute("height", String(bottom - top));
}

function buildDescColumns() {
  const panel = $("desc-panel");
  panel.innerHTML = "";
  const oldNote = $("note-tip");
  if (oldNote) oldNote.hidden = true;
  const labels = document.createElement("div");
  labels.className = "desc-labels";
  state.tree.groups.forEach(g => {
    const label = document.createElement("div");
    label.className = "parent-label";
    label.dataset.group = g.id;
    label.textContent = g.name;
    if (g.tip) {
      label.classList.add("has-note");
      label.dataset.tip = g.tip;
      label.addEventListener("mouseenter", () => showNoteTip(label));
      label.addEventListener("mouseleave", scheduleHideNoteTip);
    }
    labels.appendChild(label);
  });
  const note = $("note-tip");
  if (note && !note.dataset.bound) {
    note.dataset.bound = "1";
    note.addEventListener("mouseenter", () => clearTimeout(noteHideTimer));
    note.addEventListener("mouseleave", scheduleHideNoteTip);
  }
  const body = document.createElement("div");
  body.className = "desc-body";
  body.id = "desc-body";
  panel.appendChild(labels);
  panel.appendChild(body);
}

function fillBuildSelect() {
  const sel = $("build-select");
  sel.innerHTML = `<option value="">自由加点</option>`;
  (state.tree.builds || []).forEach(b => {
    const opt = document.createElement("option");
    opt.value = b.id;
    opt.textContent = b.name;
    sel.appendChild(opt);
  });
}

function prereqText(skill) {
  const names = (skill.requires || []).map(id => state.skillMap[id]?.name || id);
  skillLockIds(skill).forEach(lockId => {
    const lock = state.lockMap[lockId];
    if (lock) names.push(lock.desc);
  });
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
  document.querySelectorAll(".parent-label").forEach(label => {
    label.classList.toggle("active", !!(skill && skill.group === label.dataset.group));
  });
  document.querySelectorAll(".group-title").forEach(title => {
    const on = !!(skill && skill.group === title.dataset.group);
    title.setAttribute("fill", on ? "#f0d060" : "#8a7030");
  });
  const body = $("desc-body");
  if (!body) return;
  if (!skill) {
    body.innerHTML = "";
    return;
  }
  body.innerHTML = cardHTML(skill, skillStatus(skill.id) || "hovered");
}

function updateNodeVisual(id) {
  const el = state.nodeEls[id];
  if (!el) return;

  if (el.dataset.lock) {
    const lock = state.lockMap[el.dataset.lock];
    const idx = Number(String(id).slice(lock.id.length + 1));
    const node = lock.nodes[idx];
    const open = !nodeIsSealed(node, lock) && lockTextMet((node && node.tip) || lock.desc || "", lock, state.learned);
    const hot = state.hoveredLockNode === id;
    el.setAttribute("fill", open ? "#3a3418" : "#241816");
    el.setAttribute("stroke", hot ? "#f2f2f2" : (open ? "#c9a227" : "#6a3030"));
    el.setAttribute("stroke-width", hot || open ? "2" : "1");
    return;
  }

  const isLearned = state.learned.has(id);
  const isPicked = state.selected.has(id);
  const isHovered = state.hoveredId === id;
  const available = isLearned || isPicked || (pointsLeft() > 0 && canSelect(id, state.learned));

  let fill = available ? "#3a3024" : "#241c16";
  let stroke = available ? "#7a6240" : "#3d3228";
  let sw = 1;
  let labelFill = available ? "#e6d3a4" : "#6d5c48";

  if (isLearned) {
    fill = "#c9a227";
    stroke = "#f0d060";
    sw = 2;
    labelFill = "#1a120c";
  } else if (isPicked) {
    fill = "#3a3024";
    stroke = "#ffffff";
    sw = 3;
    labelFill = "#fff";
  } else if (isHovered) {
    fill = "#4a3c2a";
    stroke = "#cbb892";
    sw = 2;
    labelFill = "#f6edd8";
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
  $("learn-bg").setAttribute("fill", canLearn ? "#c9a227" : "#2a2118");
  $("learn-bg").setAttribute("stroke", canLearn ? "#f0d060" : "#6e5428");
  $("learn-text").setAttribute("fill", canLearn ? "#1a120c" : "#6d5c48");
  $("reset-bg").setAttribute("fill", canReset ? "#4a3824" : "#2a2118");
  $("reset-bg").setAttribute("stroke", canReset ? "#cbb892" : "#6e5428");
  $("reset-text").setAttribute("fill", canReset ? "#f6edd8" : "#6d5c48");
}

let noteHideTimer = 0;

function showNoteTip(label) {
  clearTimeout(noteHideTimer);
  const tip = $("note-tip");
  if (!tip || !label || !label.dataset.tip) return;
  tip._anchor = label;
  tip.hidden = false;
  tip.textContent = label.dataset.tip;
  const pad = 12;
  const app = document.querySelector(".app").getBoundingClientRect();
  const minX = Math.max(pad, app.left + 8);
  const maxRight = Math.min(window.innerWidth - pad, app.right - 8);
  const maxW = Math.max(140, Math.min(420, maxRight - minX));
  tip.style.maxWidth = maxW + "px";
  tip.style.left = minX + "px";
  tip.style.top = pad + "px";
  const box = tip.getBoundingClientRect();
  const anchor = label.getBoundingClientRect();
  let x = anchor.left + anchor.width / 2 - box.width / 2;
  let y = anchor.bottom + 8;
  x = Math.min(Math.max(minX, x), maxRight - box.width);
  if (y + box.height > window.innerHeight - pad) y = Math.max(pad, anchor.top - box.height - 8);
  tip.style.left = x + "px";
  tip.style.top = y + "px";
}

function scheduleHideNoteTip() {
  clearTimeout(noteHideTimer);
  noteHideTimer = setTimeout(() => {
    const tip = $("note-tip");
    if (tip) tip.hidden = true;
  }, 120);
}

function placeLockTip() {
  const tip = $("lock-tip");
  if (!tip) return;
  const el = state.hoveredLockNode ? state.nodeEls[state.hoveredLockNode] : null;
  if (!state.lockTip || !el) {
    tip.hidden = true;
    return;
  }
  tip.hidden = false;
  tip.textContent = state.lockTip;
  const pad = 12;
  const anchor = el.getBoundingClientRect();
  const maxW = Math.max(140, Math.min(280, window.innerWidth - pad * 2));
  tip.style.maxWidth = maxW + "px";
  tip.style.left = pad + "px";
  tip.style.top = pad + "px";
  const box = tip.getBoundingClientRect();
  let x = anchor.left + anchor.width / 2 - box.width / 2;
  let y = anchor.bottom + 8;
  x = Math.min(Math.max(pad, x), Math.max(pad, window.innerWidth - pad - box.width));
  if (y + box.height > window.innerHeight - pad) y = Math.max(pad, anchor.top - box.height - 8);
  tip.style.left = x + "px";
  tip.style.top = y + "px";
}

function render() {
  Object.keys(state.nodeEls).forEach(updateNodeVisual);
  updateDesc();
  $("points-text").textContent = String(state.points);
  $("learned-count").textContent = String(state.learned.size);
  updateButtons();
  placeLockTip();
}

function pickNode(id) {
  leavePreset();
  if (state.learned.has(id)) {
    state.focusedId = id;
    state.stickyId = id;
    render();
    return;
  }
  if (state.selected.has(id)) {
    state.selected.delete(id);
    pruneInvalidSelected();
    state.focusedId = id;
    state.stickyId = id;
    render();
    return;
  }
  state.focusedId = id;
  state.stickyId = id;
  if (pointsLeft() <= 0 || !canSelect(id, state.learned)) {
    render();
    return;
  }
  state.selected.add(id);
  render();
}

function learnSelected() {
  leavePreset();
  if (state.selected.size === 0) return;
  state.selected.forEach(id => state.learned.add(id));
  state.points -= state.selected.size;
  state.selected.clear();
  render();
}

function resetAll() {
  leavePreset();
  state.learned.clear();
  state.selected.clear();
  state.points = state.tree.points;
  state.hoveredId = null;
  state.focusedId = null;
  state.hoveredLock = null;
  state.hoveredLockNode = null;
  state.lockTip = null;
  $("build-select").value = "";
  render();
}

function applySkillList(ids) {
  state.learned.clear();
  state.selected.clear();
  state.points = state.tree.points;
  for (const id of ids || []) {
    if (state.selected.size >= state.points) break;
    const next = ownedSet();
    next.add(id);
    if (canSelect(id, next)) state.selected.add(id);
  }
  state.focusedId = (ids && ids[ids.length - 1]) || null;
  state.stickyId = state.focusedId;
  render();
}

function selectedBuild() {
  const id = $("build-select").value;
  return (state.tree.builds || []).find(b => b.id === id) || null;
}

function showPresetAllocation() {
  const scheme = currentModeScheme();
  if (scheme && (scheme.skills || []).length) {
    applySkillList(scheme.skills);
    return scheme;
  }
  const build = selectedBuild();
  if (build) applySkillList(build.skills);
  return scheme;
}

function syncPresetChrome() {
  $("mode-stack").classList.toggle("is-open", state.preset);
  $("stage-head").classList.toggle("preset", state.preset);
  paintModes();
}

function leavePreset() {
  if (!state.preset) return;
  state.preset = false;
  state.lunar = false;
  state.shadow = false;
  state.players = null;
  $("build-select").value = "";
  hideModeTip();
  syncPresetChrome();
}

function applyBuild(buildId) {
  const build = (state.tree.builds || []).find(b => b.id === buildId);
  if (!build) return;
  state.preset = true;
  syncPresetChrome();
  const scheme = showPresetAllocation();
  const body = scheme
    ? [scheme.name, scheme.text].filter(Boolean).join("\n")
    : (build.text || "");
  showDataPop(scheme ? affinityLine() : build.name, body, true);
}

function currentModeScheme() {
  if (!state.players || (!state.lunar && !state.shadow)) return null;
  const need = new Set([state.players === "solo" ? "单人" : "多人"]);
  if (state.lunar) need.add("月后");
  if (state.shadow) need.add("影后");
  return (state.tree.modes || []).find(mode => {
    const tags = new Set(mode.tags || []);
    if (tags.size !== need.size) return false;
    for (const tag of need) if (!tags.has(tag)) return false;
    return true;
  }) || null;
}

function paintModes() {
  document.querySelectorAll(".mode-btn").forEach(btn => {
    const mode = btn.dataset.mode;
    const on = mode === "lunar" ? state.lunar
      : mode === "shadow" ? state.shadow
      : state.players === mode;
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

function affinityLine() {
  if (state.lunar && state.shadow) return "已切换到月后影后";
  if (state.lunar) return "已切换到月后加点";
  if (state.shadow) return "已切换到影后加点";
  return "已关闭月后与影后加点";
}

function playerLine(kind) {
  if (state.players === kind) return kind === "solo" ? "已切换到单人模式" : "已切换到多人模式";
  return kind === "solo" ? "已关闭单人模式" : "已关闭多人模式";
}

let schemeTimer = 0;

function showDataPop(title, body, sticky) {
  const pop = $("scheme-pop");
  const close = $("scheme-close");
  if (!pop) return;
  clearTimeout(schemeTimer);
  $("scheme-title").textContent = title;
  const text = $("scheme-body");
  text.textContent = body || "";
  text.hidden = !body;
  if (close) close.hidden = !sticky;
  pop.hidden = false;
  if (!sticky) schemeTimer = setTimeout(() => { pop.hidden = true; }, 1600);
}

function hideModeTip() {
  const tip = $("mode-tip");
  if (tip) tip.hidden = true;
}

function showModeTip(btn, force) {
  if (!force && window.matchMedia("(max-width: 720px)").matches) return;
  const tip = $("mode-tip");
  if (!tip || !btn.dataset.tip) return;
  tip.hidden = false;
  tip.textContent = btn.dataset.tip;
  const pad = 12;
  const anchor = btn.getBoundingClientRect();
  tip.style.left = "0px";
  tip.style.top = "0px";
  const box = tip.getBoundingClientRect();
  let x = anchor.left + anchor.width / 2 - box.width / 2;
  let y = anchor.bottom + 8;
  if (x < pad) x = pad;
  if (x + box.width > window.innerWidth - pad) x = window.innerWidth - pad - box.width;
  if (y + box.height > window.innerHeight - pad) y = Math.max(pad, anchor.top - box.height - 8);
  tip.style.left = x + "px";
  tip.style.top = y + "px";
}

function onModeClick(kind) {
  if (!state.preset) return;
  hideModeTip();
  if (kind === "lunar") state.lunar = !state.lunar;
  else if (kind === "shadow") state.shadow = !state.shadow;
  else state.players = state.players === kind ? null : kind;
  paintModes();
  const scheme = showPresetAllocation();
  const title = kind === "solo" || kind === "multi" ? playerLine(kind) : affinityLine();
  const body = scheme ? [scheme.name, scheme.text].filter(Boolean).join("\n") : "";
  showDataPop(title, body, !!body);
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
    state.hoveredLockNode = el.dataset.id;
    state.lockTip = el.getAttribute("data-tip") || "在这里写锁的描述";
    state.hoveredId = null;
  } else {
    state.hoveredLock = null;
    state.hoveredLockNode = null;
    state.lockTip = null;
    state.hoveredId = el.dataset.id;
    state.stickyId = el.dataset.id;
  }
  render();
});

$("nodes").addEventListener("mouseout", e => {
  const el = e.target.closest(".node");
  if (!el) return;
  const to = e.relatedTarget;
  if (to && to.closest && to.closest(".node") === el) return;
  if (el.dataset.lock) {
    if (state.hoveredLockNode === el.dataset.id) {
      state.hoveredLock = null;
      state.hoveredLockNode = null;
      state.lockTip = null;
    }
  } else if (state.hoveredId === el.dataset.id) {
    state.hoveredId = null;
  }
  render();
});

window.addEventListener("resize", () => {
  const tip = $("note-tip");
  if (tip && !tip.hidden && tip._anchor) showNoteTip(tip._anchor);
});

$("btn-learn").addEventListener("click", learnSelected);
$("btn-reset").addEventListener("click", resetAll);
$("build-select").addEventListener("change", e => {
  if (e.target.value) applyBuild(e.target.value);
  else leavePreset();
});

$("mode-stack").addEventListener("click", e => {
  const btn = e.target.closest(".mode-btn");
  if (!btn) return;
  onModeClick(btn.dataset.mode);
});

$("mode-stack").addEventListener("mouseover", e => {
  const btn = e.target.closest(".mode-btn");
  if (!btn) return;
  showModeTip(btn);
});

$("mode-stack").addEventListener("mouseout", e => {
  const btn = e.target.closest(".mode-btn");
  if (!btn) return;
  const to = e.relatedTarget;
  if (to && btn.contains(to)) return;
  hideModeTip();
});

$("scheme-close").addEventListener("click", () => {
  clearTimeout(schemeTimer);
  $("scheme-pop").hidden = true;
});

boot();
