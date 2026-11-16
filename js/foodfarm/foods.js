let activeFood = null;
let cookListCache = null;
let cookSearchQuery = "";

function foodCardHTML(food) {
  const name = Foodfarm.escapeHTML(food.name || food.id || "未命名");
  const id = Foodfarm.escapeHTML(food.id || "");
  return (
    `<button type="button" class="food-card" data-food-id="${id}">` +
    `<div class="food-card-name">${name}</div>` +
    `<div class="food-card-stats tag-text">${Foodfarm.foodStatesHTML(food)}</div>` +
    `</button>`
  );
}

function renderFoods() {
  const host = Foodfarm.$("food-body");
  if (!host) return;
  const items = Foodfarm.foodItems().filter(item => item && (item.id || item.name) && !item.hide);
  if (!items.length) {
    host.innerHTML = `<p class="panel-note">暂无食物数据。</p>`;
    Foodfarm.bindContentTags(host);
    return;
  }
  host.innerHTML = `<div class="food-grid">${items.map(foodCardHTML).join("")}</div>`;
  Foodfarm.bindContentTags(host);
  host.querySelectorAll(".food-card").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-food-id");
      const food = items.find(item => String(item.id) === id) || null;
      openFoodModal(food);
    });
  });
}

function seedBriefHTML(food) {
  if (!food || !food.seed) return "";
  const seed = food.seed;
  const name = Foodfarm.escapeHTML(seed.name || seed.id || "种子");
  return (
    `<div class="food-modal-block">` +
    `<div class="food-modal-label">种子</div>` +
    `<div class="food-modal-seed tag-text">${name} ${Foodfarm.foodStatesHTML(seed)}</div>` +
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
      cookListCache = Foodfarm.dishesForFood(activeFood);
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

function openFoodModal(food) {
  const modal = Foodfarm.$("food-modal");
  if (!modal || !food) return;
  activeFood = food;
  cookListCache = null;
  cookSearchQuery = "";

  const title = Foodfarm.$("food-modal-title");
  const stats = Foodfarm.$("food-modal-stats");
  const meta = Foodfarm.$("food-modal-meta");
  const degrees = Foodfarm.$("food-modal-degrees");
  const seed = Foodfarm.$("food-modal-seed");

  if (title) title.textContent = food.name || food.id || "食物";
  if (stats) stats.innerHTML = Foodfarm.foodStatesHTML(food);
  if (meta) {
    meta.innerHTML =
      `<span>来源：${Foodfarm.escapeHTML(Foodfarm.originLabel(food))}</span>` +
      (food.id ? `<span>id：${Foodfarm.escapeHTML(food.id)}</span>` : "");
  }
  if (degrees) degrees.innerHTML = Foodfarm.foodDegreesHTML(food);
  if (seed) seed.innerHTML = seedBriefHTML(food);

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

bindFoodModal();

Foodfarm.bootFoodfarm({
  onReady: renderFoods,
  onModsChange: () => {
    closeFoodModal();
    renderFoods();
  }
});
