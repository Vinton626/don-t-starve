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
  gridSanityMin: 10
};

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
  cook.foods = Foodfarm.foodItems().filter(item => item && (item.id || item.name));
  cook.dishes = Foodfarm.cookItems().filter(item => item && (item.id || item.name));
  cook.foodById.clear();
  cook.dishById.clear();
  cook.foods.forEach(f => cook.foodById.set(foodKey(f), f));
  cook.dishes.forEach(d => cook.dishById.set(dishKey(d), d));
  cook.slots = cook.slots.map(s => {
    if (!s) return null;
    return cook.foodById.get(foodKey(s)) || null;
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
  const list = CookCalc.filterWanted(cook.dishes, [...cook.gridWant], {
    healMin: cook.gridHealMin,
    sanityMin: cook.gridSanityMin
  });
  if (!list.length) {
    host.innerHTML = `<p class="empty-center">条件太多了，无对应料理</p>`;
    return;
  }
  host.innerHTML = `<div class="food-grid">${list.map(dishCardHTML).join("")}</div>`;
  Foodfarm.bindContentTags(host);
}

function openDishModal(dish) {
  if (!dish) return;
  Foodfarm.$("dish-modal-title").textContent = dish.name || dish.id || "料理";
  Foodfarm.$("dish-modal-stats").innerHTML = Foodfarm.foodStatesHTML(dish);
  const req = (dish.requires || []).map(r => {
    const name = Foodfarm.degreeLabel ? Foodfarm.degreeLabel(r.degree) : r.degree;
    return `${esc(r.op || ">=")}${esc(r.value)} <${esc(r.degree)}>${esc(name)}</${esc(r.degree)}>`;
  }).join("；");
  const must = (dish.must || []).map(m => {
    if (typeof m === "string") return esc(m);
    return esc(m.name || m.id || "") + (m.value != null ? ` ≥${esc(m.value)}` : "");
  }).join("；");
  const limit = (dish.limit || []).map(l => {
    if (typeof l === "string") return esc(l);
    if (l.degree) return `<${esc(l.degree)}>${esc(Foodfarm.degreeLabel(l.degree))}</${esc(l.degree)}>`;
    return esc(l.name || l.id || "");
  }).join("；");
  const examples = CookCalc.exampleRecipes(dish, cook.foods, cook.dishes);
  const recipeLines = (examples.recipes || []).map(rec => {
    const names = (rec.names || []).map(n => esc(n)).join(" + ");
    const mark = rec.ok ? "" : ` <span class="muted">（${esc(rec.message || "未校验通过")}）</span>`;
    return `<li>${names}${mark}</li>`;
  }).join("");
  const lines = [
    `<p>来源：${esc(Foodfarm.originLabel(dish))}</p>`,
    `<p>类型：${Foodfarm.foodTypeHTML(dish)}</p>`,
    dish.priority != null ? `<p>优先级：<b>${esc(dish.priority)}</b></p>` : "",
    dish.cookSeconds != null ? `<p>烹饪：<b>${esc(dish.cookSeconds)}</b> 秒</p>` : "",
    dish.spoilDays != null ? `<p>保鲜：<b>${esc(dish.spoilDays)}</b> 天</p>` : "",
    req ? `<p>度要求：${req}</p>` : "",
    must ? `<p>必用：${must}</p>` : "",
    limit ? `<p>限制：${limit}</p>` : "",
    dish.effect ? `<p>效果：${dish.effect}</p>` : "",
    `<div class="dish-recipes"><div class="food-modal-label">可实现举例</div>` +
      `<p class="muted">${esc(examples.note || "")}</p>` +
      (recipeLines ? `<ul class="dish-recipe-list">${recipeLines}</ul>` : `<p class="muted">暂无示例</p>`) +
      `</div>`
  ];
  const desc = Foodfarm.$("dish-modal-desc");
  desc.innerHTML = lines.join("");
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
  renderSlots();
  renderIngList();
  renderWantChecks();
  renderCookState();
}

/* ---------- 筛选 / 我想做 ---------- */

function wantChecksHTML(prefix) {
  return Object.values(CookCalc.WANT).map(w =>
    `<label class="mod-check"><input type="checkbox" data-want="${w.key}" data-scope="${prefix}"><span>${esc(w.name)}</span></label>`
  ).join("");
}

function renderWantChecks() {
  [
    ["cook-want-checks", "calc"],
    ["cook-want-checks-m", "calc"],
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
    if (input.checked) set.add(input.dataset.want);
    else set.delete(input.dataset.want);
    if (input.dataset.scope === "grid") renderGrid();
    else renderCookState();
  });

  const bindNum = (id, key, scope) => {
    const el = Foodfarm.$(id);
    if (!el) return;
    el.addEventListener("change", () => {
      const n = Number(el.value);
      cook[key] = Number.isFinite(n) ? n : 10;
      if (scope === "grid") renderGrid();
      else renderCookState();
    });
  };
  bindNum("cook-heal-min", "healMin", "calc");
  bindNum("cook-sanity-min", "sanityMin", "calc");
  bindNum("grid-heal-min", "gridHealMin", "grid");
  bindNum("grid-sanity-min", "gridSanityMin", "grid");

  const reset = Foodfarm.$("cook-filter-reset");
  if (reset) {
    reset.addEventListener("click", () => {
      cook.gridWant.clear();
      cook.gridHealMin = 10;
      cook.gridSanityMin = 10;
      const h = Foodfarm.$("grid-heal-min");
      const s = Foodfarm.$("grid-sanity-min");
      if (h) h.value = "10";
      if (s) s.value = "10";
      renderWantChecks();
      renderGrid();
    });
  }
}

/* ---------- 锅槽 ---------- */

function slotHTML(i, item, mobile) {
  const filled = !!item;
  const name = filled ? esc(item.name || item.id) : (mobile ? `格 ${i + 1}` : `${i + 1}`);
  return (
    `<button type="button" class="cook-slot${filled ? " is-filled" : ""}" data-slot="${i}">` +
    `<span class="cook-slot-name">${name}</span>` +
    (filled ? `<span class="cook-slot-clear" data-clear="${i}" title="清空">×</span>` : "") +
    `</button>`
  );
}

function renderSlots() {
  const html = cook.slots.map((item, i) => slotHTML(i, item, false)).join("");
  const htmlM = cook.slots.map((item, i) => slotHTML(i, item, true)).join("");
  const a = Foodfarm.$("cook-slots");
  const b = Foodfarm.$("cook-slots-m");
  if (a) a.innerHTML = html;
  if (b) b.innerHTML = htmlM;
}

function firstEmptySlot() {
  const i = cook.slots.findIndex(s => !s);
  return i < 0 ? -1 : i;
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
    ? list.map(f => {
      const id = foodKey(f);
      const on = cook.slots.some(s => s && foodKey(s) === id) ? " is-on" : "";
      return `<button type="button" class="calc-seed${on}" data-food-id="${esc(id)}"${full ? " disabled" : ""}>${esc(f.name || f.id)}</button>`;
    }).join("")
    : `<p class="muted">没有匹配的食物</p>`;
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

function resultHTML(state) {
  if (!state) return `<div class="cook-result-empty">放入 4 格食材</div>`;
  if (!state.aggregate.filled) {
    return `<div class="cook-result-empty">已放 ${state.aggregate.count} / 4</div>`;
  }
  if (state.wetGoop) {
    return `<div class="cook-result-dish"><div class="cook-result-name">湿腻焦糊</div><div class="muted">无匹配料理</div></div>`;
  }
  if (state.result) {
    const d = state.result;
    return (
      `<button type="button" class="cook-result-dish" data-result-id="${esc(dishKey(d))}">` +
      `<div class="cook-result-name">${esc(d.name || d.id)}</div>` +
      (Foodfarm.foodTypeText(d)
        ? `<div class="food-card-type">${Foodfarm.foodTypeHTML(d)}</div>`
        : "") +
      `<div class="food-card-stats tag-text">${Foodfarm.foodStatesHTML(d)}</div>` +
      `</button>`
    );
  }
  return (
    `<div class="cook-result-dish">` +
    `<div class="cook-result-name">并列 ${state.candidates.length} 道</div>` +
    `<div class="cook-tie-list">${state.candidates.map(d =>
      `<button type="button" class="calc-seed" data-result-id="${esc(dishKey(d))}">${esc(d.name || d.id)}</button>`
    ).join("")}</div>` +
    `</div>`
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

  const html = resultHTML(state && filled.length >= 4 ? state : (state ? { aggregate: state.aggregate, wetGoop: false, result: null, candidates: [], ok: false } : null));
  ["cook-result", "cook-result-m"].forEach(id => {
    const el = Foodfarm.$(id);
    if (!el) return;
    el.innerHTML = html;
    Foodfarm.bindContentTags(el);
  });
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
    `<span class="cook-possible-pri">优先级 ${esc(d.priority == null ? 0 : d.priority)}</span>` +
    `</button>`
  ).join("");
}

function applyDishSample(dish) {
  const fill = CookCalc.sampleFill(dish, cook.foods, cook.dishes);
  if (!fill.ok && (!fill.slots || fill.slots.length < 4)) {
    // 仍尽量填入已有格子
  }
  const next = [null, null, null, null];
  (fill.slots || []).slice(0, 4).forEach((ing, i) => {
    next[i] = cook.foodById.get(foodKey(ing)) || cook.foods.find(f => foodKey(f) === foodKey(ing)) || null;
  });
  // 若 sample 失败，至少把料理名展示在结果区：用 must 名去猜
  if (next.every(x => !x) && Array.isArray(dish.must)) {
    dish.must.forEach((m, i) => {
      if (i > 3) return;
      const name = typeof m === "string" ? m : (m.name || m.id || "");
      const hit = cook.foods.find(f => f.name === name || f.id === name);
      if (hit) next[i] = hit;
    });
  }
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
      list.map(f =>
        `<button type="button" class="cook-possible-item" data-food-id="${esc(foodKey(f))}">` +
        `<span class="cook-possible-name">${esc(f.name || f.id)}</span>` +
        `<span class="cook-possible-pri tag-text">${Foodfarm.foodDegreesHTML(f)}</span>` +
        `</button>`
      ).join("")
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

    const clearSlot = e.target.closest("[data-clear]");
    if (clearSlot) {
      e.preventDefault();
      e.stopPropagation();
      setSlot(Number(clearSlot.dataset.clear), null);
      return;
    }

    const slot = e.target.closest(".cook-slot[data-slot]");
    if (slot) {
      const i = Number(slot.dataset.slot);
      if (NARROW.matches) openPickModal(i);
      else if (cook.slots[i]) setSlot(i, null);
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
