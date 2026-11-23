const NARROW = window.matchMedia("(max-width: 720px)");

const cook = {
  foods: [],
  dishes: [],
  foodById: new Map(),
  dishById: new Map(),
  slots: [null, null, null, null],
  pickIndex: -1,
  ingSearch: "",
  possibleSearch: "",
  pickSearch: "",
  calcWant: new Set(),
  gridWant: new Set(),
  healMin: 10,
  sanityMin: 10,
  gridHealMin: 10,
  gridSanityMin: 10,
  gridSearch: "",
  openDegrees: new Set(),
  exampleCache: new Map(),
  /** 满锅并列时当前查看的料理 id */
  resultFocusId: ""
};

function plainMetric(value) {
  if (value == null || value === "") return "";
  return String(value).trim();
}

function cookTimeText(value) {
  const text = plainMetric(value);
  if (!text) return "";
  if (text === "待补充") return "待补充";
  return text + " 秒";
}

const esc = text => Foodfarm.escapeHTML(text == null ? "" : String(text));

function dishKey(dish) {
  if (!dish) return "";
  if (dish.id != null && String(dish.id).trim()) return String(dish.id).trim();
  return String(dish.name || "").trim();
}

function foodKey(food) {
  if (!food) return "";
  if (food.id != null && String(food.id).trim()) return String(food.id).trim();
  return String(food.name || "").trim();
}

function rebuild() {
  cook.foods = Foodfarm.foodItems().filter(item =>
    item && (item.id || item.name) && !item.plantOnly && !item.noCook && Foodfarm.hasDegreesField(item)
  );
  cook.dishes = Foodfarm.cookItems().filter(item => item && (item.id || item.name));
  cook.foodById.clear();
  cook.dishById.clear();
  cook.foods.forEach(f => cook.foodById.set(foodKey(f), f));
  cook.dishes.forEach(d => cook.dishById.set(dishKey(d), d));
  if (window.CookCalc && CookCalc.useFoods) CookCalc.useFoods(cook.foods);
  cook.exampleCache.clear();
  cook.slots = cook.slots.map(s => {
    if (!s) return null;
    const base = cook.foodById.get(s.baseId || foodKey(s));
    if (!base) return null;
    return presentSlot(base, s.form);
  });
}

/* ---------- 中间图鉴 ---------- */

function dishCardHTML(dish) {
  return (
    `<button type="button" class="food-card" data-dish-id="${esc(dishKey(dish))}">` +
    `<div class="food-card-name">${esc(dish.name || dish.id)}</div>` +
    (Foodfarm.foodTypeText(dish)
      ? `<div class="food-card-type">${Foodfarm.foodTypeHTML(dish)}</div>`
      : "") +
    `<div class="food-card-stats tag-text">${Foodfarm.foodStatesHTML(dish)}</div>` +
    `</button>`
  );
}

function renderGrid() {
  const host = Foodfarm.$("cook-body");
  if (!host) return;
  if (!cook.dishes.length) {
    host.innerHTML = `<p class="empty-center">暂无料理数据。</p>`;
    return;
  }
  let list = CookCalc.filterWanted(cook.dishes, [...cook.gridWant], {
    healMin: cook.gridHealMin,
    sanityMin: cook.gridSanityMin
  });
  const q = String(cook.gridSearch || "").trim().toLowerCase();
  if (q) list = list.filter(d => `${d.name || ""} ${d.id || ""}`.toLowerCase().includes(q));
  if (!list.length) {
    host.innerHTML = `<p class="empty-center">条件太多了，无对应料理</p>`;
    return;
  }
  const groups = Foodfarm.groupItemsByOrigin(list);
  host.innerHTML = Foodfarm.originSectionsHTML(groups, dishCardHTML);
  Foodfarm.bindOriginSections(host);
  Foodfarm.bindContentTags(host);
}

function originDishLabel(dish) {
  const name = Foodfarm.originLabel(dish);
  return name === "原版" ? "原版料理" : `${name}料理`;
}

function isWarlyDish(dish) {
  return !!(dish && String(dish.exclusive || "").trim() === "warly");
}

function warlyTipHTML(withExtra) {
  let text = "大厨特色菜，需要使用便携烹饪锅烹饪";
  if (withExtra) text += "。普通烹饪锅只会做出其他料理";
  text += "，实际烹饪时间会由于锅属性减少20%";
  return `<p class="cook-warly-note">${esc(text)}</p>`;
}

function dishInfoHTML(dish, opts) {
  const skipWarlyTip = opts && opts.skipWarlyTip;
  const requireEntryHTML = r => {
    if (!r) return "";
    if (Array.isArray(r.or)) return r.or.map(requireEntryHTML).filter(Boolean).join(" 或 ");
    const key = Foodfarm.normalizeDegreeKey ? Foodfarm.normalizeDegreeKey(r.degree) : r.degree;
    const name = Foodfarm.degreeLabel ? Foodfarm.degreeLabel(key) : key;
    const tag = esc(key || r.degree);
    const labeled = `<${tag}>${esc(name)}</${tag}>`;
    const op = String(r.op || ">=");
    if (op === "<=") return `0 &lt; ${labeled} ≤ <b>${esc(r.value)}</b>`;
    if (op === "<") return `0 &lt; ${labeled} &lt; <b>${esc(r.value)}</b>`;
    return `${labeled} ${esc(op)} <b>${esc(r.value)}</b>`;
  };
  const req = (dish.requires || []).map(requireEntryHTML).filter(Boolean).join("；");
  const must = (dish.must || []).map(mustEntryHTML).join("；");
  const rawAmong = (Array.isArray(dish.atLeastOneRaw) ? dish.atLeastOneRaw : [])
    .map(name => String(name == null ? "" : name).trim())
    .filter(Boolean);
  const rawNote = rawAmong.length
    ? `（${rawAmong.map(n => esc(n)).join("、")}至少有一个为生，不能都烤）`
    : "";
  const limit = (dish.limit || []).map(l => {
    if (typeof l === "string") return esc(l);
    if (l.degree) {
      const key = Foodfarm.normalizeDegreeKey ? Foodfarm.normalizeDegreeKey(l.degree) : l.degree;
      const tag = esc(key || l.degree);
      return `<${tag}>${esc(Foodfarm.degreeLabel(key))}</${tag}>`;
    }
    return esc(l.name || l.id || "");
  }).join("；");
  return [
    `<p>${esc(originDishLabel(dish))}</p>`,
    !skipWarlyTip && isWarlyDish(dish) ? warlyTipHTML(false) : "",
    `<p>类型：${Foodfarm.foodTypeHTML(dish)}</p>`,
    plainMetric(dish.priority) ? `<p>优先级：<b>${esc(plainMetric(dish.priority))}</b></p>` : "",
    cookTimeText(dish.cookSeconds) ? `<p>烹饪：<b>${esc(cookTimeText(dish.cookSeconds))}</b></p>` : "",
    Foodfarm.spoilLabel(dish.spoilDays) ? `<p>保鲜：<b>${esc(Foodfarm.spoilLabel(dish.spoilDays))}</b></p>` : "",
    req ? `<p>度要求：${req}</p>` : "",
    must || rawNote ? `<p>必用：${must || ""}${rawNote}</p>` : "",
    limit ? `<p>限制：${limit}</p>` : "",
    (() => {
      const fx = Foodfarm.effectHTML(dish.effect);
      return fx ? `<p class="tag-text">效果：${fx}</p>` : "";
    })()
  ].join("");
}

function mustEntryHTML(entry) {
  if (entry == null) return "";
  if (typeof entry === "string") return esc(Foodfarm.mustNameLabel(entry) || entry);
  if (Array.isArray(entry.or)) return entry.or.map(mustEntryHTML).filter(Boolean).join(" 或 ");
  const rawName = entry.name != null && String(entry.name).trim()
    ? String(entry.name).trim()
    : (entry.id != null ? String(entry.id).trim() : "");
  const name = esc(Foodfarm.mustNameLabel(rawName) || rawName);
  if (entry.value == null) return name;
  return `${name} ${esc(entry.op || ">=")} <b>${esc(entry.value)}</b>`;
}

function ensureExamples(dish) {
  const id = dishKey(dish);
  if (!cook.exampleCache.has(id)) {
    cook.exampleCache.set(id, CookCalc.exampleRecipes(dish, cook.foods, cook.dishes));
  }
  return cook.exampleCache.get(id);
}

function exampleRecipeKey(rec) {
  return (rec && rec.slots || []).map(slot => slot.id || slot.name).slice().sort().join("\0");
}

function dishExamplesMarkup(dish, withNote) {
  const id = dishKey(dish);
  const examples = ensureExamples(dish);
  const recipeLines = (examples.recipes || []).map(rec => {
    const names = (rec.names || []).map(n => esc(n)).join(" + ");
    const mark = rec.ok ? "" : ` <span class="muted">（${esc(rec.message || "未校验通过")}）</span>`;
    return `<li>${names}${mark}</li>`;
  }).join("");
  const showNote = withNote || (examples.note && examples.note.indexOf("没有其他") === 0);
  return (
    `<div class="food-modal-label">可实现举例</div>` +
    (showNote ? `<p class="muted">${esc(examples.note || "")}</p>` : "") +
    (recipeLines ? `<ul class="dish-recipe-list">${recipeLines}</ul>` : `<p class="muted">暂无示例</p>`) +
    `<button type="button" class="cook-example-reroll" data-reroll-examples="${esc(id)}">随机生成其他</button>`
  );
}

function refreshExampleBlocks(id) {
  const dish = cook.dishById.get(id);
  if (!dish) return;
  document.querySelectorAll("[data-dish-examples]").forEach(el => {
    if (el.getAttribute("data-dish-examples") !== id) return;
    el.innerHTML = dishExamplesMarkup(dish, el.getAttribute("data-example-note") === "1");
    Foodfarm.bindContentTags(el);
  });
}

function rerollExamples(id) {
  const dish = cook.dishById.get(id);
  if (!dish || !window.CookCalc) return;
  const current = ensureExamples(dish);
  const exclude = {};
  (current.recipes || []).forEach(rec => {
    const key = exampleRecipeKey(rec);
    if (key) exclude[key] = true;
  });
  const next = CookCalc.exampleRecipes(dish, cook.foods, cook.dishes, { exclude, want: 2 });
  if (next.fresh) cook.exampleCache.set(id, next);
  else cook.exampleCache.set(id, { recipes: current.recipes || [], note: "没有其他可行配方" });
  refreshExampleBlocks(id);
}

function dishDescHTML(dish) {
  const id = esc(dishKey(dish));
  return dishInfoHTML(dish) + `<div class="dish-recipes" data-dish-examples="${id}" data-example-note="1">${dishExamplesMarkup(dish, true)}</div>`;
}

function dishFullHTML(dish, opts) {
  return (
    `<article class="cook-dish">` +
    `<div class="cook-dish-head">` +
    `<div class="cook-dish-name">${esc(dish.name || dish.id)}</div>` +
    `<div class="food-card-stats tag-text">${Foodfarm.foodStatesHTML(dish)}</div>` +
    `</div>` +
    `<div class="cook-dish-scroll tag-text">${dishInfoHTML(dish, opts)}</div>` +
    `<div class="cook-dish-examples tag-text" data-dish-examples="${esc(dishKey(dish))}">${dishExamplesMarkup(dish, false)}</div>` +
    `</article>`
  );
}

function openDishModal(dish) {
  if (!dish) return;
  Foodfarm.$("dish-modal-title").textContent = dish.name || dish.id || "料理";
  Foodfarm.$("dish-modal-stats").innerHTML = Foodfarm.foodStatesHTML(dish);
  const desc = Foodfarm.$("dish-modal-desc");
  desc.innerHTML = dishDescHTML(dish);
  Foodfarm.bindContentTags(desc);
  openModal("dish-modal");
}

/* ---------- 抽屉 ---------- */

function setDrawer(id, open) {
  const drawer = Foodfarm.$(id);
  if (!drawer) return;
  drawer.classList.toggle("is-open", !!open);
  const handle = drawer.querySelector(".side-drawer-handle");
  if (handle) handle.setAttribute("aria-expanded", open ? "true" : "false");
  if (id === "cook-calc-drawer") syncPotPanel();
}

function syncPotPanel() {
  const panel = Foodfarm.$("cook-pot-panel");
  if (!panel) return;
  panel.hidden = NARROW.matches || !drawerOpen("cook-calc-drawer");
}

function drawerOpen(id) {
  const drawer = Foodfarm.$(id);
  return !!(drawer && drawer.classList.contains("is-open"));
}

function syncLayout() {
  const desk = Foodfarm.$("cook-calc-desktop");
  const mob = Foodfarm.$("cook-calc-mobile");
  if (desk) desk.hidden = NARROW.matches;
  if (mob) mob.hidden = !NARROW.matches;
  syncPotPanel();
  renderSlots();
  renderIngList();
  renderWantChecks();
  renderCookState();
}

/* ---------- 筛选条件 ---------- */

const WANT_MUTEX = {
  heal: "healthDown",
  healthDown: "heal",
  sanityUp: "sanityDown",
  sanityDown: "sanityUp"
};

function wantChecksHTML(prefix) {
  return Object.values(CookCalc.WANT).map(w =>
    `<label class="mod-check"><input type="checkbox" data-want="${w.key}" data-scope="${prefix}"><span>${esc(w.name)}</span></label>`
  ).join("");
}

function renderWantChecks() {
  [
    ["cook-want-checks", "calc"],
    ["grid-want-checks", "grid"]
  ].forEach(([id, scope]) => {
    const host = Foodfarm.$(id);
    if (!host) return;
    if (!host.dataset.ready) {
      host.innerHTML = wantChecksHTML(scope);
      host.dataset.ready = "1";
    }
    const set = scope === "grid" ? cook.gridWant : cook.calcWant;
    host.querySelectorAll("input[data-want]").forEach(input => {
      input.checked = set.has(input.dataset.want);
    });
  });
}

function bindWantChecks() {
  document.addEventListener("change", e => {
    const input = e.target.closest("input[data-want]");
    if (!input) return;
    const set = input.dataset.scope === "grid" ? cook.gridWant : cook.calcWant;
    const key = input.dataset.want;
    if (input.checked) {
      const opposite = WANT_MUTEX[key];
      if (opposite) {
        set.delete(opposite);
        const host = input.closest(".filter-checks");
        const other = host && host.querySelector(`input[data-want="${opposite}"]`);
        if (other) other.checked = false;
      }
      set.add(key);
    } else {
      set.delete(key);
    }
    if (input.dataset.scope === "grid") renderGrid();
    else renderPossibleList();
  });

  const bindNum = (id, key, scope) => {
    const el = Foodfarm.$(id);
    if (!el) return;
    el.addEventListener("change", () => {
      const n = Number(el.value);
      cook[key] = Number.isFinite(n) ? n : 10;
      if (scope === "grid") renderGrid();
      else renderPossibleList();
    });
  };
  bindNum("cook-heal-min", "healMin", "calc");
  bindNum("cook-sanity-min", "sanityMin", "calc");
  bindNum("grid-heal-min", "gridHealMin", "grid");
  bindNum("grid-sanity-min", "gridSanityMin", "grid");

  const search = Foodfarm.$("grid-dish-search");
  if (search) {
    search.addEventListener("input", () => {
      cook.gridSearch = search.value || "";
      renderGrid();
    });
  }

  const reset = Foodfarm.$("cook-filter-reset");
  if (reset) {
    reset.addEventListener("click", () => {
      cook.gridWant.clear();
      cook.gridSearch = "";
      cook.gridHealMin = 10;
      cook.gridSanityMin = 10;
      const h = Foodfarm.$("grid-heal-min");
      const s = Foodfarm.$("grid-sanity-min");
      const q = Foodfarm.$("grid-dish-search");
      if (h) h.value = "10";
      if (s) s.value = "10";
      if (q) q.value = "";
      renderWantChecks();
      renderGrid();
    });
  }
}

/* ---------- 锅槽 ---------- */

function baseOfSlot(item) {
  if (!item) return null;
  if (item._base) return item._base;
  return cook.foodById.get(item.baseId || foodKey(item)) || null;
}

function presentSlot(base, form) {
  if (!base) return null;
  const mode = form === "cooked" || form === "dried" ? form : "raw";
  const variant = mode === "raw" ? null : base[mode];
  if (!variant || typeof variant !== "object") return base;
  const id = variant.id != null && String(variant.id).trim() ? String(variant.id).trim() : foodKey(base) + "_" + mode;
  const name = variant.name != null && String(variant.name).trim() ? variant.name : base.name;
  return {
    id,
    name,
    health: variant.health != null ? variant.health : base.health,
    hunger: variant.hunger != null ? variant.hunger : base.hunger,
    sanity: variant.sanity != null ? variant.sanity : base.sanity,
    spoilDays: variant.spoilDays != null ? variant.spoilDays : base.spoilDays,
    degrees: variant.degrees || base.degrees || {},
    foodtype: variant.foodtype || base.foodtype || "",
    origin: base.origin || "",
    form: mode,
    baseId: foodKey(base),
    _base: base
  };
}

function slotFormHTML(i, item) {
  const base = baseOfSlot(item);
  if (!base) return "";
  const cooked = base.cooked && typeof base.cooked === "object";
  const dried = base.dried && typeof base.dried === "object";
  if (!cooked && !dried) return "";
  const form = item.form || "raw";
  const btn = (key, label) => {
    const on = form === key ? " is-on" : "";
    return `<span class="cook-slot-form${on}" data-slot-form="${key}" data-slot="${i}" role="button" aria-label="${label}">${label}</span>`;
  };
  return `<span class="cook-slot-forms">` + (dried ? btn("dried", "晾") : "") + (cooked ? btn("cooked", "烤") : "") + `</span>`;
}

function slotHTML(i, item, mobile) {
  const filled = !!item;
  const name = filled ? esc(item.name || item.id) : (mobile ? `格 ${i + 1}` : `${i + 1}`);
  const extra = filled && !mobile ? slotExtraHTML(item) : "";
  const forms = filled ? slotFormHTML(i, item) : "";
  return (
    `<button type="button" class="cook-slot${filled ? " is-filled" : ""}${forms ? " has-forms" : ""}" data-slot="${i}">` +
    forms +
    `<span class="cook-slot-name">${name}</span>` +
    extra +
    (filled ? `<span class="cook-slot-clear" data-clear="${i}" title="清空">×</span>` : "") +
    `</button>`
  );
}

function slotExtraHTML(item) {
  const degrees = Foodfarm.foodDegreesHTML(item);
  const spoilText = Foodfarm.spoilLabel(item.spoilDays);
  const spoil = spoilText
    ? `<span class="cook-slot-meta cook-slot-spoil">保鲜 <b>${esc(spoilText)}</b></span>`
    : "";
  return `<span class="cook-slot-meta cook-slot-degrees">${degrees}</span>${spoil}`;
}

function renderSlots() {
  const html = cook.slots.map((item, i) => slotHTML(i, item, false)).join("");
  const htmlM = cook.slots.map((item, i) => slotHTML(i, item, true)).join("");
  const a = Foodfarm.$("cook-slots");
  const b = Foodfarm.$("cook-slots-m");
  if (a) {
    a.innerHTML = html;
    Foodfarm.bindContentTags(a);
  }
  if (b) b.innerHTML = htmlM;
}

function firstEmptySlot() {
  const i = cook.slots.findIndex(s => !s);
  return i < 0 ? -1 : i;
}

function toggleSlotForm(index, form) {
  const item = cook.slots[index];
  const base = baseOfSlot(item);
  if (!base || !base[form] || typeof base[form] !== "object") return;
  const current = item.form || "raw";
  setSlot(index, presentSlot(base, current === form ? "raw" : form));
}

function setSlot(index, food) {
  if (index < 0 || index > 3) return;
  cook.slots[index] = food || null;
  renderSlots();
  renderIngList();
  renderCookState();
}

function clearSlots() {
  cook.slots = [null, null, null, null];
  renderSlots();
  renderIngList();
  renderCookState();
}

function addIngredient(food) {
  if (!food) return;
  const i = firstEmptySlot();
  if (i < 0) return;
  setSlot(i, food);
}

/* ---------- 左侧食材列表（桌面） ---------- */

function degreeGroups(list) {
  const order = (window.CookCalc && CookCalc.DEGREE_KEYS) || [];
  const buckets = new Map();
  const none = [];
  list.forEach(food => {
    const map = Foodfarm.foodDegreeMap(food);
    const keys = Object.keys(map).filter(key => map[key] > 0);
    if (!keys.length) {
      none.push(food);
      return;
    }
    keys.forEach(key => {
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push({ food, value: map[key] });
    });
  });
  const keys = order.filter(key => buckets.has(key));
  buckets.forEach((_, key) => {
    if (keys.indexOf(key) < 0) keys.push(key);
  });
  return { keys, buckets, none };
}

function degreeSectionHTML(key, labelHTML, count, open, body) {
  return (
    `<section class="ing-degree">` +
    `<button type="button" class="ing-degree-toggle" data-degree-toggle="${esc(key)}" aria-expanded="${open ? "true" : "false"}">` +
    `<span class="ing-degree-arrow">${open ? "▾" : "▸"}</span>` +
    `<span class="ing-degree-name tag-text">${labelHTML}</span>` +
    `<span class="ing-degree-count">${count}</span>` +
    `</button>` +
    `<div class="ing-degree-body"${open ? "" : " hidden"}>${body}</div>` +
    `</section>`
  );
}

function degreeLabelHTML(key) {
  const label = esc(Foodfarm.degreeLabel(key));
  const known = Foodfarm.FOOD_DEGREES && Foodfarm.FOOD_DEGREES[key];
  return known ? `<${key}>${label}</${key}>` : label;
}

function ingGroupsHTML(list, query, itemHTML) {
  const groups = degreeGroups(list);
  const parts = groups.keys.map(key => {
    const items = groups.buckets.get(key);
    const open = cook.openDegrees.has(key) || !!query;
    return degreeSectionHTML(key, degreeLabelHTML(key), items.length, open, items.map(itemHTML).join(""));
  });
  if (groups.none.length) {
    const open = cook.openDegrees.has("none") || !!query;
    parts.push(degreeSectionHTML(
      "none",
      "无烹饪度",
      groups.none.length,
      open,
      groups.none.map(food => itemHTML({ food, value: null })).join("")
    ));
  }
  return parts.join("");
}

function renderIngList() {
  const host = Foodfarm.$("cook-ing-list");
  if (!host || NARROW.matches) return;
  const q = cook.ingSearch.trim().toLowerCase();
  const list = cook.foods.filter(f => {
    if (!q) return true;
    return `${f.name || ""} ${f.id || ""}`.toLowerCase().includes(q);
  });
  const full = firstEmptySlot() < 0;
  host.innerHTML = list.length
    ? ingGroupsHTML(list, q, item => {
      const food = item.food;
      const id = foodKey(food);
      const on = cook.slots.some(s => s && (s.baseId || foodKey(s)) === id) ? " is-on" : "";
      const val = item.value != null ? ` <b>${esc(item.value)}</b>` : "";
      return `<button type="button" class="calc-seed${on}" data-food-id="${esc(id)}"${full ? " disabled" : ""}>${esc(food.name || food.id)}${val}</button>`;
    })
    : `<p class="muted">没有匹配的食物</p>`;
  Foodfarm.bindContentTags(host);
}

/* ---------- 度 / 结果 ---------- */

function degreesHTML(agg) {
  const keys = Object.keys(agg.degrees || {});
  if (!keys.length) return `<span class="muted">暂无烹饪度</span>`;
  return keys.map(key => {
    const label = Foodfarm.degreeLabel(key);
    return `<span class="degree-chip"><b>${esc(agg.degrees[key])}</b> <${key}>${esc(label)}</${key}></span>`;
  }).join("");
}

function chancePercent(chance) {
  const n = Number(chance);
  if (!Number.isFinite(n) || n <= 0) return "0%";
  const pct = Math.round(n * 1000) / 10;
  return (Number.isInteger(pct) ? String(pct) : pct.toFixed(1)) + "%";
}

/** 满 4 格：直接展示详情；同优先级并列时用「概率+名称」标签切换 */
function filledResultHTML(state) {
  if (!state || !state.aggregate || !state.aggregate.filled) {
    return `<div class="cook-result-empty">放入 4 格食材</div>`;
  }
  const chances = Array.isArray(state.chances) && state.chances.length
    ? state.chances.slice()
    : (state.candidates || []).map(d => ({ dish: d, chance: 1 / Math.max(1, (state.candidates || []).length) }));
  chances.sort((a, b) => {
    const pa = Number(b.dish && b.dish.priority) - Number(a.dish && a.dish.priority);
    if (pa) return pa;
    return (b.chance || 0) - (a.chance || 0);
  });
  if (!chances.length) {
    if (state.result) {
      const tip = isWarlyDish(state.result) ? warlyTipHTML(false) : "";
      return tip + dishFullHTML(state.result, { skipWarlyTip: isWarlyDish(state.result) });
    }
    return `<div class="cook-result-empty">暂无结果</div>`;
  }

  const ids = chances.map(c => dishKey(c.dish));
  if (!cook.resultFocusId || !ids.includes(cook.resultFocusId)) {
    cook.resultFocusId = ids[0];
  }
  const focus = chances.find(c => dishKey(c.dish) === cook.resultFocusId) || chances[0];
  const hasWarly = chances.some(c => isWarlyDish(c.dish));
  const matching = Array.isArray(state.matching) && state.matching.length
    ? state.matching
    : chances.map(c => c.dish);
  const hasOther = matching.some(d => d && !isWarlyDish(d));
  const tip = hasWarly ? warlyTipHTML(hasOther) : "";
  const tabs = chances.length > 1
    ? `<div class="cook-result-tabs">${chances.map(c => {
        const id = dishKey(c.dish);
        const on = id === cook.resultFocusId ? " is-on" : "";
        const label = `${chancePercent(c.chance)} ${c.dish.name || c.dish.id || ""}`;
        return `<button type="button" class="cook-result-tab${on}" data-result-tab="${esc(id)}">${esc(label)}</button>`;
      }).join("")}</div>`
    : "";

  return tip + tabs + dishFullHTML(focus.dish, { skipWarlyTip: hasWarly });
}

function resultHTML(state) {
  if (!state) return `<div class="cook-result-empty">放入 4 格食材</div>`;
  if (!state.aggregate.filled) {
    return `<div class="cook-result-empty">已放 ${state.aggregate.count} / 4</div>`;
  }
  return filledResultHTML(state);
}

/** 手机料理栏：未满 4 格时按名称列出可能产生的料理；满格后直接展示详情 */
function mobileResultHTML(state) {
  const filled = cook.slots.filter(Boolean);
  if (filled.length >= 4) return filledResultHTML(state);

  let list = CookCalc.previewPossible(filled, cook.dishes).dishes || [];
  const count = filled.length;
  const head = count
    ? `<div class="cook-preview-label">已放 ${count} / 4 · 可能产生 ${list.length} 道</div>`
    : `<div class="cook-preview-label">可能产生的料理（点名称查看）</div>`;
  if (!list.length) {
    return head + `<div class="cook-result-empty">暂无可能料理</div>`;
  }
  return (
    head +
    `<div class="cook-preview-list">${list.map(d =>
      `<button type="button" class="cook-preview-name" data-dish-id="${esc(dishKey(d))}">${esc(d.name || d.id)}</button>`
    ).join("")}</div>`
  );
}

function renderCookState() {
  const filled = cook.slots.filter(Boolean);
  const state = filled.length
    ? (filled.length >= 4
      ? CookCalc.cook(filled, cook.dishes)
      : { aggregate: CookCalc.aggregate(filled), wetGoop: false, result: null, candidates: [], ok: false })
    : null;

  const deg = state ? degreesHTML(state.aggregate) : `<span class="muted">暂无烹饪度</span>`;
  ["cook-degrees", "cook-degrees-m"].forEach(id => {
    const el = Foodfarm.$(id);
    if (!el) return;
    el.innerHTML = deg;
    Foodfarm.bindContentTags(el);
  });

  if (filled.length < 4) cook.resultFocusId = "";
  const ready = state && filled.length >= 4
    ? state
    : (state ? { aggregate: state.aggregate, wetGoop: false, result: null, candidates: [], chances: [], ok: false } : null);
  const desktop = Foodfarm.$("cook-result");
  const mobile = Foodfarm.$("cook-result-m");
  if (desktop) {
    desktop.innerHTML = resultHTML(ready);
    Foodfarm.bindContentTags(desktop);
  }
  if (mobile) {
    mobile.innerHTML = mobileResultHTML(ready);
    Foodfarm.bindContentTags(mobile);
  }
}

/* ---------- 可能产生 ---------- */

function openPossibleModal() {
  cook.possibleSearch = "";
  const search = Foodfarm.$("possible-search");
  if (search) search.value = "";
  renderPossibleList();
  openModal("possible-modal");
}

function renderPossibleList() {
  const host = Foodfarm.$("possible-list");
  if (!host) return;
  const filled = cook.slots.filter(Boolean);
  let list = CookCalc.previewPossible(filled, cook.dishes).dishes;
  list = CookCalc.filterWanted(list, [...cook.calcWant], {
    healMin: cook.healMin,
    sanityMin: cook.sanityMin
  });
  const q = cook.possibleSearch.trim().toLowerCase();
  if (q) list = list.filter(d => `${d.name || ""} ${d.id || ""}`.toLowerCase().includes(q));
  if (!list.length) {
    host.innerHTML = `<p class="muted">没有符合条件的料理</p>`;
    return;
  }
  host.innerHTML = list.map(d =>
    `<button type="button" class="cook-possible-item" data-dish-id="${esc(dishKey(d))}">` +
    `<span class="cook-possible-name">${esc(d.name || d.id)}</span>` +
    `<span class="cook-possible-pri">优先级 ${esc(plainMetric(d.priority) || "0")}</span>` +
    `</button>`
  ).join("");
}

function applyDishSample(dish) {
  const fill = CookCalc.supplementFill(dish, cook.slots, cook.foods);
  const next = [null, null, null, null];
  (fill.slots || []).forEach((item, i) => {
    if (!item) return;
    if (cook.slots[i]) {
      next[i] = cook.slots[i];
      return;
    }
    const key = item.baseId || foodKey(item);
    const base = cook.foodById.get(key) || cook.foods.find(f => foodKey(f) === key) || null;
    next[i] = base ? presentSlot(base, item.form) : null;
  });
  cook.slots = next;
  closeModal("possible-modal");
  renderSlots();
  renderIngList();
  renderCookState();
  if (!drawerOpen("cook-calc-drawer")) setDrawer("cook-calc-drawer", true);
}

/* ---------- 手机选材 ---------- */

function openPickModal(index) {
  cook.pickIndex = index;
  cook.pickSearch = "";
  const search = Foodfarm.$("pick-search");
  if (search) search.value = "";
  const title = Foodfarm.$("pick-modal-title");
  if (title) title.textContent = `选择食材（格 ${index + 1}）`;
  renderPickList();
  openModal("pick-modal");
}

function renderPickList() {
  const host = Foodfarm.$("pick-list");
  if (!host) return;
  const q = cook.pickSearch.trim().toLowerCase();
  const list = cook.foods.filter(f => {
    if (!q) return true;
    return `${f.name || ""} ${f.id || ""}`.toLowerCase().includes(q);
  });
  host.innerHTML = list.length
    ? `<button type="button" class="cook-possible-item is-clear" data-clear-slot="1">清空此格</button>` +
      ingGroupsHTML(list, q, item => {
        const food = item.food;
        const val = item.value != null ? ` <b>${esc(item.value)}</b>` : "";
        return (
          `<button type="button" class="cook-possible-item" data-food-id="${esc(foodKey(food))}">` +
          `<span class="cook-possible-name">${esc(food.name || food.id)}${val}</span>` +
          `</button>`
        );
      })
    : `<p class="muted">没有匹配的食物</p>`;
  Foodfarm.bindContentTags(host);
}

/* ---------- 弹窗 ---------- */

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

/* ---------- 绑定 ---------- */

function bindUI() {
  ["cook-calc-drawer", "cook-filter-drawer"].forEach(id => {
    const drawer = Foodfarm.$(id);
    const handle = drawer && drawer.querySelector(".side-drawer-handle");
    if (handle) handle.addEventListener("click", () => setDrawer(id, !drawerOpen(id)));
  });

  Foodfarm.$("cook-body").addEventListener("click", e => {
    const card = e.target.closest(".food-card[data-dish-id]");
    if (!card) return;
    openDishModal(cook.dishById.get(card.dataset.dishId));
  });

  const ingSearch = Foodfarm.$("cook-ing-search");
  if (ingSearch) {
    ingSearch.addEventListener("input", () => {
      cook.ingSearch = ingSearch.value || "";
      renderIngList();
    });
  }

  document.addEventListener("click", e => {
    const close = e.target.closest("[data-close]");
    if (close) closeModal(close.dataset.close);

    const reroll = e.target.closest("[data-reroll-examples]");
    if (reroll) {
      e.preventDefault();
      e.stopPropagation();
      rerollExamples(reroll.getAttribute("data-reroll-examples"));
      return;
    }

    const clearSlot = e.target.closest("[data-clear]");
    if (clearSlot) {
      e.preventDefault();
      e.stopPropagation();
      setSlot(Number(clearSlot.dataset.clear), null);
      return;
    }

    const formBtn = e.target.closest("[data-slot-form]");
    if (formBtn) {
      e.preventDefault();
      e.stopPropagation();
      toggleSlotForm(Number(formBtn.dataset.slot), formBtn.dataset.slotForm);
      return;
    }

    const slot = e.target.closest(".cook-slot[data-slot]");
    if (slot) {
      const i = Number(slot.dataset.slot);
      if (NARROW.matches) openPickModal(i);
      else if (cook.slots[i]) setSlot(i, null);
      return;
    }

    const degreeToggle = e.target.closest("[data-degree-toggle]");
    if (degreeToggle) {
      e.preventDefault();
      const key = degreeToggle.getAttribute("data-degree-toggle");
      if (cook.openDegrees.has(key)) cook.openDegrees.delete(key);
      else cook.openDegrees.add(key);
      renderIngList();
      renderPickList();
      return;
    }

    const foodBtn = e.target.closest("#cook-ing-list [data-food-id]");
    if (foodBtn) {
      addIngredient(cook.foodById.get(foodBtn.dataset.foodId));
      return;
    }

    if (e.target.closest("#cook-clear-slots, #cook-clear-slots-m")) {
      clearSlots();
      return;
    }

    if (e.target.closest("#cook-possible-btn, #cook-possible-btn-m")) {
      openPossibleModal();
      return;
    }

    const possible = e.target.closest("#possible-list [data-dish-id]");
    if (possible) {
      applyDishSample(cook.dishById.get(possible.dataset.dishId));
      return;
    }

    const pickClear = e.target.closest("#pick-list [data-clear-slot]");
    if (pickClear) {
      setSlot(cook.pickIndex, null);
      closeModal("pick-modal");
      return;
    }

    const pickFood = e.target.closest("#pick-list [data-food-id]");
    if (pickFood) {
      setSlot(cook.pickIndex, cook.foodById.get(pickFood.dataset.foodId));
      closeModal("pick-modal");
      return;
    }

    const resultTab = e.target.closest("[data-result-tab]");
    if (resultTab) {
      cook.resultFocusId = resultTab.getAttribute("data-result-tab") || "";
      renderCookState();
      return;
    }

    const preview = e.target.closest("#cook-result-m [data-dish-id]");
    if (preview) {
      openDishModal(cook.dishById.get(preview.dataset.dishId));
      return;
    }

    const result = e.target.closest("[data-result-id]");
    if (result) {
      openDishModal(cook.dishById.get(result.dataset.resultId));
    }
  });

  const possibleSearch = Foodfarm.$("possible-search");
  if (possibleSearch) {
    possibleSearch.addEventListener("input", () => {
      cook.possibleSearch = possibleSearch.value || "";
      renderPossibleList();
    });
  }

  const pickSearch = Foodfarm.$("pick-search");
  if (pickSearch) {
    pickSearch.addEventListener("input", () => {
      cook.pickSearch = pickSearch.value || "";
      renderPickList();
    });
  }

  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    const open = [...document.querySelectorAll(".food-modal:not([hidden])")].pop();
    if (open) closeModal(open.id);
  });

  NARROW.addEventListener("change", syncLayout);
}

function renderAll() {
  rebuild();
  renderWantChecks();
  renderGrid();
  syncLayout();
}

bindWantChecks();
bindUI();

Foodfarm.bootFoodfarm({
  onReady: renderAll,
  onModsChange: renderAll
});
