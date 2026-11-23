const SEASONS = [
  { key: "spring", name: "春" },
  { key: "summer", name: "夏" },
  { key: "autumn", name: "秋" },
  { key: "winter", name: "冬" }
];
const NARROW = window.matchMedia("(max-width: 720px)");
const PLAN_ROWS_LIMIT = 300;

const farm = {
  entries: [],
  crops: [],
  cropById: new Map(),
  entryById: new Map(),
  picks: [],
  search: "",
  gridSearch: "",
  filter: { fit: new Set(), exclude: new Set(), consume: new Set(), produce: new Set() },
  result: null,
  panelOpen: false,
  calcTimer: 0,
  ratioMode: "9",
  /** 配比卡片是否标注共同适合季节 */
  considerSeason: false,
  /** 勾选的肥视为「不缺」，配比时该项可负到 DEFICIT_FLOOR */
  allowDeficit: { formula: false, compost: false, manure: false }
};

const RATIO_MODES = [
  { id: "1-1", label: "1:1配比", note: "与所选作物各种 1 株，三种肥料都不为负。点另一株会换掉当前选择。" },
  { id: "3-3-3", label: "3+3+3配比", note: "每株计数只能是 3 或 6，合计 9 格。可做 3+3+3，或 3+6；已选之外的格按同样规则补齐。" },
  { id: "9", label: "9格配比", note: "" }
];

const esc = text => Foodfarm.escapeHTML(text == null ? "" : String(text));

function signed(n) {
  const v = Number(n) || 0;
  if (v > 0) return "+" + v;
  return String(v);
}

function fertStatesHTML(values) {
  if (!window.CommonTags) return "";
  return CommonTags.statesHTML(FarmCalc.NUTRIENTS.map(key => ({
    kind: key,
    valueHTML: "<b>" + esc(signed(values && values[key])) + "</b>"
  })));
}

/** 种植卡片/种子详情：三肥净值 + 耗水/阶段（第四维，不进配比） */
function plantStatesHTML(crop) {
  if (!window.CommonTags || !crop) return "";
  const items = FarmCalc.NUTRIENTS.map(key => ({
    kind: key,
    label: FarmCalc.nutrientName(key) + "/阶段",
    valueHTML: "<b>" + esc(signed(crop.delta && crop.delta[key])) + "</b>"
  }));
  if (crop.water != null) {
    items.push({
      kind: "water",
      label: "耗水/阶段",
      valueHTML: `<b>${esc(crop.water)}%</b>`
    });
  }
  return CommonTags.statesHTML(items);
}

function fertTag(key) {
  return `<${key}>${esc(FarmCalc.nutrientName(key))}</${key}>`;
}

function hateSeasons(entry) {
  const raw = entry && entry.seed && entry.seed.hate_season;
  return new Set((Array.isArray(raw) ? raw : []).map(String));
}

function seasonText(keys) {
  return SEASONS.filter(s => keys.has(s.key)).map(s => s.name).join("、");
}

/**
 * n 株共同适合季节 = 四季减去各株 hate_season 的并集。
 * 没有共同季节时返回空数组。
 */
function commonFitSeasonKeys(crops) {
  const hate = new Set();
  (crops || []).forEach(crop => {
    if (!crop) return;
    const entry = farm.entryById.get(crop.id) || farm.entryById.get(String(crop.id || ""));
    hateSeasons(entry).forEach(key => hate.add(key));
  });
  return SEASONS.filter(s => !hate.has(s.key)).map(s => s.key);
}

function commonFitSeasonHTML(crops) {
  if (!farm.considerSeason) return "";
  const keys = commonFitSeasonKeys(crops);
  if (!keys.length) return "";
  return `<div class="plan-seasons">共同适合：${esc(seasonText(new Set(keys)))}</div>`;
}

/** 勾选「考虑季节」时：无共同适合季节的方案不展示 */
function planHasCommonSeason(plan, result) {
  return commonFitSeasonKeys(cropsFromPlanParts(plan, result)).length > 0;
}

function pairHasCommonSeason(mate) {
  return commonFitSeasonKeys(cropsFromPair(mate)).length > 0;
}

function visiblePlanEntries(plans, result) {
  const list = Array.isArray(plans) ? plans : [];
  if (!farm.considerSeason) return list.map((plan, index) => ({ plan, index }));
  return list
    .map((plan, index) => ({ plan, index }))
    .filter(entry => planHasCommonSeason(entry.plan, result));
}

function cropsFromPair(mate) {
  const focus = farm.result && farm.result.focus;
  return [focus, mate && mate.crop].filter(Boolean);
}

function cropsFromPlanParts(plan, result) {
  const list = [];
  const seen = new Set();
  const push = crop => {
    if (!crop || !crop.id || seen.has(crop.id)) return;
    seen.add(crop.id);
    list.push(crop);
  };
  ((result && result.locked) || []).forEach(item => push(item && item.crop));
  ((plan && plan.parts) || []).forEach(part => {
    ((part.group && part.group.members) || []).forEach(push);
  });
  return list;
}

function rebuildCrops() {
  farm.entries = Foodfarm.plantEntries();
  farm.crops = [];
  farm.cropById.clear();
  farm.entryById.clear();
  farm.entries.forEach(entry => {
    const crop = FarmCalc.cropFromEntry(entry);
    if (!crop || !crop.id) return;
    farm.crops.push(crop);
    farm.cropById.set(crop.id, crop);
    farm.entryById.set(crop.id, entry);
  });
  farm.picks = farm.picks.filter(p => farm.cropById.has(p.id));
}

/* ---------- 卡片与筛选 ---------- */

function passesFilter(crop) {
  const entry = farm.entryById.get(crop.id);
  const hate = hateSeasons(entry);
  const f = farm.filter;
  for (const s of f.fit) if (hate.has(s)) return false;
  for (const s of f.exclude) if (!hate.has(s)) return false;
  for (const k of f.consume) if (!(crop.consume[k] > 0)) return false;
  for (const k of f.produce) if (!(crop.produce[k] > 0)) return false;
  const q = String(farm.gridSearch || "").trim().toLowerCase();
  if (q) {
    const seed = entry && entry.seed;
    const blob = `${crop.name || ""} ${crop.id || ""} ${(seed && seed.name) || ""} ${(seed && seed.id) || ""}`.toLowerCase();
    if (!blob.includes(q)) return false;
  }
  return true;
}

function seedCardHTML(crop) {
  return (
    `<button type="button" class="food-card" data-crop-id="${esc(crop.id)}">` +
    `<div class="food-card-name">${esc(crop.name)}</div>` +
    `<div class="food-card-stats tag-text">${plantStatesHTML(crop)}</div>` +
    `</button>`
  );
}

function renderGrid() {
  const host = Foodfarm.$("plant-body");
  if (!host) return;
  if (!farm.crops.length) {
    host.innerHTML = `<p class="empty-center">暂无可种植条目。</p>`;
    return;
  }
  const list = farm.crops.filter(passesFilter);
  if (!list.length) {
    const full = farm.filter.consume.size === 3 || farm.filter.produce.size === 3;
    host.innerHTML = `<p class="empty-center">${full ? "根本没有这样用肥的种子植株" : "条件太多了，无对应种子植株"}</p>`;
    return;
  }
  const groups = Foodfarm.groupItemsByOrigin(list, crop => {
    const entry = farm.entryById.get(crop.id);
    return (entry && entry.food) || crop;
  });
  host.innerHTML = Foodfarm.originSectionsHTML(groups, seedCardHTML);
  Foodfarm.bindOriginSections(host);
  Foodfarm.bindContentTags(host);
}

function bindGrid() {
  const host = Foodfarm.$("plant-body");
  if (!host) return;
  host.addEventListener("click", e => {
    const card = e.target.closest(".food-card[data-crop-id]");
    if (card) openSeedModal(card.dataset.cropId);
  });
}

function renderFilterChecks() {
  const seasonBox = (name, key, label) =>
    `<label class="mod-check"><input type="checkbox" data-group="${name}" data-key="${key}"><span>${label}</span></label>`;
  document.querySelectorAll(".filter-checks[data-filter]").forEach(box => {
    const name = box.dataset.filter;
    if (name === "fit" || name === "exclude") {
      box.innerHTML = SEASONS.map(s => seasonBox(name, s.key, s.name)).join("");
    } else {
      box.innerHTML = FarmCalc.NUTRIENTS.map(k => seasonBox(name, k, fertTag(k))).join("");
    }
  });
  document.querySelectorAll(".filter-checks input[data-group]").forEach(input => {
    input.addEventListener("change", () => {
      const set = farm.filter[input.dataset.group];
      if (input.checked) set.add(input.dataset.key);
      else set.delete(input.dataset.key);
      renderGrid();
    });
  });
  const plantSearch = Foodfarm.$("plant-search");
  if (plantSearch) {
    plantSearch.addEventListener("input", () => {
      farm.gridSearch = plantSearch.value || "";
      renderGrid();
    });
  }
  const reset = Foodfarm.$("filter-reset");
  if (reset) {
    reset.addEventListener("click", () => {
      Object.values(farm.filter).forEach(set => set.clear());
      farm.gridSearch = "";
      if (plantSearch) plantSearch.value = "";
      document.querySelectorAll(".filter-checks input[data-group]").forEach(input => { input.checked = false; });
      renderGrid();
    });
  }
}

/* ---------- 种子详情 ---------- */

function openSeedModal(id) {
  const crop = farm.cropById.get(id);
  const entry = farm.entryById.get(id);
  if (!crop || !entry) return;
  const seed = entry.seed || {};
  Foodfarm.$("seed-modal-title").textContent = crop.name;
  const fertHost = Foodfarm.$("seed-modal-fert");
  fertHost.innerHTML = plantStatesHTML(crop);
  Foodfarm.bindContentTags(fertHost);
  Foodfarm.$("seed-modal-stats").innerHTML = Foodfarm.foodStatesHTML(seed);

  const hate = hateSeasons(entry);
  const usage = FarmCalc.NUTRIENTS.map(k => {
    const parts = [];
    if (crop.consume[k]) parts.push("每阶段消耗 <b>" + esc(crop.consume[k]) + "</b>");
    if (crop.produce[k]) parts.push("每阶段产出 <b>" + esc(crop.produce[k]) + "</b>");
    return parts.length ? fertTag(k) + " " + parts.join("，") : "";
  }).filter(Boolean).join("；");
  const lines = [
    seed.name ? `<p>种子：${esc(seed.name)}</p>` : "",
    `<p>来源：${esc(Foodfarm.originLabel(entry.food))}</p>`,
    Foodfarm.foodTypeText(seed) ? `<p>类型：${Foodfarm.foodTypeHTML(seed)}</p>` : "",
    Foodfarm.spoilLabel(seed.spoilDays)
      ? `<p>保质期：<b>${esc(Foodfarm.spoilLabel(seed.spoilDays))}</b></p>`
      : "",
    usage ? `<p>${usage}</p>` : "",
    crop.water != null ? `<p>耗水/阶段：<b>${esc(crop.water)}%</b></p>` : "",
    `<p>不喜季节：${hate.size ? esc(seasonText(hate)) : "无"}</p>`,
    seed.desc ? `<p>${seed.desc}</p>` : ""
  ];
  const desc = Foodfarm.$("seed-modal-desc");
  desc.innerHTML = lines.join("");
  Foodfarm.bindContentTags(desc);
  openModal("seed-modal");
}

/* ---------- 弹窗通用 ---------- */

function openModal(id) {
  const modal = Foodfarm.$(id);
  if (!modal) return;
  modal.hidden = false;
  document.body.classList.add("food-modal-open");
}

function closeModal(id) {
  const modal = Foodfarm.$(id);
  if (!modal) return;
  modal.hidden = true;
  if (!document.querySelector(".food-modal:not([hidden])")) {
    document.body.classList.remove("food-modal-open");
  }
}

function bindModals() {
  document.addEventListener("click", e => {
    const btn = e.target.closest("[data-close]");
    if (btn) closeModal(btn.dataset.close);
  });
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    const open = [...document.querySelectorAll(".food-modal:not([hidden])")].pop();
    if (open) {
      closeModal(open.id);
      return;
    }
    const config = Foodfarm.$("calc-config");
    if (config && !config.hidden) {
      setConfigOpen(false);
      return;
    }
    const modeList = Foodfarm.$("calc-mode-list");
    if (modeList && !modeList.hidden) {
      setRatioMenu(false);
      return;
    }
    if (farm.panelOpen) closePanel();
  });
}

/* ---------- 抽屉 ---------- */

function setDrawer(id, open) {
  const drawer = Foodfarm.$(id);
  if (!drawer) return;
  drawer.classList.toggle("is-open", !!open);
  const handle = drawer.querySelector(".side-drawer-handle");
  if (handle) handle.setAttribute("aria-expanded", open ? "true" : "false");
  if (id === "calc-drawer") syncPanel();
}

function drawerOpen(id) {
  const drawer = Foodfarm.$(id);
  return !!(drawer && drawer.classList.contains("is-open"));
}

function bindDrawers() {
  ["calc-drawer", "filter-drawer"].forEach(id => {
    const drawer = Foodfarm.$(id);
    const handle = drawer && drawer.querySelector(".side-drawer-handle");
    if (handle) handle.addEventListener("click", () => setDrawer(id, !drawerOpen(id)));
  });
}

/* ---------- 计算器：选择 ---------- */

function pickIndex(id) {
  return farm.picks.findIndex(p => p.id === id);
}

function usedSlots() {
  return farm.picks.reduce((sum, p) => sum + p.count, 0);
}

function addPick(id) {
  if (!farm.cropById.has(id)) return;
  if (farm.ratioMode === "1-1") {
    farm.picks = [{ id, count: 1 }];
    afterPicksChange();
    if (NARROW.matches) openPanel();
    return;
  }
  if (pickIndex(id) >= 0) return;
  const cap = farm.ratioMode === "3-3-3" ? 3 : FarmCalc.MAX_CROPS;
  if (farm.picks.length >= cap) {
    flashPickerNote(farm.ratioMode === "3-3-3"
      ? "最多 3 种作物（3+3+3 或 3+6）"
      : "最多选择 " + FarmCalc.MAX_CROPS + " 种作物");
    return;
  }
  if (farm.ratioMode === "3-3-3" && usedSlots() + 3 > FarmCalc.DEFAULT_SLOTS) {
    flashPickerNote("剩余格不足 3，无法再选");
    return;
  }
  farm.picks.unshift({ id, count: farm.ratioMode === "3-3-3" ? 3 : 1 });
  afterPicksChange();
  if (NARROW.matches) openPanel();
}

function setPickCount(id, count) {
  const i = pickIndex(id);
  if (i < 0) return;
  if (farm.ratioMode === "1-1") return;
  if (farm.ratioMode === "3-3-3") {
    const cur = farm.picks[i].count >= 6 ? 6 : 3;
    let next = Math.floor(Number(count) || cur);
    if (next > cur) next = 6;
    else if (next < cur) next = 3;
    else next = next >= 6 ? 6 : 3;
    const others = usedSlots() - farm.picks[i].count;
    if (others + next > FarmCalc.DEFAULT_SLOTS) {
      flashPickerNote("总数不能超过 9 格（每株 3 或 6）");
      return;
    }
    farm.picks[i].count = next;
    afterPicksChange();
    return;
  }
  const n = Math.max(1, Math.min(FarmCalc.DEFAULT_SLOTS, Math.floor(Number(count) || 1)));
  farm.picks[i].count = n;
  afterPicksChange();
}

function removePick(id) {
  const i = pickIndex(id);
  if (i < 0) return;
  farm.picks.splice(i, 1);
  afterPicksChange();
}

function afterPicksChange() {
  renderPicker();
  scheduleCalc();
  syncPanel();
}

let noteTimer = 0;
function flashPickerNote(text) {
  const host = Foodfarm.$("calc-selected");
  if (!host) return;
  let note = host.querySelector(".calc-note");
  if (!note) {
    note = document.createElement("p");
    note.className = "calc-note";
    host.prepend(note);
  }
  note.textContent = text;
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => note.remove(), 2200);
}

function renderPicker() {
  const selected = Foodfarm.$("calc-selected");
  const seeds = Foodfarm.$("calc-seeds");
  if (!selected || !seeds) return;

  const used = usedSlots();
  const tripleMode = farm.ratioMode === "3-3-3";
  const fixedOne = farm.ratioMode === "1-1";
  if (farm.picks.length) {
    const usedText = tripleMode
      ? `已选 <b>${farm.picks.length}</b> 种，共 <b>${used}</b> / 9 格（每株 3 或 6）`
      : (fixedOne
        ? `已选 <b>1</b> 种，数量固定为 1`
        : `已选 <b>${used}</b> / ${FarmCalc.DEFAULT_SLOTS} 格`);
    selected.innerHTML =
      `<div class="calc-used">${usedText}</div>` +
      farm.picks.map(p => {
        const crop = farm.cropById.get(p.id);
        const count = tripleMode ? (p.count >= 6 ? 6 : 3) : (fixedOne ? 1 : p.count);
        const lock = fixedOne ? " disabled" : "";
        const minAttr = tripleMode ? "3" : "1";
        const maxAttr = tripleMode ? "6" : String(FarmCalc.DEFAULT_SLOTS);
        const stepAttr = tripleMode ? ' step="3"' : "";
        return (
          `<div class="calc-pick" data-id="${esc(p.id)}">` +
          `<span class="calc-pick-name">${esc(crop.name)}</span>` +
          `<button type="button" class="calc-step" data-step="-1" aria-label="减少"${lock}>−</button>` +
          `<input type="number" class="calc-count" min="${minAttr}" max="${maxAttr}"${stepAttr} value="${count}"${lock}>` +
          `<button type="button" class="calc-step" data-step="1" aria-label="增加"${lock}>+</button>` +
          `<button type="button" class="calc-remove" data-remove aria-label="移除">×</button>` +
          `</div>`
        );
      }).join("");
  } else {
    selected.innerHTML = `<p class="muted">点击下方种子开始计算</p>`;
  }

  const q = farm.search.trim().toLowerCase();
  const list = farm.crops.filter(crop => {
    if (!q) return true;
    const entry = farm.entryById.get(crop.id);
    const seedName = entry && entry.seed && entry.seed.name ? entry.seed.name : "";
    return (crop.name + " " + seedName + " " + crop.id).toLowerCase().includes(q);
  });
  seeds.innerHTML = list.length
    ? list.map(crop => {
      const on = pickIndex(crop.id) >= 0 ? " is-on" : "";
      return `<button type="button" class="calc-seed${on}" data-id="${esc(crop.id)}">${esc(crop.name)}</button>`;
    }).join("")
    : `<p class="muted">没有匹配的种子</p>`;
}

function bindPicker() {
  const search = Foodfarm.$("calc-search");
  if (search) {
    search.addEventListener("input", () => {
      farm.search = search.value || "";
      renderPicker();
    });
  }
  const picker = Foodfarm.$("calc-picker");
  if (!picker) return;
  picker.addEventListener("click", e => {
    const seed = e.target.closest(".calc-seed[data-id]");
    if (seed) {
      addPick(seed.dataset.id);
      return;
    }
    const row = e.target.closest(".calc-pick[data-id]");
    if (!row) return;
    const id = row.dataset.id;
    if (e.target.closest(".calc-remove")) {
      removePick(id);
      return;
    }
    const step = e.target.closest(".calc-step");
    if (step) {
      const p = farm.picks[pickIndex(id)];
      if (p) setPickCount(id, p.count + Number(step.dataset.step));
    }
  });
  picker.addEventListener("change", e => {
    const input = e.target.closest(".calc-count");
    const row = input && input.closest(".calc-pick[data-id]");
    if (row) setPickCount(row.dataset.id, input.value);
  });
}

/* ---------- 计算器：面板 ---------- */

function openPanel() {
  farm.panelOpen = true;
  if (NARROW.matches) setDrawer("calc-drawer", false);
  syncPanel();
}

function closePanel() {
  farm.panelOpen = false;
  setConfigOpen(false);
  setRatioMenu(false);
  if (!NARROW.matches) setDrawer("calc-drawer", false);
  syncPanel();
}

function setRatioMenu(open) {
  const menu = Foodfarm.$("calc-mode");
  const list = Foodfarm.$("calc-mode-list");
  const btn = Foodfarm.$("calc-mode-btn");
  if (!menu || !list || !btn) return;
  menu.classList.toggle("is-open", !!open);
  list.hidden = !open;
  btn.setAttribute("aria-expanded", open ? "true" : "false");
}

function ratioModeById(id) {
  return RATIO_MODES.find(item => item.id === id) || RATIO_MODES[2];
}

function applyRatioMode(id) {
  const mode = ratioModeById(id);
  farm.ratioMode = mode.id;
  const label = Foodfarm.$("calc-mode-label");
  if (label) label.textContent = mode.label;
  document.querySelectorAll(".calc-mode-opt").forEach(opt => {
    const on = opt.dataset.mode === mode.id;
    opt.classList.toggle("is-on", on);
    opt.setAttribute("aria-selected", on ? "true" : "false");
    const tip = opt.querySelector(".calc-mode-tip");
    const item = ratioModeById(opt.dataset.mode);
    if (tip && item) tip.textContent = item.note || "这里需要添加";
  });
  if (mode.id === "1-1") {
    if (farm.picks.length > 1) farm.picks = farm.picks.slice(0, 1);
    farm.picks.forEach(pick => { pick.count = 1; });
  }
  if (mode.id === "3-3-3") {
    if (farm.picks.length > 3) {
      farm.picks = farm.picks.slice(0, 3);
      flashPickerNote("最多 3 种作物（3+3+3 或 3+6）");
    }
    farm.picks.forEach(pick => { pick.count = pick.count >= 6 ? 6 : 3; });
    while (usedSlots() > FarmCalc.DEFAULT_SLOTS && farm.picks.length) {
      const last = farm.picks[farm.picks.length - 1];
      if (last.count >= 6) last.count = 3;
      else farm.picks.pop();
    }
  }
  renderPicker();
  scheduleCalc();
}

function bindRatioMode() {
  applyRatioMode(farm.ratioMode);
  document.addEventListener("click", e => {
    const opt = e.target.closest(".calc-mode-opt");
    if (opt) {
      e.preventDefault();
      applyRatioMode(opt.dataset.mode);
      setRatioMenu(false);
      return;
    }
    if (e.target.closest("#calc-mode-btn")) {
      e.preventDefault();
      const list = Foodfarm.$("calc-mode-list");
      setRatioMenu(!!(list && list.hidden));
      return;
    }
    if (!e.target.closest("#calc-mode")) setRatioMenu(false);
  });
}

function bindSeasonCheck() {
  const input = Foodfarm.$("calc-season-check");
  if (!input || input.dataset.bound === "1") return;
  input.dataset.bound = "1";
  input.checked = !!farm.considerSeason;
  input.addEventListener("change", () => {
    farm.considerSeason = !!input.checked;
    renderResult();
  });
}

function allowDeficitOptions() {
  return {
    formula: !!farm.allowDeficit.formula,
    compost: !!farm.allowDeficit.compost,
    manure: !!farm.allowDeficit.manure
  };
}

function bindDeficitChecks() {
  const host = Foodfarm.$("calc-deficit-checks");
  if (!host || host.dataset.bound === "1") return;
  host.dataset.bound = "1";
  host.querySelectorAll("input[data-nutrient]").forEach(input => {
    const key = input.getAttribute("data-nutrient");
    if (!key || !Object.prototype.hasOwnProperty.call(farm.allowDeficit, key)) return;
    input.checked = !!farm.allowDeficit[key];
    input.addEventListener("change", () => {
      farm.allowDeficit[key] = !!input.checked;
      scheduleCalc();
    });
  });
}

function panelVisible() {
  if (!farm.picks.length) return false;
  return NARROW.matches ? farm.panelOpen : drawerOpen("calc-drawer");
}

function syncPanel() {
  const panel = Foodfarm.$("calc-panel");
  if (!panel) return;
  const show = panelVisible();
  panel.hidden = !show;
  document.body.classList.toggle("calc-panel-open", show);
  placePicker();
  if (show) renderResult();
}

function setConfigOpen(open) {
  const config = Foodfarm.$("calc-config");
  const btn = Foodfarm.$("calc-config-btn");
  if (!config) return;
  config.hidden = !open;
  if (btn) {
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    btn.textContent = open ? "返回配比" : "选择种子";
  }
}

/** 窄屏且面板打开时，种子选择移进面板的配置框；其余情况留在左抽屉 */
function placePicker() {
  const picker = Foodfarm.$("calc-picker");
  const home = Foodfarm.$("calc-picker-home");
  const config = Foodfarm.$("calc-config-body");
  if (!picker || !home || !config) return;
  const target = NARROW.matches && panelVisible() ? config : home;
  if (picker.parentElement !== target) target.appendChild(picker);
}

function bindPanel() {
  bindRatioMode();
  const close = Foodfarm.$("calc-panel-close");
  if (close) close.addEventListener("click", closePanel);
  const btn = Foodfarm.$("calc-config-btn");
  if (btn) {
    btn.addEventListener("click", () => {
      const config = Foodfarm.$("calc-config");
      setConfigOpen(config && config.hidden);
    });
  }
  const body = Foodfarm.$("calc-body");
  if (body) {
    body.addEventListener("click", e => {
      const card = e.target.closest(".plan-card[data-index]");
      if (card) openPlanModal(Number(card.dataset.index));
    });
  }
  NARROW.addEventListener("change", () => {
    if (!NARROW.matches) setConfigOpen(false);
    syncPanel();
  });
}

function scheduleCalc() {
  cancelAnimationFrame(farm.calcTimer);
  farm.calcTimer = requestAnimationFrame(() => {
    farm.result = computeResult();
    if (panelVisible()) renderResult();
  });
}

function computeResult() {
  if (!farm.picks.length) return null;
  const focus = farm.cropById.get(farm.picks[0].id);
  const opts = { limit: PLAN_ROWS_LIMIT, allowDeficit: allowDeficitOptions() };
  if (farm.ratioMode === "1-1") return FarmCalc.solvePair(focus, farm.crops, opts);
  if (farm.ratioMode === "3-3-3") {
    return FarmCalc.solveTriple(
      farm.picks.map(p => ({
        crop: farm.cropById.get(p.id),
        count: p.count >= 6 ? 6 : 3
      })),
      farm.crops,
      opts
    );
  }
  return FarmCalc.solveFill(
    farm.picks.map(p => ({ crop: farm.cropById.get(p.id), count: p.count })),
    farm.crops,
    opts
  );
}

function groupLabel(group) {
  const names = (group.members || []).map(crop => crop.name);
  if (names.length <= 2) return names.join(" / ");
  return names.slice(0, 2).join(" / ") + " 等 " + names.length + " 种";
}

function modeNoteHTML() {
  const mode = ratioModeById(farm.ratioMode);
  if (!mode.note) return "";
  return `<p class="calc-mode-note">${esc(mode.note)}</p>`;
}

function pairCardHTML(mate) {
  const net = FarmCalc.NUTRIENTS.map(k => `${fertTag(k)} <b>${esc(signed(mate.net[k]))}</b>`).join(" ");
  return (
    `<div class="plan-card pair-card">` +
    `<div class="plan-chips"><span class="plan-chip">${esc(mate.crop.name)} ×<b>1</b></span></div>` +
    `<div class="plan-net">与所选各种 1 株，合计 ${net}</div>` +
    commonFitSeasonHTML(cropsFromPair(mate)) +
    `</div>`
  );
}

function tripleCardHTML(plan, index, result) {
  // 3+6 时已选/补种可能是 6，不能写死 ×3
  const locked = (result.locked || []).map(item =>
    `<span class="plan-chip">${esc(item.crop.name)} ×<b>${esc(item.count)}</b></span>`
  ).join("");
  const fills = (plan.parts || []).map(part =>
    `<span class="plan-chip">${esc(groupLabel(part.group))} ×<b>${esc(part.count)}</b></span>`
  ).join("");
  const net = FarmCalc.NUTRIENTS.map(k => `${fertTag(k)} <b>${esc(signed(plan.net[k]))}</b>`).join(" ");
  return (
    `<button type="button" class="plan-card" data-index="${index}">` +
    `<div class="plan-chips">${locked}${fills}</div>` +
    `<div class="plan-net">${net}</div>` +
    commonFitSeasonHTML(cropsFromPlanParts(plan, result)) +
    `</button>`
  );
}

function planCardHTML(plan, index, result) {
  const chips = (plan.parts || []).map(part =>
    `<span class="plan-chip">${esc(groupLabel(part.group))} ×<b>${part.count}</b></span>`
  ).join("");
  const net = FarmCalc.NUTRIENTS.map(k => `${fertTag(k)} <b>${esc(signed(plan.net[k]))}</b>`).join(" ");
  return (
    `<button type="button" class="plan-card" data-index="${index}">` +
    `<div class="plan-chips">${chips}</div>` +
    `<div class="plan-net">${net}</div>` +
    commonFitSeasonHTML(cropsFromPlanParts(plan, result || farm.result)) +
    `</button>`
  );
}

function renderResult() {
  const netHost = Foodfarm.$("calc-net");
  const body = Foodfarm.$("calc-body");
  const r = farm.result;
  if (!netHost || !body) return;
  if (!r) {
    netHost.innerHTML = "";
    body.innerHTML = `<p class="muted">计算中…</p>`;
    return;
  }

  if (r.mode === "1-1") {
    netHost.innerHTML =
      fertStatesHTML(r.focus && r.focus.delta) +
      `<div class="calc-net-note">${esc(r.focus ? r.focus.name : "")} 的 1:1 互补种子</div>`;
    const mates = farm.considerSeason
      ? (r.mates || []).filter(pairHasCommonSeason)
      : (r.mates || []);
    const cards = mates.map(pairCardHTML).join("");
    body.innerHTML =
      modeNoteHTML() +
      (cards
        ? `<div class="plan-head">共 <b>${mates.length}</b> 种</div><div class="plan-list${mates.length > 4 ? " is-two" : ""}">${cards}</div>`
        : `<p class="muted">${esc(
          farm.considerSeason && (r.mates || []).length
            ? "有互补种子，但没有共同适合季节"
            : (r.message || "没有 1:1 互补种子")
        )}</p>`);
    Foodfarm.bindContentTags(netHost);
    Foodfarm.bindContentTags(body);
    return;
  }

  if (r.mode === "3-3-3") {
    netHost.innerHTML =
      fertStatesHTML(r.base || {}) +
      `<div class="calc-net-note">已选 <b>${r.used || 0}</b> 株（3 或 6）；剩余 <b>${Math.max(0, 9 - (r.used || 0))}</b> 格按 3 / 6 补齐</div>`;
    const note = modeNoteHTML();
    if (!r.ok) {
      body.innerHTML = note + `<p class="calc-warn"><warn>${esc(r.message || "没有配比")}</warn></p>`;
    } else {
      const entries = visiblePlanEntries(r.plans, r);
      const shown = entries.length;
      const more = !farm.considerSeason && r.total > (r.plans || []).length
        ? `，显示前 <b>${(r.plans || []).length}</b> 种`
        : "";
      body.innerHTML =
        note +
        (shown
          ? `<div class="plan-head">共 <b>${shown}</b> 种配比${more}</div>` +
            `<div class="plan-list${shown > 4 ? " is-two" : ""}">${entries.map(e => tripleCardHTML(e.plan, e.index, r)).join("")}</div>`
          : `<p class="muted">有肥料配比，但没有共同适合季节的方案</p>`);
    }
    Foodfarm.bindContentTags(netHost);
    Foodfarm.bindContentTags(body);
    return;
  }

  netHost.innerHTML =
    fertStatesHTML(r.base || {}) +
    `<div class="calc-net-note">已选 <b>${r.used || 0}</b> 株的肥料净值；剩余 <b>${Math.max(0, (r.slots || 9) - (r.used || 0))}</b> 格从全部种子补齐</div>`;

  const notice = `<p class="calc-family"><notice text="同种可跨地皮计数，成排种植最容易满足">${esc(FarmCalc.FAMILY.notice)}</notice></p>`;

  if (!r.ok) {
    let extra = "";
    if (r.reason === "deficit" && r.closest && (!farm.considerSeason || planHasCommonSeason(r.closest, r))) {
      extra = `<div class="plan-head">最接近的补齐方案</div><div class="plan-list">${planCardHTML(r.closest, -1, r)}</div>`;
    }
    body.innerHTML = notice + `<p class="calc-warn"><warn>${esc(r.message)}</warn></p>` + extra;
  } else {
    const entries = visiblePlanEntries(r.plans, r);
    const shown = entries.length;
    const more = !farm.considerSeason && r.total > (r.plans || []).length
      ? `，显示前 <b>${(r.plans || []).length}</b> 种`
      : "";
    body.innerHTML =
      notice +
      (shown
        ? `<div class="plan-head">共 <b>${shown}</b> 种配比${more}</div>` +
          `<div class="plan-list${shown > 4 ? " is-two" : ""}">${entries.map(e => planCardHTML(e.plan, e.index, r)).join("")}</div>`
        : `<p class="muted">有肥料配比，但没有共同适合季节的方案</p>`);
  }
  Foodfarm.bindContentTags(netHost);
  Foodfarm.bindContentTags(body);
}

/* ---------- 配比放大 ---------- */

function memberRowsHTML(crops) {
  return crops.map(crop => {
    const cells = FarmCalc.NUTRIENTS.map(k => {
      const c = crop.consume[k] ? `-${crop.consume[k]}` : "";
      const p = crop.produce[k] ? `+${crop.produce[k]}` : "";
      return `<td>${c || p ? `<b>${esc([c, p].filter(Boolean).join(" / "))}</b>` : "0"}</td>`;
    }).join("");
    return `<tr><td>${esc(crop.name)}</td>${cells}</tr>`;
  }).join("");
}

function memberTableHTML(crops) {
  const head = FarmCalc.NUTRIENTS.map(k => `<th>${fertTag(k)}</th>`).join("");
  return `<table><thead><tr><th>植株</th>${head}</tr></thead><tbody>${memberRowsHTML(crops)}</tbody></table>`;
}

function openPlanModal(index) {
  const r = farm.result;
  if (!r) return;
  const plan = index < 0 ? r.closest : r.plans && r.plans[index];
  if (!plan) return;

  const netHost = Foodfarm.$("plan-modal-net");
  if (netHost) {
    netHost.innerHTML =
      fertStatesHTML(plan.net) +
      commonFitSeasonHTML(cropsFromPlanParts(plan, r));
  }

  const lockedRows = (r.locked || []).map(item =>
    `<details class="plan-row"><summary><span>${esc(item.crop.name)}</span><span>×<b>${item.count}</b>（已选）</span></summary>${memberTableHTML([item.crop])}</details>`
  ).join("");
  const fillRows = (plan.parts || []).map(part => {
    const sig = FarmCalc.NUTRIENTS.map(k => `${fertTag(k)} <b>${esc(signed(part.group.delta[k]))}</b>`).join(" ");
    return (
      `<details class="plan-row"><summary><span>${esc(groupLabel(part.group))}</span><span>×<b>${part.count}</b></span></summary>` +
      `<p class="plan-sig">每株净值：${sig}；以下任选一种或混种，总数 <b>${part.count}</b> 株</p>` +
      memberTableHTML(part.group.members) +
      `</details>`
    );
  }).join("");

  const rows = Foodfarm.$("plan-modal-rows");
  const emptyFill = r.used < r.slots ? "没有其他种子可补种" : "已满 " + r.slots + " 格，无需补种";
  rows.innerHTML = lockedRows + (fillRows || `<p class="muted">${emptyFill}</p>`);
  Foodfarm.bindContentTags(rows);
  if (netHost) Foodfarm.bindContentTags(netHost);
  openModal("plan-modal");
}

/* ---------- 启动 ---------- */

function renderAll() {
  rebuildCrops();
  renderGrid();
  renderPicker();
  scheduleCalc();
  syncPanel();
}

renderFilterChecks();
bindGrid();
bindModals();
bindDrawers();
bindPicker();
bindPanel();
bindSeasonCheck();
bindDeficitChecks();

Foodfarm.bootFoodfarm({
  onReady: renderAll,
  onModsChange: renderAll
});
