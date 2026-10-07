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
  align: null,
  preset: false,
  selected: new Set(),
  learned: new Set(),
  nodeEls: {},
  skillMap: {},
  lockMap: {},
  pipEls: { nice: [], naughty: [] }
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
  const fold = name => name.replace(/分支/g, "分枝");
  names.forEach(name => {
    state.tree.groups.forEach(g => {
      if (fold(g.name) === fold(name)) ids.push(g.id);
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
    } else if (nameNeedle && (!s.name || !s.name.includes(nameNeedle))) {
      continue;
    }
    if (owned.has(s.id)) n++;
  }
  return n;
}

function skillByName(name) {
  return state.tree.skills.find(s => s.name === name);
}

function handSet(owned) {
  return new Set([...(owned || []), ...state.selected, ...state.learned]);
}

function skillGrantsAffinity(skill, kind, seen = new Set()) {
  if (!skill || seen.has(skill.id)) return false;
  seen.add(skill.id);
  if (skill.desc && skill.desc.includes("获得" + kind + "亲和")) return true;
  return (skill.requires || []).some(id => skillGrantsAffinity(state.skillMap[id], kind, seen));
}

// 锁开不开只看这把锁自己的说明。打不过的 Boss、喊口号这类局内行为，加点器里算作已经满足。
function clauseMet(clause, lock, owned, skill) {
  if (skillGrantsAffinity(skill, "暗影") && /没有暗影亲和|没有暗影阵营技能/.test(clause)) return true;
  if (skillGrantsAffinity(skill, "月亮") && /没有月亮亲和|没有月亮阵营技能/.test(clause)) return true;
  if (/找到并击败|击败|施展|演奏|物品中拥有/.test(clause)) return true;
  if (/这里有锁文案需要替换|在这里写锁的描述|学习前置技能后解锁/.test(clause)) return true;

  if (/没有月亮亲和|没有月亮阵营技能/.test(clause)) return !affinityTaken("月亮");
  if (/没有暗影亲和|没有暗影阵营技能/.test(clause)) return !affinityTaken("暗影");

  const counted = clause.match(/(?:学习|解锁)(?:至少)?\s*(\d+)\s*[个项](.+?)技能/);
  if (counted && counted[2].trim()) {
    const need = Number(counted[1]);
    const scope = counted[2].trim();
    const groupIds = scopeGroupIds(scope, lock);
    const n = groupIds.length
      ? learnedMatches(lock, owned, groupIds)
      : learnedMatches(lock, owned, null, scope);
    return n >= need;
  }
  const anyCount = clause.match(/(?:学习|解锁)(?:至少)?\s*(\d+)\s*项技能/);
  if (anyCount) return learnedMatches(lock, owned, null) >= Number(anyCount[1]);

  const blocked = clause.match(/没有解锁「([^」]+)」/);
  if (blocked) {
    const target = skillByName(blocked[1]);
    return !(target && handSet(owned).has(target.id));
  }
  const named = clause.match(/(?:需要学会|学习)「([^」]+)」/);
  if (named) {
    const target = skillByName(named[1]);
    return !!(target && owned.has(target.id));
  }
  if (clause.startsWith("没有")) {
    const names = [...clause.matchAll(/[“「]([^”」]+)[”」]/g)].map(m => m[1]);
    if (names.length) {
      const hand = handSet(owned);
      return names.every(name => {
        const target = skillByName(name);
        return !(target && hand.has(target.id));
      });
    }
  }
  const craft = clause.match(/可以制作\s*(.+)/);
  if (craft) {
    const item = craft[1].trim();
    return state.tree.skills.some(s => owned.has(s.id) && (s.recipes || []).some(r => r.includes(item)));
  }
  return true;
}

function lockTextMet(text, lock, owned, skill) {
  const raw = (text || "").trim();
  if (!raw) return true;
  if (/这里有锁文案需要替换|在这里写锁的描述|^学习前置技能后解锁/.test(raw) && !/「/.test(raw)) return true;
  const clauses = raw.split(/，|、|并且|且/).map(s => s.trim()).filter(Boolean);
  return clauses.every(clause => clauseMet(clause, lock, owned, skill));
}

function textHasRule(text) {
  const raw = text || "";
  if (/(?:学习|解锁)(?:至少)?\s*\d+\s*[个项].+?技能/.test(raw)) return true;
  if (/(?:学习|解锁)(?:至少)?\s*\d+\s*项技能/.test(raw)) return true;
  if (/(?:需要学会|学习)「[^」]+」/.test(raw)) return true;
  if (/没有解锁「/.test(raw)) return true;
  if (/没有[“「]/.test(raw)) return true;
  if (/没有月亮亲和|没有暗影亲和|没有月亮阵营技能|没有暗影阵营技能/.test(raw)) return true;
  if (/可以制作/.test(raw)) return true;
  return false;
}

function tipAppliesToSkill(tip, skill) {
  if (!skill || !skill.group) return true;
  const group = (state.tree.groups || []).find(g => g.id === skill.group);
  const name = group ? group.name : "";
  if (/左分[支枝]/.test(name) && /右分[支枝]/.test(tip)) return false;
  if (/右分[支枝]/.test(name) && /左分[支枝]/.test(tip)) return false;
  return true;
}

function lockSatisfied(lock, owned, skill) {
  if (textHasRule(lock.desc)) return lockTextMet(lock.desc, lock, owned, skill);
  const tips = (lock.nodes || []).map(node => node.tip).filter(tip => tip && tipAppliesToSkill(tip, skill));
  if (!tips.length) return true;
  return tips.every(tip => lockTextMet(tip, lock, owned, skill));
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
  if (/没有月亮亲和|没有月亮阵营技能/.test(text) && affinityTaken("月亮")) return true;
  if (/没有暗影亲和|没有暗影阵营技能/.test(text) && affinityTaken("暗影")) return true;
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
    if (!lockSatisfied(lock, others, s)) return false;
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

function selectionSearch(charId) {
  const q = new URLSearchParams();
  if (charId) q.set("char", charId);
  if (state.preset) {
    const build = selectedBuild();
    if (build) q.set("build", build.id);
    q.set("lunar", state.lunar ? "1" : "0");
    q.set("shadow", state.shadow ? "1" : "0");
    q.set("players", state.players === "solo" ? "solo" : "multi");
    if (state.align === "nice" || state.align === "naughty") q.set("align", state.align);
  }
  const text = q.toString();
  return text ? "?" + text : "";
}

function writeSelectionQuery() {
  const char = new URLSearchParams(location.search).get("char");
  const search = selectionSearch(char);
  if (search !== location.search) history.replaceState(null, "", search || location.pathname);
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
      location.search = selectionSearch(c.id);
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

function normalizeTree(tree) {
  if (!Array.isArray(tree.skills)) {
    const skills = [];
    Object.entries(tree.data || {}).forEach(([groupId, block]) => {
      (block.skills || []).forEach(skill => {
        skills.push(Object.assign({}, skill, { group: skill.group || groupId }));
      });
    });
    tree.skills = skills;
  }
  const lockIds = new Set((tree.locks || []).map(l => l.id));
  tree.skills.forEach(s => {
    const req = s.requires || [];
    const fromReq = req.filter(id => lockIds.has(id));
    if (!fromReq.length) return;
    s.requires = req.filter(id => !lockIds.has(id));
    const have = new Set(skillLockIds(s));
    fromReq.forEach(id => have.add(id));
    const list = [...have];
    if (list.length > 1) s.locks = list;
    else s.lock = list[0];
  });
}

function initTree(tree) {
  normalizeTree(tree);
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
  bindNotice(tree);
  const saved = new URLSearchParams(location.search);
  let buildId = saved.get("build") || "";
  if (buildId === "init" && (tree.builds || []).some(b => b.id === "zhuo-yue")) buildId = "zhuo-yue";
  const hasBuild = (tree.builds || []).some(b => b.id === buildId);
  if (hasBuild) {
    state.lunar = saved.get("lunar") === "1";
    state.shadow = saved.get("shadow") === "1";
    state.players = saved.get("players") === "solo" ? "solo" : "multi";
    state.align = saved.get("align") === "naughty" ? "naughty" : saved.get("align") === "nice" ? "nice" : null;
    if (!saved.has("lunar") && !saved.has("shadow") && !saved.has("players")) {
      state.lunar = true;
      state.shadow = true;
      state.players = "multi";
    }
    applyBuild(buildId, { keepModes: true, quiet: true });
  } else {
    state.preset = false;
    state.lunar = false;
    state.shadow = false;
    state.players = null;
    state.align = null;
    syncPresetChrome();
    if (buildId) writeSelectionQuery();
    render();
  }
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
  state.pipEls = { nice: [], naughty: [] };

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

  buildScale();
}

function scaleCopy(note) {
  const lines = note || [];
  const niceAt = lines.findIndex(l => String(l).trim().startsWith("好孩子倾向"));
  const naughtyAt = lines.findIndex(l => String(l).trim().startsWith("淘气包倾向"));
  const cut = niceAt >= 0 ? niceAt : lines.length;
  const niceLines = niceAt >= 0 ? lines.slice(niceAt, naughtyAt >= 0 ? naughtyAt : lines.length) : [];
  const naughtyLines = naughtyAt >= 0 ? lines.slice(naughtyAt) : [];
  const titleOf = (block, fallback) => (block[0] || fallback).replace(/：$/, "").trim() || fallback;
  return {
    scale: lines.slice(0, cut).join("\n"),
    niceName: titleOf(niceLines, "好孩子倾向"),
    nice: niceLines.slice(1).join("\n"),
    naughtyName: titleOf(naughtyLines, "淘气包倾向"),
    naughty: naughtyLines.slice(1).join("\n")
  };
}

function registerPlain(id, name, desc) {
  state.skillMap[id] = { id, name, desc, plain: true, requires: [] };
}

function addStaticNode(parent, id, x, y, w, h, label, side) {
  const el = svgEl("rect", {
    class: "node",
    x, y, width: w, height: h, rx: 4,
    fill: "#2c241c", stroke: "#7a6240", "stroke-width": 1
  });
  el.dataset.id = id;
  el.dataset.static = "1";
  if (side) {
    el.dataset.side = side;
    el.dataset.lit = "0";
  }
  el.style.cursor = "pointer";
  parent.appendChild(el);
  state.nodeEls[id] = el;
  if (label) addLabel(x, y, w, h, label, "#6d5c48", id);
  return el;
}

function drawScaleIcon(parent, cx, cy) {
  const g = svgEl("g", { "pointer-events": "none" });
  const add = (name, attrs) => g.appendChild(svgEl(name, attrs));
  add("polygon", {
    points: `${cx},${cy + 10} ${cx - 6},${cy + 2} ${cx + 6},${cy + 2}`,
    fill: "#cbb892"
  });
  add("line", {
    x1: cx, y1: cy - 7, x2: cx, y2: cy + 2,
    stroke: "#e6d3a4", "stroke-width": "1.6"
  });
  add("line", {
    x1: cx - 12, y1: cy - 7, x2: cx + 12, y2: cy - 7,
    stroke: "#e6d3a4", "stroke-width": "1.8", "stroke-linecap": "round"
  });
  [-12, 12].forEach(dx => {
    add("line", {
      x1: cx + dx, y1: cy - 7, x2: cx + dx, y2: cy + 1,
      stroke: "#cbb892", "stroke-width": "1"
    });
    add("path", {
      d: `M ${cx + dx - 5} ${cy + 1} Q ${cx + dx} ${cy + 7} ${cx + dx + 5} ${cy + 1}`,
      fill: "none", stroke: "#e6d3a4", "stroke-width": "1.3"
    });
  });
  parent.appendChild(g);
}

function addPip(parent, side, slot, x, y, r) {
  const el = svgEl("circle", {
    class: "scale-pip",
    cx: x, cy: y, r,
    fill: "#1c1814", stroke: "#4a4034", "stroke-width": "1",
    "pointer-events": "none"
  });
  el.dataset.side = side;
  el.dataset.slot = String(slot);
  parent.appendChild(el);
  state.pipEls[side][slot] = el;
}

function buildScale() {
  const scale = state.tree.scale;
  if (!scale || !Array.isArray(scale.note)) return;
  const copy = scaleCopy(scale.note);
  const cx = scale.x != null ? scale.x : 0;
  const cy = scale.y != null ? scale.y : 123;
  registerPlain("scale-balance", "天秤", copy.scale);
  registerPlain("scale-nice", copy.niceName, copy.nice);
  registerPlain("scale-naughty", copy.naughtyName, copy.naughty);

  const nodes = $("nodes");
  const scaleW = 34;
  const pipR = 5;
  const pipGap = 6;
  addStaticNode(nodes, "scale-balance", cx - scaleW / 2, cy - scaleW / 2, scaleW, scaleW, "", "");
  drawScaleIcon(nodes, cx, cy);
  for (let i = 0; i < 3; i++) {
    const d = scaleW / 2 + 8 + pipR + i * (pipR * 2 + pipGap);
    addPip(nodes, "nice", i, cx - d, cy, pipR);
    addPip(nodes, "naughty", i, cx + d, cy, pipR);
  }
  const outer = scaleW / 2 + 8 + pipR + 2 * (pipR * 2 + pipGap) + pipR + 8;
  const btnW = 88;
  const btnH = 30;
  addStaticNode(nodes, "scale-nice", cx - outer - btnW, cy - btnH / 2, btnW, btnH, copy.niceName, "nice");
  addStaticNode(nodes, "scale-naughty", cx + outer, cy - btnH / 2, btnW, btnH, copy.naughtyName, "naughty");
}

const PIP_PAINT = {
  "": { fill: "#1c1814", stroke: "#4a4034" },
  blue: { fill: "#2c5a86", stroke: "#4a86b8" },
  red: { fill: "#7c323c", stroke: "#b05a62" },
  purple: { fill: "#4a3568", stroke: "#6d5294" }
};

function meterSlots(lead, affinity, color) {
  const slots = ["", "", ""];
  if (affinity) slots[0] = "purple";
  const start = affinity ? 1 : 0;
  const n = Math.min(3 - start, lead);
  for (let i = 0; i < n; i++) slots[start + i] = color;
  return slots;
}

function groupIdByName(name) {
  const g = (state.tree.groups || []).find(item => item.name === name);
  return g ? g.id : "";
}

function updateMeter() {
  if (!state.tree || !state.tree.scale || !state.pipEls) return;
  const owned = ownedSet();
  const niceId = groupIdByName("好孩子");
  const naughtyId = groupIdByName("淘气包");
  const affinityId = groupIdByName("亲和");
  let nice = 0;
  let naughty = 0;
  let affinity = false;
  for (const s of state.tree.skills) {
    if (!owned.has(s.id)) continue;
    if (s.group === niceId) nice++;
    else if (s.group === naughtyId) naughty++;
    else if (s.group === affinityId) affinity = true;
  }
  const diff = nice - naughty;
  paintSide("nice", meterSlots(diff > 0 ? diff : 0, affinity, "blue"), "scale-nice");
  paintSide("naughty", meterSlots(diff < 0 ? -diff : 0, affinity, "red"), "scale-naughty");
}

function paintSide(side, slots, btnId) {
  (state.pipEls[side] || []).forEach((el, i) => {
    if (!el) return;
    const kind = slots[i] || "";
    const paint = PIP_PAINT[kind] || PIP_PAINT[""];
    el.setAttribute("fill", paint.fill);
    el.setAttribute("stroke", paint.stroke);
    el.setAttribute("stroke-width", kind ? "1.5" : "1");
  });
  const btn = state.nodeEls[btnId];
  if (btn) btn.dataset.lit = slots.every(Boolean) ? "1" : "0";
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

function noticePayload(tree) {
  const n = tree && tree.notice;
  if (n == null || n === false) return null;
  if (typeof n === "string") return { title: "总结", text: n };
  if (Array.isArray(n)) return { title: "总结", text: n.join("\n") };
  const text = n.text || n.body || (Array.isArray(n.lines) ? n.lines.join("\n") : "");
  if (!String(text).trim()) return null;
  return { title: n.title || "总结", text };
}

function bindNotice(tree) {
  const wrap = $("char-notice");
  const panel = $("char-notice-panel");
  const btn = $("char-notice-btn");
  if (!wrap || !panel || !btn) return;
  const payload = noticePayload(tree);
  wrap.classList.remove("is-open");
  btn.setAttribute("aria-expanded", "false");
  panel.hidden = true;
  if (!payload) {
    wrap.hidden = true;
    $("char-notice-body").textContent = "";
    return;
  }
  wrap.hidden = false;
  $("char-notice-title").textContent = payload.title;
  $("char-notice-body").textContent = payload.text;
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
  const num = skill.n == null ? "" : `<span class="desc-num">${skill.n}</span>`;
  const prereq = skill.plain ? "" : `<div class="desc-prereq">前置：${prereqText(skill)}</div>`;
  return `
    <div class="desc-card ${extraClass}">
      <div class="desc-head">
        ${num}
        <span class="desc-name">${skill.name}</span>
      </div>
      <div class="desc-text">${(skill.desc || "").replace(/\n/g, "<br>")}</div>
      ${recipes ? `<ul class="desc-recipes">${recipes}</ul>` : ""}
      ${prereq}
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

  if (el.dataset.static) {
    const hot = state.hoveredId === id;
    const lit = el.dataset.lit === "1";
    const side = el.dataset.side || "";
    let fill = "#2c241c";
    let stroke = "#7a6240";
    let labelFill = "#e6d3a4";
    let sw = 1;
    if (side === "nice" || side === "naughty") {
      fill = "#241c16";
      stroke = "#4a3c30";
      labelFill = "#6d5c48";
      if (lit && side === "nice") {
        fill = "#1a4060";
        stroke = "#5a94c4";
        labelFill = "#e4f0fa";
        sw = 2;
      } else if (lit && side === "naughty") {
        fill = "#642830";
        stroke = "#c46870";
        labelFill = "#fde8e8";
        sw = 2;
      }
    }
    if (hot) {
      stroke = "#ffffff";
      sw = 3;
    }
    el.setAttribute("fill", fill);
    el.setAttribute("stroke", stroke);
    el.setAttribute("stroke-width", String(sw));
    document.querySelectorAll(`[data-label-for="${id}"]`).forEach(label => {
      label.setAttribute("fill", labelFill);
    });
    return;
  }

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
  updateMeter();
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
  const budget = state.points;
  const wanted = (ids || []).filter(id => state.skillMap[id]);
  const pending = wanted.slice();
  const maxSteps = pending.length;
  for (let step = 0; step < maxSteps; step++) {
    if (state.learned.size >= budget) break;
    const idx = pending.findIndex(id => {
      const next = new Set(state.learned);
      next.add(id);
      return canSelect(id, next);
    });
    if (idx < 0) break;
    state.learned.add(pending[idx]);
    pending.splice(idx, 1);
  }
  state.points = budget - state.learned.size;
  state.focusedId = wanted[wanted.length - 1] || null;
  state.stickyId = state.focusedId;
  render();
}

function selectedBuild() {
  const id = $("build-select").value;
  return (state.tree.builds || []).find(b => b.id === id) || null;
}

function showPresetAllocation() {
  const scheme = currentModeScheme();
  if (scheme) {
    applySkillList(scheme.skills);
    return scheme;
  }
  applySkillList([]);
  return null;
}

function schemeGap(scheme) {
  if (!scheme) return { title: "没有方案", body: "这个组合还没有写入加点" };
  if ((scheme.skills || []).length) return null;
  const text = (scheme.text || "").trim();
  const matched = text.match(/^(没有方案|不合适)\s*[：:]\s*([\s\S]*)$/);
  if (!matched) return null;
  return { title: matched[1], body: matched[2].trim() || matched[1] };
}

function announceScheme(scheme, sticky) {
  const gap = schemeGap(scheme);
  if (gap) {
    showDataPop(gap.title, withAlignHint(gap.body), sticky);
    return;
  }
  if (!scheme) {
    showDataPop("没有方案", withAlignHint("这个组合还没有写入加点"), sticky);
    return;
  }
  const body = [scheme.name, scheme.text].filter(Boolean).join("\n");
  showDataPop(modeLine(), withAlignHint(body), sticky);
}

function syncPresetChrome() {
  const build = selectedBuild();
  const open = !!(state.preset && build && (build.modes || []).length);
  $("mode-stack").classList.toggle("is-open", open);
  $("stage-head").classList.toggle("preset", open);
  paintModes();
}

function leavePreset() {
  if (!state.preset) return;
  state.preset = false;
  state.lunar = false;
  state.shadow = false;
  state.players = null;
  state.align = null;
  $("build-select").value = "";
  hideModeTip();
  syncPresetChrome();
  writeSelectionQuery();
}

function applyBuild(buildId, opts = {}) {
  const build = (state.tree.builds || []).find(b => b.id === buildId);
  if (!build) return;
  state.preset = true;
  $("build-select").value = build.id;
  if (!opts.keepModes) {
    state.lunar = true;
    state.shadow = true;
    state.players = "multi";
    if (usesAlignment()) state.align = "nice";
  } else if (state.players !== "solo" && state.players !== "multi") {
    state.players = "multi";
  }
  syncPresetChrome();
  const scheme = showPresetAllocation();
  writeSelectionQuery();
  if (opts.quiet) return;
  announceScheme(scheme, true);
}

function usesAlignment(build) {
  const target = build || selectedBuild();
  return !!(target && (target.modes || []).some(mode => (mode.tags || []).some(tag => tag === "好孩子" || tag === "淘气包" || tag === "无偏好")));
}

function alignTag() {
  if (state.align === "naughty") return "淘气包";
  if (state.align === "nice") return "好孩子";
  return "无偏好";
}

const ALIGN_HINTS = {
  "好孩子": "吃灵魂掉10精神值回25饱食度，释放灵魂回20血回5精神值",
  "淘气包": "吃掉灵魂不掉精神值回25饱食度，释放灵魂回15血不回精神值",
  "无偏好": "吃掉灵魂掉5精神值回25饱食度，释放灵魂回20血回2.5精神值"
};

function withAlignHint(body) {
  if (!usesAlignment()) return body || "";
  const hint = ALIGN_HINTS[alignTag()];
  if (!hint) return body || "";
  return [body, hint].filter(Boolean).join("\n");
}

function currentModeScheme() {
  const build = selectedBuild();
  if (!build || (state.players !== "solo" && state.players !== "multi")) return null;
  const need = new Set([
    state.players === "solo" ? "单人" : "多人",
    state.lunar ? "月后" : "月前",
    state.shadow ? "影后" : "影前"
  ]);
  if (usesAlignment(build)) need.add(alignTag());
  return (build.modes || []).find(mode => {
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
  const showAlign = !!(state.preset && usesAlignment());
  document.querySelectorAll(".align-btn").forEach(btn => {
    btn.hidden = !showAlign;
    const on = showAlign && state.align === btn.dataset.align;
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

function modeLine() {
  const who = state.players === "solo" ? "单人" : "多人";
  let affinity = "月前影前";
  if (state.lunar && state.shadow) affinity = "月后影后";
  else if (state.lunar) affinity = "月后";
  else if (state.shadow) affinity = "影后";
  const side = usesAlignment() ? " · " + alignTag() : "";
  return "已切换到" + who + affinity + side;
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
  pop.classList.toggle("is-toast", !sticky);
  pop.hidden = false;
  if (!sticky) schemeTimer = setTimeout(() => { pop.hidden = true; }, 2400);
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
  else state.players = kind;
  paintModes();
  const scheme = showPresetAllocation();
  writeSelectionQuery();
  announceScheme(scheme, false);
}

function onAlignClick(kind) {
  if (!state.preset || !usesAlignment()) return;
  hideModeTip();
  state.align = state.align === kind ? null : kind;
  paintModes();
  const scheme = showPresetAllocation();
  writeSelectionQuery();
  announceScheme(scheme, false);
}

$("nodes").addEventListener("click", e => {
  const el = e.target.closest(".node");
  if (!el || el.dataset.lock || el.dataset.static) return;
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

window.addEventListener("keydown", e => {
  if (e.code !== "Space" && e.key !== " ") return;
  if (e.repeat || e.altKey || e.ctrlKey || e.metaKey) return;
  const typing = e.target && e.target.closest && e.target.closest("input, textarea, select, [contenteditable='true']");
  if (typing) return;
  if (!state.tree || state.selected.size === 0) return;
  e.preventDefault();
  learnSelected();
});
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

document.querySelectorAll(".align-btn").forEach(btn => {
  btn.addEventListener("click", () => onAlignClick(btn.dataset.align));
  btn.addEventListener("mouseenter", () => showModeTip(btn));
  btn.addEventListener("mouseleave", hideModeTip);
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

$("char-notice-btn").addEventListener("click", e => {
  e.stopPropagation();
  const wrap = $("char-notice");
  const panel = $("char-notice-panel");
  const btn = $("char-notice-btn");
  const open = panel.hidden;
  panel.hidden = !open;
  wrap.classList.toggle("is-open", open);
  btn.setAttribute("aria-expanded", open ? "true" : "false");
});

document.addEventListener("click", e => {
  const wrap = $("char-notice");
  if (!wrap || wrap.hidden || wrap.contains(e.target)) return;
  $("char-notice-panel").hidden = true;
  wrap.classList.remove("is-open");
  $("char-notice-btn").setAttribute("aria-expanded", "false");
});

boot();
