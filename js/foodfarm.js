/** 食材「度」定义：后面写到再补 */
const FOOD_DEGREES = {
  meat: { key: "meat", name: "肉度" },
  veg: { key: "veg", name: "菜度" },
  fruit: { key: "fruit", name: "水果度" },
  fish: { key: "fish", name: "鱼度" },
  egg: { key: "egg", name: "蛋度" },
  sweetener: { key: "sweetener", name: "甜味剂度" },
  monster: { key: "monster", name: "怪物度" },
  dairy: { key: "dairy", name: "乳制品度" },
  ice: { key: "ice", name: "冰度" },
  inedible: { key: "inedible", name: "不可食用度" }
};

const MOD_CACHE_KEY = "foodfarm.mods";

const DATA = {
  food: { items: [] },
  cook: { items: [] },
  mod: null,
  enabledTags: []
};

function $(id) {
  return document.getElementById(id);
}

function escapeHTML(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function loadJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(path + " " + res.status);
  const text = await res.text();
  if (!String(text || "").trim()) return {};
  return JSON.parse(text);
}

function foodItems() {
  return Array.isArray(DATA.food && DATA.food.items) ? DATA.food.items : [];
}

function cookItems() {
  return Array.isArray(DATA.cook && DATA.cook.items) ? DATA.cook.items : [];
}

function modList() {
  const block = DATA.mod;
  if (!block) return [];
  return Array.isArray(block.mods) ? block.mods : [];
}

function modKey(mod) {
  return mod && mod.tag != null ? String(mod.tag) : "";
}

/** origin 空 / 不填 = 原版 */
function isVanilla(entry) {
  return !entry || entry.origin == null || String(entry.origin).trim() === "";
}

function originLabel(entry) {
  if (isVanilla(entry)) return "原版";
  const tag = String(entry.origin || "").trim();
  const hit = modList().find(mod => modKey(mod) === tag);
  return (hit && hit.name) || tag;
}

/** 种植篇：仅带 seed 的条目（非种植来源不写 seed）。肥料看 seed.fertilizer，水等总述另写 */
function plantEntries() {
  return foodItems()
    .filter(item => item && item.seed)
    .map(item => ({
      food: item,
      seed: item.seed
    }));
}

function readCachedTags() {
  try {
    const raw = localStorage.getItem(MOD_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : null;
  } catch (err) {
    return null;
  }
}

function writeCachedTags(tags) {
  localStorage.setItem(MOD_CACHE_KEY, JSON.stringify(tags.map(String)));
}

function defaultEnabledTags() {
  const mods = modList();
  const vanilla = mods.find(mod => modKey(mod) === "");
  if (vanilla) return [""];
  return mods[0] ? [modKey(mods[0])] : [];
}

function normalizeEnabledTags(tags) {
  const allowed = new Set(modList().map(modKey));
  const next = [];
  (tags || []).forEach(tag => {
    const key = String(tag);
    if (!allowed.has(key) || next.includes(key)) return;
    next.push(key);
  });
  if (!next.length) return defaultEnabledTags();
  return next;
}

function showPanel(id) {
  document.querySelectorAll(".tab").forEach(tab => {
    const on = tab.dataset.panel === id;
    tab.classList.toggle("is-active", on);
    tab.setAttribute("aria-selected", on ? "true" : "false");
  });
  document.querySelectorAll(".panel").forEach(panel => {
    const on = panel.dataset.panel === id;
    panel.classList.toggle("is-active", on);
    panel.hidden = !on;
  });
}

function bindTabs() {
  document.querySelectorAll(".tab").forEach(tab => {
    tab.addEventListener("click", () => showPanel(tab.dataset.panel));
  });
}

function paintModHandle(open) {
  const handle = $("mod-drawer-handle");
  const arrow = $("mod-drawer-arrow");
  if (handle) handle.setAttribute("aria-expanded", open ? "true" : "false");
  if (arrow) arrow.textContent = open ? "<" : ">";
}

function setModDrawerOpen(open) {
  const drawer = $("mod-drawer");
  if (!drawer) return;
  drawer.classList.toggle("is-open", !!open);
  paintModHandle(!!open);
}

function bindModDrawer() {
  const handle = $("mod-drawer-handle");
  if (!handle) return;
  handle.addEventListener("click", () => {
    const drawer = $("mod-drawer");
    setModDrawerOpen(!(drawer && drawer.classList.contains("is-open")));
  });
}

function renderModList() {
  const host = $("mod-list");
  if (!host) return;
  const enabled = new Set(DATA.enabledTags.map(String));
  host.innerHTML = modList().map(mod => {
    const tag = modKey(mod);
    const name = (mod && mod.name) || tag || "原版";
    const checked = enabled.has(tag) ? " checked" : "";
    return `<label class="mod-check"><input type="checkbox" data-mod-tag="${escapeHTML(tag)}"${checked}><span>${escapeHTML(name)}</span></label>`;
  }).join("");
  host.querySelectorAll("input[data-mod-tag]").forEach(input => {
    input.addEventListener("change", async () => {
      const tags = [...host.querySelectorAll("input[data-mod-tag]:checked")].map(el => el.dataset.modTag || "");
      DATA.enabledTags = normalizeEnabledTags(tags.length ? tags : defaultEnabledTags());
      writeCachedTags(DATA.enabledTags);
      renderModList();
      await reloadEnabledData();
      renderStub();
    });
  });
}

function mergeItems(blocks) {
  const items = [];
  blocks.forEach(block => {
    const list = block && Array.isArray(block.items) ? block.items : [];
    list.forEach(item => items.push(item));
  });
  return { items };
}

async function reloadEnabledData() {
  const mods = modList().filter(mod => DATA.enabledTags.includes(modKey(mod)));
  const basicPaths = mods.map(mod => mod.basic).filter(Boolean);
  const advancedPaths = mods.map(mod => mod.advanced).filter(Boolean);
  const [basicBlocks, advancedBlocks] = await Promise.all([
    Promise.all(basicPaths.map(path => loadJson(path).catch(() => ({ items: [] })))),
    Promise.all(advancedPaths.map(path => loadJson(path).catch(() => ({ items: [] }))))
  ]);
  DATA.food = mergeItems(basicBlocks);
  DATA.cook = mergeItems(advancedBlocks);
}

function renderStub() {
  const plant = $("plant-body");
  const cook = $("cook-body");
  const food = $("food-body");
  if (plant) {
    const n = plantEntries().length;
    plant.innerHTML = n
      ? `<p class="panel-note">已载入可种植条目 <b>${n}</b> 个（种子写在 basic_food 的 seed 字段）。肥料计算稍后接。</p>`
      : `<p class="panel-note">暂无可种植条目。</p>`;
  }
  if (cook) {
    const n = cookItems().length;
    cook.innerHTML = n
      ? `<p class="panel-note">已载入料理 <b>${n}</b> 道。烹饪查询 / 补齐稍后接。</p>`
      : `<p class="panel-note">暂无料理数据。</p>`;
  }
  if (food) {
    const n = foodItems().length;
    food.innerHTML = n
      ? `<p class="panel-note">已载入基础食物 <b>${n}</b> 种。图鉴展示稍后接。</p>`
      : `<p class="panel-note">暂无基础食物数据。</p>`;
  }
}

async function boot() {
  bindTabs();
  bindModDrawer();
  showPanel("plant");
  paintModHandle(false);
  try {
    DATA.mod = await loadJson("data/farmmings/mod_config.json");
    DATA.enabledTags = normalizeEnabledTags(readCachedTags() || defaultEnabledTags());
    writeCachedTags(DATA.enabledTags);
    renderModList();
    await reloadEnabledData();
    renderStub();
  } catch (err) {
    console.error(err);
    const host = $("mod-list");
    if (host) host.innerHTML = `<span class="panel-note">模组配置加载失败</span>`;
  }
}

boot();
