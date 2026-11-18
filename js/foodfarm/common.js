/**
 * 烹饪「度」（锅匹配）。颜色见 css/common-tags.css、rules/foodfarmrules.html。
 * 与 FOOD_TYPES 无关：度管锅，foodtype 管谁能吃。
 */
const FOOD_DEGREES = {
  meat: { key: "meat", name: "肉度", color: "#c2185b" },
  veg: { key: "veg", name: "蔬菜度", color: "#7dce7a" },
  fruit: { key: "fruit", name: "水果度", color: "#ff9b9b" },
  fish: { key: "fish", name: "鱼度", color: "#6d93ad" },
  egg: { key: "egg", name: "蛋度", color: "#e8c4a8" },
  sweetener: { key: "sweetener", name: "甜味剂度", color: "#ffb6c1" },
  monster: { key: "monster", name: "怪物度", color: "#c084fc" },
  dairy: { key: "dairy", name: "乳制品度", color: "#cfc8b4" },
  ice: { key: "ice", name: "冰度", color: "#8ec8f0" },
  inedible: { key: "inedible", name: "不可食用度", color: "#9a9a9a" },
  magic: { key: "magic", name: "魔法度", color: "#9b6bff" },
  fat: { key: "fat", name: "油脂度", color: "#e6b85c" },
  seed: { key: "seed", name: "种子度", color: "#a3c96b" },
  decoration: { key: "decoration", name: "装饰度", color: "#d4a0c8" },
  dried: { key: "dried", name: "干货度", color: "#b08968" },
  precook: { key: "precook", name: "预处理度", color: "#7eb8a8" }
};

function normalizeDegreeKey(key) {
  if (key == null || key === "") return "";
  return String(key).trim();
}

/** 肥料：与 wormwood 的 brown / grey / lightblue 同色 */
const FERTILIZER_TAGS = {
  manure: { key: "manure", name: "粪肥", color: "#d4925a", alias: "brown" },
  compost: { key: "compost", name: "堆肥", color: "#c5c5c5", alias: "grey" },
  formula: { key: "formula", name: "催长剂", color: "#b3e5ff", alias: "lightblue" }
};

/**
 * 食用类型（谁能吃）。基础食物 / 料理共用。
 * 写法：只有一个写 foodtype；多个写 foodtype + foodtype2 + foodtype3…
 * 或 foodtype1 + foodtype2…（写了 foodtype1 就必须有 foodtype2）。
 * 与烹饪「度」无关。
 */
const FOOD_TYPES = {
  veggie: { key: "veggie", name: "素食" },
  generic: { key: "generic", name: "通用" },
  meat: { key: "meat", name: "肉" },
  elemental: { key: "elemental", name: "元素" },
  gears: { key: "gears", name: "齿轮" },
  horrible: { key: "horrible", name: "可怕" },
  insect: { key: "insect", name: "昆虫" },
  seeds: { key: "seeds", name: "种子" },
  berry: { key: "berry", name: "浆果" },
  raw: { key: "raw", name: "生的" },
  burnt: { key: "burnt", name: "烧焦的" },
  nitre: { key: "nitre", name: "硝石" },
  roughage: { key: "roughage", name: "粗食" },
  wood: { key: "wood", name: "木制" },
  goodies: { key: "goodies", name: "好东西" },
  monster: { key: "monster", name: "怪物" },
  moonshard: { key: "moonshard", name: "月亮碎片" },
  miasma: { key: "miasma", name: "瘴气" }
};

const MOD_CACHE_KEY = "foodfarm.mods";
const APP_ROOT = window.APP_ROOT || "../";

const DATA = {
  food: { items: [] },
  cook: { items: [] },
  mod: null,
  enabledTags: []
};

function $(id) {
  return document.getElementById(id);
}

function asset(path) {
  if (!path) return path;
  if (/^(?:https?:|data:|\/)/i.test(path)) return path;
  return APP_ROOT + String(path).replace(/^\.\//, "");
}

function escapeHTML(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** spoilDays：数字是天数；字符串「永久」表示不会腐烂。空值不展示。 */
function spoilLabel(value) {
  if (value == null || value === "") return "";
  const text = String(value).trim();
  if (!text) return "";
  if (text === "永久") return "永久";
  return text + " 天";
}

async function loadJson(path) {
  const res = await fetch(asset(path));
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

function isVanilla(entry) {
  return !entry || entry.origin == null || String(entry.origin).trim() === "";
}

function originLabel(entry) {
  if (isVanilla(entry)) return "原版";
  const tag = String(entry.origin || "").trim();
  const hit = modList().find(mod => modKey(mod) === tag);
  return (hit && hit.name) || tag;
}

function findFoodById(id) {
  const key = String(id || "");
  if (!key) return null;
  return foodItems().find(item => item && String(item.id) === key) || null;
}

/** seed 可以是内嵌对象，或另一条食物的 id（多种植株共用同一颗种子） */
function resolveSeed(item) {
  if (!item || item.seed == null || item.seed === "") return null;
  if (typeof item.seed === "string") return findFoodById(item.seed);
  if (typeof item.seed === "object") return item.seed;
  return null;
}

/** 种植用：共用种子的肥、水、季节写在植株自己的 grow 上 */
function plantSeed(item) {
  const seed = resolveSeed(item);
  if (!seed) return null;
  const grow = item && item.grow;
  if (!grow || typeof grow !== "object") return seed;
  return Object.assign({}, seed, grow);
}

function plantEntries() {
  return foodItems()
    .filter(item => plantSeed(item))
    .map(item => ({
      food: item,
      seed: plantSeed(item)
    }));
}

function foodDegreeMap(food) {
  const raw = food && food.degrees && typeof food.degrees === "object" ? food.degrees : {};
  const map = {};
  Object.keys(raw).forEach(key => {
    const n = Number(raw[key]);
    const norm = normalizeDegreeKey(key);
    if (!norm) return;
    map[norm] = (map[norm] || 0) + (Number.isFinite(n) ? n : 0);
  });
  return map;
}

function compareOp(left, op, right) {
  const a = Number(left);
  const b = Number(right);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  switch (String(op || ">=")) {
    case ">=": return a >= b;
    case ">": return a > b;
    case "<=": return a <= b;
    case "<": return a < b;
    case "==":
    case "=": return a === b;
    case "!=": return a !== b;
    default: return false;
  }
}

function limitEntryHitsFood(entry, food, degrees) {
  if (entry == null) return false;
  if (typeof entry === "string") {
    const s = entry.trim();
    if (!s) return false;
    if (food && (food.id === s || food.name === s)) return true;
    return Object.prototype.hasOwnProperty.call(degrees, s);
  }
  if (typeof entry !== "object") return false;
  const id = entry.id != null ? String(entry.id).trim() : "";
  const name = entry.name != null ? String(entry.name).trim() : "";
  if (food && id && food.id === id) return true;
  if (food && name && food.name === name) return true;
  const degree = normalizeDegreeKey(entry.degree);
  if (degree && Object.prototype.hasOwnProperty.call(degrees, degree) && degrees[degree] > 0) {
    return true;
  }
  return false;
}

function dishLimitsFood(dish, food) {
  const degrees = foodDegreeMap(food);
  const limits = dish && Array.isArray(dish.limit) ? dish.limit : [];
  return limits.some(entry => limitEntryHitsFood(entry, food, degrees));
}

function dishMustUseFood(dish, food) {
  if (!food || !dish) return false;
  const must = Array.isArray(dish.must) ? dish.must : [];
  return must.some(entry => {
    if (entry == null) return false;
    if (typeof entry === "string") {
      const s = entry.trim();
      return !!s && (food.id === s || food.name === s);
    }
    if (typeof entry !== "object") return false;
    const id = entry.id != null ? String(entry.id).trim() : "";
    const name = entry.name != null ? String(entry.name).trim() : "";
    return (!!id && food.id === id) || (!!name && food.name === name);
  });
}

function foodSatisfiesRequire(food, req, degrees) {
  if (!req || req.degree == null) return false;
  const key = normalizeDegreeKey(req.degree);
  const amount = Object.prototype.hasOwnProperty.call(degrees, key) ? degrees[key] : 0;
  return compareOp(amount, req.op, req.value);
}

function foodMatchesDishDegrees(food, dish) {
  const degrees = foodDegreeMap(food);
  const requires = dish && Array.isArray(dish.requires) ? dish.requires : [];
  return requires.some(req => foodSatisfiesRequire(food, req, degrees));
}

/** 食物能否作为该料理原料：非 limit，且（度命中 requires / random 填充 / must 指名） */
function foodMatchesDish(food, dish) {
  if (!food || !dish) return false;
  if (!dish.id && !dish.name) return false;
  if (dishLimitsFood(dish, food)) return false;
  if (dishMustUseFood(dish, food)) return true;
  if (dish.random === true) return true;
  if (foodMatchesDishDegrees(food, dish)) return true;
  return false;
}

function dishesForFood(food) {
  if (!food) return [];
  return cookItems().filter(dish => foodMatchesDish(food, dish));
}

function foodStatesHTML(entry) {
  if (!window.CommonTags || !entry) return "";
  const val = n => {
    if (n == null || n === "") return "<b>0</b>";
    return "<b>" + escapeHTML(String(n)) + "</b>";
  };
  return CommonTags.statesHTML([
    { kind: "health", valueHTML: val(entry.health) },
    { kind: "hunger", valueHTML: val(entry.hunger) },
    { kind: "sanity", valueHTML: val(entry.sanity) }
  ]);
}

function degreeLabel(key) {
  const norm = normalizeDegreeKey(key);
  const conf = FOOD_DEGREES[norm];
  return (conf && conf.name) || String(key == null ? "" : key);
}

function foodTypeLabel(key) {
  if (key == null || key === "") return "";
  const conf = FOOD_TYPES[String(key)];
  return (conf && conf.name) || String(key);
}

/**
 * 收集食用类型键：foodtype / foodtype2… 或 foodtype1 / foodtype2…
 * 遇到空档停止。写了 foodtype1 却没有 foodtype2 时只返回空（无效写法）。
 */
function foodTypeKeys(entry) {
  if (!entry || typeof entry !== "object") return [];
  const out = [];
  const push = v => {
    if (v == null) return false;
    const s = String(v).trim();
    if (!s) return false;
    out.push(s);
    return true;
  };

  const has1 = entry.foodtype1 != null && String(entry.foodtype1).trim() !== "";
  if (has1) {
    const has2 = entry.foodtype2 != null && String(entry.foodtype2).trim() !== "";
    if (!has2) return [];
    push(entry.foodtype1);
    for (let i = 2; i <= 16; i++) {
      if (!push(entry["foodtype" + i])) break;
    }
    return out;
  }

  push(entry.foodtype);
  for (let i = 2; i <= 16; i++) {
    if (!push(entry["foodtype" + i])) break;
  }
  return out;
}

/** 展示例如「素食」或「肉 / 怪物」 */
function foodTypeText(entry) {
  return foodTypeKeys(entry).map(foodTypeLabel).filter(Boolean).join(" / ");
}

function foodTypeHTML(entry) {
  const text = foodTypeText(entry);
  if (!text) return `<span class="muted">未标注食用类型</span>`;
  return `<span class="food-type-chip">${escapeHTML(text)}</span>`;
}

function foodDegreesHTML(food) {
  const degrees = foodDegreeMap(food);
  const keys = Object.keys(degrees).filter(k => degrees[k] !== 0);
  if (!keys.length) return `<span class="muted">无烹饪度</span>`;
  return keys.map(key => {
    const tag = FOOD_DEGREES[key] ? key : null;
    const label = escapeHTML(degreeLabel(key));
    const labeled = tag ? `<${tag}>${label}</${tag}>` : label;
    return `<span class="degree-chip"><b>${escapeHTML(String(degrees[key]))}</b> ${labeled}</span>`;
  }).join("");
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

function renderModList(onChange) {
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
      renderModList(onChange);
      await reloadEnabledData();
      if (typeof onChange === "function") onChange();
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

function bindContentTags(root) {
  if (!window.CommonTags || !root) return;
  CommonTags.bind(root, {});
}

function setOverviewOpen(open) {
  const wrap = $("page-overview");
  const panel = $("page-overview-panel");
  const btn = $("page-overview-btn");
  if (!wrap || !panel || !btn || wrap.hidden) return;
  panel.hidden = !open;
  wrap.classList.toggle("is-open", !!open);
  btn.setAttribute("aria-expanded", open ? "true" : "false");
}

/** 右下角「概述」圆圈：与角色页 char-notice 同交互，文案写在页面 HTML 里 */
function bindPageOverview() {
  const wrap = $("page-overview");
  const panel = $("page-overview-panel");
  const btn = $("page-overview-btn");
  const body = $("page-overview-body");
  if (!wrap || !panel || !btn) return;
  if (body) bindContentTags(body);
  setOverviewOpen(false);
  if (btn.dataset.bound === "1") return;
  btn.dataset.bound = "1";
  btn.addEventListener("click", e => {
    e.stopPropagation();
    setOverviewOpen(panel.hidden);
  });
  document.addEventListener("click", e => {
    if (!wrap || wrap.hidden || wrap.contains(e.target)) return;
    setOverviewOpen(false);
  });
}

async function bootFoodfarm(options) {
  const opts = options || {};
  bindModDrawer();
  paintModHandle(false);
  bindPageOverview();
  if (window.CommonTags) {
    CommonTags.installNoticeTips({
      tipId: "notice-tip",
      bindOptions: {}
    });
  }
  try {
    DATA.mod = await loadJson("data/farmmings/mod_config.json");
    DATA.enabledTags = normalizeEnabledTags(readCachedTags() || defaultEnabledTags());
    writeCachedTags(DATA.enabledTags);
    renderModList(opts.onModsChange);
    if (opts.loadData !== false) await reloadEnabledData();
    if (typeof opts.onReady === "function") opts.onReady();
  } catch (err) {
    console.error(err);
    const host = $("mod-list");
    if (host) host.innerHTML = `<span class="panel-note">模组配置加载失败</span>`;
  }
}

window.Foodfarm = {
  FOOD_DEGREES,
  FERTILIZER_TAGS,
  FOOD_TYPES,
  normalizeDegreeKey,
  DATA,
  $,
  asset,
  escapeHTML,
  spoilLabel,
  foodItems,
  cookItems,
  modList,
  plantEntries,
  findFoodById,
  resolveSeed,
  plantSeed,
  isVanilla,
  originLabel,
  foodDegreeMap,
  foodMatchesDish,
  dishesForFood,
  foodStatesHTML,
  foodDegreesHTML,
  degreeLabel,
  foodTypeLabel,
  foodTypeKeys,
  foodTypeText,
  foodTypeHTML,
  bindContentTags,
  bootFoodfarm,
  reloadEnabledData
};
