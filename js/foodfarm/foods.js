let activeFood = null;
let activeForm = "raw";
let cookListCache = null;
let foodQuery = "";
let cookSearchQuery = "";

const FORM_LABEL = { raw: "生", cooked: "烤", dried: "晾" };
const FORM_PREFIX = { cooked: "烤", dried: "晾" };

function formVariant(food, key) {
  const c = food && food[key];
  if (!c || typeof c !== "object") return null;
  if (c.id || c.name || c.health != null || c.hunger != null || c.sanity != null) return c;
  return null;
}

function hasCooked(food) {
  return !!formVariant(food, "cooked");
}

function hasDried(food) {
  return !!formVariant(food, "dried");
}

/** 可切换形态：生 + 有字段的烤/晾。无烤无晾则只有生，不显示按钮 */
function availableForms(food) {
  const forms = ["raw"];
  if (hasCooked(food)) forms.push("cooked");
  if (hasDried(food)) forms.push("dried");
  return forms;
}

function formLabel(form) {
  return FORM_LABEL[form] || "生";
}

/** 卡片/弹窗当前展示：烤/晾叠在生上面，不带 seed */
function displayFood(raw, form) {
  if (!raw) return null;
  const mode = form === "cooked" || form === "dried" ? form : "raw";
  if (mode === "raw") return raw;
  const c = formVariant(raw, mode);
  if (!c) return raw;
  const prefix = FORM_PREFIX[mode] || "";
  return Object.assign({}, raw, c, {
    id: c.id != null && String(c.id).trim() ? String(c.id) : String(raw.id || "") + "_" + mode,
    name: c.name != null && String(c.name).trim() ? c.name : (prefix + (raw.name || raw.id || "")),
    origin: c.origin != null ? c.origin : raw.origin,
    seed: undefined,
    cooked: undefined,
    dried: undefined,
    _raw: raw,
    _form: mode
  });
}

function cardBodyHTML(view) {
  const name = Foodfarm.escapeHTML(view.name || view.id || "未命名");
  return (
    `<div class="food-card-name">${name}</div>` +
    (Foodfarm.foodTypeText(view)
      ? `<div class="food-card-type">${Foodfarm.foodTypeHTML(view)}</div>`
      : "") +
    `<div class="food-card-stats tag-text">${Foodfarm.foodStatesHTML(view)}</div>`
  );
}

function formSetBtn(key, label) {
  return (
    `<button type="button" class="food-roast-btn" data-form-set="${key}" aria-pressed="false" aria-label="${label}">` +
    label +
    `</button>`
  );
}

function formBtnHTML(food) {
  const cooked = hasCooked(food);
  const dried = hasDried(food);
  if (!cooked && !dried) {
    return `<span class="food-roast-btn is-none" title="不可烤不可晾" aria-label="不可烤不可晾">*</span>`;
  }
  return (
    `<div class="food-form-btns">` +
    (dried ? formSetBtn("dried", "晾") : "") +
    (cooked ? formSetBtn("cooked", "烤") : "") +
    `</div>`
  );
}

function foodCardHTML(food) {
  const id = Foodfarm.escapeHTML(food.id || "");
  return (
    `<div class="food-card" data-food-id="${id}" data-form="raw">` +
    formBtnHTML(food) +
    `<button type="button" class="food-card-main">${cardBodyHTML(food)}</button>` +
    `</div>`
  );
}

function paintCardView(card, food, form) {
  const mode = availableForms(food).includes(form) ? form : "raw";
  const view = displayFood(food, mode);
  const main = card.querySelector(".food-card-main");
  card.dataset.form = mode;
  if (main) {
    main.innerHTML = cardBodyHTML(view);
    Foodfarm.bindContentTags(main);
  }
  card.querySelectorAll("[data-form-set]").forEach(btn => {
    const on = btn.getAttribute("data-form-set") === mode;
    btn.classList.toggle("is-on", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

function catalogFoods() {
  const base = Foodfarm.foodItems().filter(item =>
    item && (item.id || item.name) && !item.hide && !item.plantOnly
  );
  const seen = new Set(base.map(item => String(item.id || "")));
  const seeds = [];
  Foodfarm.foodItems().forEach(item => {
    const seed = item && item.seed;
    if (!seed || typeof seed !== "object") return;
    const id = String(seed.id || "");
    if (!id || seen.has(id)) return;
    seen.add(id);
    seeds.push(Object.assign({ origin: item.origin, hide: false }, seed));
  });
  return base.concat(seeds);
}

function renderFoods() {
  const host = Foodfarm.$("food-body");
  if (!host) return;
  const all = catalogFoods();
  if (!all.length) {
    host.innerHTML = `<p class="panel-note">暂无食物数据。</p>`;
    Foodfarm.bindContentTags(host);
    return;
  }
  const q = String(foodQuery || "").trim().toLowerCase();
  const items = q
    ? all.filter(item => `${item.name || ""} ${item.id || ""}`.toLowerCase().includes(q))
    : all;
  if (!items.length) {
    host.innerHTML = `<p class="panel-note">没有匹配的食物。</p>`;
    Foodfarm.bindContentTags(host);
    return;
  }
  const groups = Foodfarm.groupItemsByOrigin(items);
  host.innerHTML = Foodfarm.originSectionsHTML(groups, foodCardHTML);
  Foodfarm.bindOriginSections(host);
  Foodfarm.bindContentTags(host);

  host.querySelectorAll(".food-card").forEach(card => {
    const id = card.getAttribute("data-food-id");
    const food = items.find(item => String(item.id) === id) || null;
    const main = card.querySelector(".food-card-main");
    if (main) {
      main.addEventListener("click", () => {
        openFoodModal(food, card.dataset.form || "raw");
      });
    }
    if (food) {
      card.querySelectorAll("[data-form-set]").forEach(btn => {
        btn.addEventListener("click", e => {
          e.preventDefault();
          e.stopPropagation();
          const key = btn.getAttribute("data-form-set");
          const cur = card.dataset.form || "raw";
          paintCardView(card, food, cur === key ? "raw" : key);
        });
      });
    }
  });
}

function seedBriefHTML(food) {
  const seed = Foodfarm.resolveSeed(food);
  if (!seed) return "";
  const name = Foodfarm.escapeHTML(seed.name || seed.id || "种子");
  const type = Foodfarm.foodTypeText(seed)
    ? ` ${Foodfarm.foodTypeHTML(seed)}`
    : "";
  const spoilText = Foodfarm.spoilLabel(seed.spoilDays);
  const spoil = spoilText
    ? ` <span>保质期：<b>${Foodfarm.escapeHTML(spoilText)}</b></span>`
    : "";
  return (
    `<div class="food-modal-block">` +
    `<div class="food-modal-label">种子</div>` +
    `<div class="food-modal-seed tag-text">${name}${type}${spoil} ${Foodfarm.foodStatesHTML(seed)}</div>` +
    `</div>`
  );
}

function paintCookPanel(expanded) {
  const panel = Foodfarm.$("food-cook-panel");
  const toggle = Foodfarm.$("food-cook-toggle");
  const arrow = Foodfarm.$("food-cook-arrow");
  if (!panel || !toggle || !arrow) return;
  panel.hidden = !expanded;
  toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
  arrow.textContent = expanded ? "▾" : "▸";
  if (!expanded) return;

  const listHost = Foodfarm.$("food-cook-list");
  const search = Foodfarm.$("food-cook-search");
  if (listHost) listHost.innerHTML = `<p class="panel-note">加载中…</p>`;
  if (search) search.value = cookSearchQuery;

  requestAnimationFrame(() => {
    queueMicrotask(() => {
      if (!activeFood) return;
      const raw = activeFood._raw || activeFood;
      cookListCache = Foodfarm.dishesForFood(activeForm === "raw" ? raw : activeFood);
      renderCookList();
    });
  });
}

function renderCookList() {
  const listHost = Foodfarm.$("food-cook-list");
  if (!listHost) return;
  const q = String(cookSearchQuery || "").trim().toLowerCase();
  const all = Array.isArray(cookListCache) ? cookListCache : [];
  const list = q
    ? all.filter(dish => String(dish.name || dish.id || "").toLowerCase().includes(q))
    : all;
  if (!all.length) {
    listHost.innerHTML = `<p class="panel-note">暂无匹配料理。</p>`;
    return;
  }
  if (!list.length) {
    listHost.innerHTML = `<p class="panel-note">没有符合搜索的料理。</p>`;
    return;
  }
  listHost.innerHTML = `<ul class="food-cook-names">${list.map(dish => {
    const name = Foodfarm.escapeHTML(dish.name || dish.id || "未命名");
    return `<li>${name}</li>`;
  }).join("")}</ul>`;
}

function openFoodModal(food, form) {
  const modal = Foodfarm.$("food-modal");
  if (!modal || !food) return;
  const mode = availableForms(food).includes(form) ? form : "raw";
  const view = displayFood(food, mode);
  activeFood = view;
  activeForm = mode;
  cookListCache = null;
  cookSearchQuery = "";

  const title = Foodfarm.$("food-modal-title");
  const stats = Foodfarm.$("food-modal-stats");
  const meta = Foodfarm.$("food-modal-meta");
  const degrees = Foodfarm.$("food-modal-degrees");
  const seed = Foodfarm.$("food-modal-seed");

  if (title) title.textContent = view.name || view.id || "食物";
  if (stats) stats.innerHTML = Foodfarm.foodStatesHTML(view);
  if (meta) {
    meta.innerHTML =
      `<span>来源：${Foodfarm.escapeHTML(Foodfarm.originLabel(view))}</span>` +
      `<span>类型：${Foodfarm.foodTypeHTML(view)}</span>` +
      `<span>形态：${Foodfarm.escapeHTML(formLabel(mode))}</span>` +
      (Foodfarm.spoilLabel(view.spoilDays)
        ? `<span>保质期：<b>${Foodfarm.escapeHTML(Foodfarm.spoilLabel(view.spoilDays))}</b></span>`
        : "") +
      (view.id ? `<span>id：${Foodfarm.escapeHTML(view.id)}</span>` : "");
  }
  if (degrees) degrees.innerHTML = Foodfarm.foodDegreesHTML(view);
  if (seed) seed.innerHTML = mode === "raw" ? seedBriefHTML(food) : "";

  Foodfarm.bindContentTags(modal);
  paintCookPanel(false);
  modal.hidden = false;
  document.body.classList.add("food-modal-open");
}

function closeFoodModal() {
  const modal = Foodfarm.$("food-modal");
  if (modal) modal.hidden = true;
  document.body.classList.remove("food-modal-open");
  activeFood = null;
  activeForm = "raw";
  cookListCache = null;
  cookSearchQuery = "";
}

function bindFoodModal() {
  const modal = Foodfarm.$("food-modal");
  const backdrop = Foodfarm.$("food-modal-backdrop");
  const closeBtn = Foodfarm.$("food-modal-close");
  const toggle = Foodfarm.$("food-cook-toggle");
  const search = Foodfarm.$("food-cook-search");

  if (backdrop) backdrop.addEventListener("click", closeFoodModal);
  if (closeBtn) closeBtn.addEventListener("click", closeFoodModal);
  if (toggle) {
    toggle.addEventListener("click", () => {
      const open = toggle.getAttribute("aria-expanded") === "true";
      paintCookPanel(!open);
    });
  }
  if (search) {
    search.addEventListener("input", () => {
      cookSearchQuery = search.value || "";
      renderCookList();
    });
  }
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    if (!modal || modal.hidden) return;
    closeFoodModal();
  });
}

function bindFoodSearch() {
  const input = Foodfarm.$("food-search");
  if (!input || input.dataset.bound === "1") return;
  input.dataset.bound = "1";
  input.addEventListener("input", () => {
    foodQuery = input.value || "";
    renderFoods();
  });
}

bindFoodSearch();
bindFoodModal();

Foodfarm.bootFoodfarm({
  onReady: renderFoods,
  onModsChange: () => {
    closeFoodModal();
    renderFoods();
  }
});
