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
  filter: { fit: new Set(), exclude: new Set(), consume: new Set(), produce: new Set() },
  result: null,
  panelOpen: false,
  calcTimer: 0
};

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
  return true;
}

function seedCardHTML(crop) {
  return (
    `<button type="button" class="food-card" data-crop-id="${esc(crop.id)}">` +
    `<div class="food-card-name">${esc(crop.name)}</div>` +
    `<div class="food-card-stats tag-text">${fertStatesHTML(crop.delta)}</div>` +
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
  host.innerHTML = `<div class="food-grid">${list.map(seedCardHTML).join("")}</div>`;
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
  const reset = Foodfarm.$("filter-reset");
  if (reset) {
    reset.addEventListener("click", () => {
      Object.values(farm.filter).forEach(set => set.clear());
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
  Foodfarm.$("seed-modal-fert").innerHTML = fertStatesHTML(crop.delta);
  Foodfarm.$("seed-modal-stats").innerHTML = Foodfarm.foodStatesHTML(seed);

  const hate = hateSeasons(entry);
  const usage = FarmCalc.NUTRIENTS.map(k => {
    const parts = [];
    if (crop.consume[k]) parts.push("消耗 <b>" + esc(crop.consume[k]) + "</b>");
    if (crop.produce[k]) parts.push("产出 <b>" + esc(crop.produce[k]) + "</b>");
    return parts.length ? fertTag(k) + " " + parts.join("，") : "";
  }).filter(Boolean).join("；");
  const lines = [
    seed.name ? `<p>种子：${esc(seed.name)}</p>` : "",
    `<p>来源：${esc(Foodfarm.originLabel(entry.food))}</p>`,
    usage ? `<p>${usage}</p>` : "",
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
  if (pickIndex(id) >= 0) return;
  if (farm.picks.length >= FarmCalc.MAX_CROPS) {
    flashPickerNote("最多选择 " + FarmCalc.MAX_CROPS + " 种作物");
    return;
  }
  farm.picks.unshift({ id, count: 1 });
  afterPicksChange();
  if (NARROW.matches) openPanel();
}

function setPickCount(id, count) {
  const i = pickIndex(id);
  if (i < 0) return;
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
  if (farm.picks.length) {
    selected.innerHTML =
      `<div class="calc-used">已选 <b>${used}</b> / ${FarmCalc.DEFAULT_SLOTS} 格</div>` +
      farm.picks.map(p => {
        const crop = farm.cropById.get(p.id);
        return (
          `<div class="calc-pick" data-id="${esc(p.id)}">` +
          `<span class="calc-pick-name">${esc(crop.name)}</span>` +
          `<button type="button" class="calc-step" data-step="-1" aria-label="减少">−</button>` +
          `<input type="number" class="calc-count" min="1" max="${FarmCalc.DEFAULT_SLOTS}" value="${p.count}">` +
          `<button type="button" class="calc-step" data-step="1" aria-label="增加">+</button>` +
          `<button type="button" class="calc-remove" aria-label="移除">×</button>` +
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
  if (!NARROW.matches) setDrawer("calc-drawer", false);
  syncPanel();
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
  if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");
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
    farm.result = farm.picks.length
      ? FarmCalc.solveFill(
        farm.picks.map(p => ({ crop: farm.cropById.get(p.id), count: p.count })),
        farm.crops,
        { limit: PLAN_ROWS_LIMIT }
      )
      : null;
    if (panelVisible()) renderResult();
  });
}

function groupLabel(group) {
  const names = group.members.map(m => m.name);
  if (names.length <= 2) return names.join(" / ");
  return names.slice(0, 2).join(" / ") + " 等 " + names.length + " 种";
}

function planCardHTML(plan, index, result) {
  const left = result.slots - result.used;
  const chips = plan.parts.length
    ? plan.parts.map(part => `<span class="plan-chip">${esc(groupLabel(part.group))} ×<b>${part.count}</b></span>`).join("")
    : `<span class="plan-chip">${left ? "没有其他种子可补种" : "已满 " + result.slots + " 格"}</span>`;
  const net = FarmCalc.NUTRIENTS.map(k => `${fertTag(k)} <b>${esc(signed(plan.net[k]))}</b>`).join(" ");
  return (
    `<button type="button" class="plan-card" data-index="${index}">` +
    `<div class="plan-chips">${chips}</div>` +
    `<div class="plan-net">${net}</div>` +
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

  netHost.innerHTML =
    fertStatesHTML(r.base || {}) +
    `<div class="calc-net-note">已选 <b>${r.used || 0}</b> 株的肥料净值；剩余 <b>${Math.max(0, (r.slots || 9) - (r.used || 0))}</b> 格从全部种子补齐</div>`;

  const notice = `<p class="calc-family"><notice text="同种可跨地皮计数，成排种植最容易满足">${esc(FarmCalc.FAMILY.notice)}</notice></p>`;

  if (!r.ok) {
    let extra = "";
    if (r.reason === "deficit" && r.closest) {
      extra = `<div class="plan-head">最接近的补齐方案</div><div class="plan-list">${planCardHTML(r.closest, -1, r)}</div>`;
    }
    body.innerHTML = notice + `<p class="calc-warn"><warn>${esc(r.message)}</warn></p>` + extra;
  } else {
    const shown = r.plans.length;
    const more = r.total > shown ? `，显示前 <b>${shown}</b> 种` : "";
    body.innerHTML =
      notice +
      `<div class="plan-head">共 <b>${r.total}</b> 种配比${more}</div>` +
      `<div class="plan-list${shown > 4 ? " is-two" : ""}">${r.plans.map((p, i) => planCardHTML(p, i, r)).join("")}</div>`;
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

  Foodfarm.$("plan-modal-net").innerHTML = fertStatesHTML(plan.net);

  const lockedRows = r.locked.map(item =>
    `<details class="plan-row"><summary><span>${esc(item.crop.name)}</span><span>×<b>${item.count}</b>（已选）</span></summary>${memberTableHTML([item.crop])}</details>`
  ).join("");
  const fillRows = plan.parts.map(part => {
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

Foodfarm.bootFoodfarm({
  onReady: renderAll,
  onModsChange: renderAll
});
