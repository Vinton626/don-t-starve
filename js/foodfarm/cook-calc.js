/**
 * 烹饪锅判定：对齐 DST cooking.lua
 * 1) 汇总 4 格食材的度（tags）与指名计数（names）
 * 2) 用 requires / must / limit 筛出全部匹配料理
 * 3) 按 priority 从高到低，只保留最高优先级那一组（同优先级并列；游戏内再按 weight 随机）
 *
 * 用法：
 *   CookCalc.cook(slots, Foodfarm.cookItems())
 *   CookCalc.filterWanted(dishes, { heal: true })
 *   CookCalc.sampleFill(dish, Foodfarm.foodItems())
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.CookCalc = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  const SLOTS = 4;
  const DEGREE_KEYS = [
    "meat", "veg", "fruit", "fish", "egg",
    "sweetener", "monster", "dairy", "ice", "inedible",
    "magic", "fat", "seed", "decoration", "dried", "precook"
  ];

  /** 筛选条件；回生命/扣生命、回理智/扣理智在 UI 里互斥。原版无稳定「扣饥饿」料理，故不收录 hungerDown */
  const WANT = {
    heal: { key: "heal", name: "回生命值料理", test: d => num(d.health) > 10 },
    sanityUp: { key: "sanityUp", name: "回理智值料理", test: d => num(d.sanity) > 10 },
    healthDown: { key: "healthDown", name: "扣生命值料理", test: d => num(d.health) < 0 },
    sanityDown: { key: "sanityDown", name: "扣理智值料理", test: d => num(d.sanity) < 0 },
    special: {
      key: "special",
      name: "特殊效果料理",
      test: d => {
        const e = String(d.effect == null ? "" : d.effect).trim();
        return e && e !== "无特殊效果" && e !== "无";
      }
    }
  };

  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
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

  function foodKey(food) {
    if (!food) return "";
    if (food.id != null && String(food.id).trim()) return String(food.id).trim();
    if (food.name != null && String(food.name).trim()) return String(food.name).trim();
    return "";
  }

  function foodDegrees(food) {
    const raw = food && food.degrees && typeof food.degrees === "object" ? food.degrees : {};
    const out = {};
    Object.keys(raw).forEach(key => {
      const deg = normalizeDegreeKey(key);
      if (!deg) return;
      out[deg] = (out[deg] || 0) + num(raw[key]);
    });
    DEGREE_KEYS.forEach(key => {
      if (out[key] == null) out[key] = 0;
    });
    return out;
  }

  /** 基础食物 → 锅内一格食材；无 id/name 返回 null */
  function ingredientFromFood(food) {
    if (!food) return null;
    const id = food.id != null ? String(food.id).trim() : "";
    const name = food.name != null ? String(food.name).trim() : "";
    if (!id && !name) return null;
    return {
      id: id || name,
      name: name || id,
      health: food.health,
      hunger: food.hunger,
      sanity: food.sanity,
      degrees: foodDegrees(food),
      effect: food.effect || "",
      origin: food.origin || ""
    };
  }

  /**
   * 汇总格内食材。slots 长度 0–4，空位忽略。
   * 返回 { tags, names, count, filled, degrees }
   * names 同时用 id 与 name 计数，方便 must 用中文名匹配
   */
  function aggregate(slots) {
    const list = (Array.isArray(slots) ? slots : []).filter(Boolean).slice(0, SLOTS);
    const tags = {};
    const names = {};
    list.forEach(item => {
      const ing = item.degrees != null ? item : ingredientFromFood(item);
      if (!ing) return;
      Object.keys(ing.degrees || {}).forEach(key => {
        const deg = normalizeDegreeKey(key);
        if (!deg) return;
        tags[deg] = (tags[deg] || 0) + num(ing.degrees[key]);
      });
      const id = String(ing.id || "").trim();
      const name = String(ing.name || "").trim();
      if (id) names[id] = (names[id] || 0) + 1;
      if (name && name !== id) names[name] = (names[name] || 0) + 1;
    });
    const degrees = {};
    Object.keys(tags).forEach(key => {
      if (tags[key]) degrees[key] = tags[key];
    });
    return { tags, names, degrees, count: list.length, filled: list.length >= SLOTS, slots: list };
  }

  function limitHits(entry, names, tags) {
    if (entry == null) return false;
    if (typeof entry === "string") {
      const s = entry.trim();
      if (!s) return false;
      if ((names[s] || 0) > 0) return true;
      return (tags[s] || 0) > 0;
    }
    if (typeof entry !== "object") return false;
    const id = entry.id != null ? String(entry.id).trim() : "";
    const name = entry.name != null ? String(entry.name).trim() : "";
    if (id && (names[id] || 0) > 0) return true;
    if (name && (names[name] || 0) > 0) return true;
    const degree = normalizeDegreeKey(entry.degree);
    if (degree && (tags[degree] || 0) > 0) return true;
    return false;
  }

  let foodCatalog = [];

  function useFoods(foods) {
    foodCatalog = Array.isArray(foods) ? foods : [];
  }

  function parseFormTags(name) {
    let text = String(name || "").trim();
    let cooked = false;
    let dried = false;
    for (let i = 0; i < 4; i++) {
      const matched = text.match(/^<(烤|晾)>\s*/);
      if (!matched) break;
      if (matched[1] === "烤") cooked = true;
      else dried = true;
      text = text.slice(matched[0].length).trim();
    }
    return { cooked, dried, base: text };
  }

  /** <烤><晾>大肉：生 id，再加上 cooked.id、dried.id。只按 id 计数，避免名字和 id 算两遍。 */
  function mustIdSet(needName) {
    const spec = parseFormTags(needName);
    const ids = new Set();
    if (!spec.base) return { spec, ids };
    foodCatalog.forEach(food => {
      if (!food) return;
      if (food.name !== spec.base && String(food.id || "") !== spec.base) return;
      if (food.id != null && String(food.id).trim()) ids.add(String(food.id).trim());
      if (spec.cooked && food.cooked && food.cooked.id != null && String(food.cooked.id).trim()) {
        ids.add(String(food.cooked.id).trim());
      }
      if (spec.dried && food.dried && food.dried.id != null && String(food.dried.id).trim()) {
        ids.add(String(food.dried.id).trim());
      }
    });
    return { spec, ids };
  }

  function nameCount(names, needName) {
    const key = String(needName || "").trim();
    if (!key) return 0;
    const found = mustIdSet(key);
    if (!found.ids.size) return names[found.spec.base] || names[key] || 0;
    let have = 0;
    found.ids.forEach(id => { have += names[id] || 0; });
    return have;
  }

  function mustNeedName(entry) {
    if (typeof entry === "string") return entry.trim();
    if (!entry || typeof entry !== "object") return "";
    return String(entry.name || entry.id || "").trim();
  }

  function resolveMustEntry(entry, names, canFill) {
    if (entry && Array.isArray(entry.or)) {
      if (entry.or.some(part => mustSatisfied(part, names))) return null;
      return entry.or.find(part => canFill(part)) || entry.or[0] || null;
    }
    return entry;
  }

  function formForMust(needName) {
    const spec = parseFormTags(needName);
    if (spec.cooked && !spec.dried) return "cooked";
    if (spec.dried && !spec.cooked) return "dried";
    return "raw";
  }

  function shapeForMust(ing, needName) {
    if (!ing) return ing;
    const form = formForMust(needName);
    if (form === "raw") return ing;
    const base = foodCatalog.find(food =>
      String(food.id || "") === String(ing.id || "") || food.name === ing.name
    );
    const variant = base && base[form];
    if (!variant || typeof variant !== "object") return ing;
    const made = ingredientFromFood(Object.assign({}, base, variant));
    if (!made) return ing;
    made.form = form;
    made.baseId = base.id != null ? String(base.id).trim() : String(ing.id || "");
    return made;
  }

  function ingredientMatchesMust(ing, needName) {
    if (!ing || !needName) return false;
    const found = mustIdSet(needName);
    const id = ing.id != null ? String(ing.id).trim() : "";
    if (id && found.ids.has(id)) return true;
    if (!found.ids.size) return ing.name === found.spec.base || id === found.spec.base;
    return false;
  }

  function mustSatisfied(entry, names) {
    if (entry == null) return false;
    if (typeof entry === "string") {
      const s = entry.trim();
      return !!s && nameCount(names, s) >= 1;
    }
    if (typeof entry !== "object") return false;
    if (Array.isArray(entry.or)) return entry.or.some(part => mustSatisfied(part, names));
    const id = entry.id != null ? String(entry.id).trim() : "";
    const name = entry.name != null ? String(entry.name).trim() : "";
    const need = entry.value == null ? 1 : num(entry.value);
    const op = entry.op || ">=";
    let have = 0;
    if (id) have = Math.max(have, names[id] || 0);
    if (name) have = Math.max(have, nameCount(names, name));
    return compareOp(have, op, need);
  }

  function normalizeDegreeKey(key) {
    if (typeof window !== "undefined" && window.Foodfarm && typeof window.Foodfarm.normalizeDegreeKey === "function") {
      return window.Foodfarm.normalizeDegreeKey(key);
    }
    return key == null ? "" : String(key).trim();
  }

  function isUpperBoundOp(op) {
    const s = String(op || ">=");
    return s === "<" || s === "<=";
  }

  /**
   * requires 判定。支持 {"or":[...]}，任一分支满足即可。
   * `<` / `<=` 隐含「该度必须 > 0」：
   *   <= N  ⇒  0 < have <= N
   *   <  N  ⇒  0 < have <  N
   */
  function requireSatisfied(req, tags) {
    if (!req) return false;
    if (Array.isArray(req.or)) return req.or.some(part => requireSatisfied(part, tags));
    if (req.degree == null) return false;
    const key = normalizeDegreeKey(req.degree);
    const have = tags[key] || 0;
    const op = String(req.op || ">=");
    if (isUpperBoundOp(op) && !(have > 0)) return false;
    return compareOp(have, op, req.value);
  }

  /** 往该度再加 add 后是否仍不破上界（下界要求始终允许加） */
  function requireAllowsAdd(req, tags, addAmount) {
    if (!req) return false;
    if (Array.isArray(req.or)) {
      return req.or.some(part => requireAllowsAdd(part, tags, addAmount));
    }
    if (req.degree == null) return false;
    const key = normalizeDegreeKey(req.degree);
    const next = (tags[key] || 0) + num(addAmount);
    const op = String(req.op || ">=");
    if (!isUpperBoundOp(op)) return num(addAmount) > 0;
    return compareOp(next, op, req.value);
  }

  /** 未满锅预览：该要求是否已被当前度永久打破（or 要每个分支都打破才算） */
  function requirePreviewBroken(req, tags) {
    if (!req) return false;
    if (Array.isArray(req.or)) return req.or.every(part => requirePreviewBroken(part, tags));
    if (req.degree == null) return false;
    const key = normalizeDegreeKey(req.degree);
    const have = tags[key] || 0;
    const op = String(req.op || ">=");
    if (isUpperBoundOp(op) && have > 0 && !compareOp(have, op, req.value)) return true;
    if ((op === "==" || op === "=") && have > num(req.value)) return true;
    return false;
  }

  /** 补格时解析 requires：or 已满足则跳过，否则挑一条还能补的分支 */
  function resolveRequireEntry(req, tags, canFill) {
    if (req && Array.isArray(req.or)) {
      if (req.or.some(part => requireSatisfied(part, tags))) return null;
      return req.or.find(part => canFill(part)) || req.or[0] || null;
    }
    return req;
  }

  function requireCanFill(req, foodsOfDegreeFn) {
    if (!req || req.degree == null) return false;
    const op = String(req.op || ">=");
    if (op !== ">" && op !== ">=" && op !== "==" && op !== "=" && !isUpperBoundOp(op)) return false;
    const key = normalizeDegreeKey(req.degree);
    return !!(foodsOfDegreeFn && foodsOfDegreeFn(key).length);
  }

  /** 碟级约束：列出的生食材名里至少有一种数量 ≥ 1（用来排除「两项都烤」） */
  function atLeastOneRawList(dish) {
    return (Array.isArray(dish && dish.atLeastOneRaw) ? dish.atLeastOneRaw : [])
      .map(name => String(name == null ? "" : name).trim())
      .filter(Boolean);
  }

  function atLeastOneRawSatisfied(dish, names) {
    const list = atLeastOneRawList(dish);
    if (!list.length) return true;
    return list.some(name => nameCount(names, name) >= 1);
  }

  /** 补格时：若 atLeastOneRaw 尚未满足，且本条 must 的基底在名单里，则强制放生的 */
  function shouldForceRawMust(dish, needName, names) {
    const list = atLeastOneRawList(dish);
    if (!list.length || atLeastOneRawSatisfied(dish, names)) return false;
    const base = parseFormTags(needName).base;
    return !!base && list.indexOf(base) >= 0;
  }

  /** 单道料理是否匹配当前 names/tags（不看槽位是否满 4） */
  function dishMatches(dish, names, tags) {
    if (!dish || (!dish.id && !dish.name)) return false;
    const limits = Array.isArray(dish.limit) ? dish.limit : [];
    if (limits.some(entry => limitHits(entry, names, tags))) return false;
    const must = Array.isArray(dish.must) ? dish.must : [];
    if (must.some(entry => !mustSatisfied(entry, names))) return false;
    if (!atLeastOneRawSatisfied(dish, names)) return false;
    const requires = Array.isArray(dish.requires) ? dish.requires : [];
    if (requires.some(req => !requireSatisfied(req, tags))) return false;
    return true;
  }

  function priorityOf(dish) {
    return num(dish && dish.priority);
  }

  function weightOf(dish) {
    const w = num(dish && dish.weight);
    return w > 0 ? w : 1;
  }

  /** 保底料理（潮湿黏糊）：不参与正常匹配，仅在没有其它料理时产出 */
  function isFallbackDish(dish) {
    if (!dish) return false;
    if (dish.fallback === true) return true;
    return String(dish.id || "") === "stickygoo";
  }

  function findFallbackDish(dishes) {
    const list = Array.isArray(dishes) ? dishes : [];
    return list.find(isFallbackDish) || null;
  }

  /**
   * 从匹配列表中取出最高优先级一组（DST GetCandidateRecipes）
   */
  function topPriorityGroup(matched) {
    if (!matched.length) return [];
    const sorted = matched.slice().sort((a, b) => priorityOf(b) - priorityOf(a));
    const top = priorityOf(sorted[0]);
    return sorted.filter(d => priorityOf(d) === top);
  }

  function cookResult(agg, matching, candidates, reason) {
    const totalWeight = candidates.reduce((sum, d) => sum + weightOf(d), 0);
    const wetGoop = reason === "fallback";
    return {
      ok: true,
      reason,
      message: wetGoop
        ? "保底产出：" + (candidates[0].name || candidates[0].id || "潮湿黏糊")
        : (candidates.length === 1
          ? "确定产出：" + (candidates[0].name || candidates[0].id)
          : "同优先级并列 " + candidates.length + " 道，游戏内按权重随机"),
      aggregate: agg,
      matching: matching.slice().sort((a, b) => priorityOf(b) - priorityOf(a)),
      candidates,
      result: candidates.length === 1 ? candidates[0] : null,
      totalWeight,
      chances: candidates.map(d => ({
        dish: d,
        weight: weightOf(d),
        chance: totalWeight > 0 ? weightOf(d) / totalWeight : 0
      })),
      wetGoop
    };
  }

  /**
   * slots: 0–4 个 ingredientFromFood / 基础食物
   * dishes: advanced_food.items
   *
   * 返回：
   *   aggregate  度汇总
   *   matching   全部匹配（含低优先级，给「可能产生」列表用；仅 filled 时有意义）
   *   candidates 最高优先级一组（真正会出锅的候选）
   *   result     唯一候选时直接给出；并列时为 null，看 candidates
   *   wetGoop    满 4 格且落到保底料理（潮湿黏糊）
   */
  function cook(slots, dishes) {
    const agg = aggregate(slots);
    const list = Array.isArray(dishes) ? dishes : [];
    if (!agg.filled) {
      return {
        ok: false,
        reason: "incomplete",
        message: "请放入 " + SLOTS + " 格食材（已放 " + agg.count + "）",
        aggregate: agg,
        matching: [],
        candidates: [],
        result: null,
        chances: [],
        wetGoop: false
      };
    }

    const matching = list.filter(d => !isFallbackDish(d) && dishMatches(d, agg.names, agg.tags));
    const candidates = topPriorityGroup(matching);
    if (candidates.length) {
      return cookResult(agg, matching, candidates, candidates.length === 1 ? "unique" : "tie");
    }

    const fallback = findFallbackDish(list);
    if (fallback) {
      return cookResult(agg, [fallback], [fallback], "fallback");
    }

    return {
      ok: false,
      reason: "wetgoop",
      message: "潮湿黏糊：当前配方没有对应料理",
      aggregate: agg,
      matching: [],
      candidates: [],
      result: null,
      chances: [],
      wetGoop: true
    };
  }

  /** 未满 4 格时：哪些料理「目前条件尚未被打破」，供预览（must/requires 已满足的部分 + 未踩 limit） */
  function previewPossible(slots, dishes) {
    const agg = aggregate(slots);
    const list = Array.isArray(dishes) ? dishes : [];
    const playable = list.filter(d => !isFallbackDish(d));
    if (!agg.count) return { aggregate: agg, dishes: playable.slice() };
    if (agg.filled) {
      const r = cook(slots, dishes);
      // 保底结果时列表里也只展示潮湿黏糊
      return { aggregate: agg, dishes: r.matching };
    }

    // 未满锅：limit 已踩中的排除；must/requires 只检查「已有量是否已超过失败」——
    // 宽松预览：当前 tags/names 不违反 limit，且已有 must 计数不超过需求失败的反向（即已放入的指名不冲突）
    // 保底料理不进预览，避免每锅都挂着潮湿黏糊
    const loose = playable.filter(dish => {
      const limits = Array.isArray(dish.limit) ? dish.limit : [];
      if (limits.some(entry => limitHits(entry, agg.names, agg.tags))) return false;
      // 已放入的度若某 requires 用 < / <= 且已经超标，则不可能；度为 0 仍可后续补上（隐含 >0 不在此提前排除）
      const requires = Array.isArray(dish.requires) ? dish.requires : [];
      if (requires.some(req => requirePreviewBroken(req, agg.tags))) return false;
      return true;
    });
    return {
      aggregate: agg,
      dishes: loose.slice().sort((a, b) => priorityOf(b) - priorityOf(a))
    };
  }

  /**
   * 筛选条件过滤。wantKeys 为 WANT 的 key 数组；多选为且（同时满足）。
   * 自定义阈值：options.healMin 默认 10，options.sanityMin 默认 10
   */
  function filterWanted(dishes, wantKeys, options) {
    const opts = options || {};
    const healMin = opts.healMin == null ? 10 : num(opts.healMin);
    const sanityMin = opts.sanityMin == null ? 10 : num(opts.sanityMin);
    const keys = Array.isArray(wantKeys) ? wantKeys : [];
    if (!keys.length) return Array.isArray(dishes) ? dishes.slice() : [];

    const tests = {
      heal: d => num(d.health) > healMin,
      sanityUp: d => num(d.sanity) > sanityMin,
      healthDown: d => num(d.health) < 0,
      sanityDown: d => num(d.sanity) < 0,
      special: WANT.special.test
    };

    return (Array.isArray(dishes) ? dishes : []).filter(dish =>
      keys.every(key => typeof tests[key] === "function" && tests[key](dish))
    );
  }

  /** 只有一种度（且该度 > 0）的食材，适合做举例/填充 */
  function isPureDegree(ing) {
    if (!ing || !ing.degrees) return false;
    const keys = Object.keys(ing.degrees).filter(k => num(ing.degrees[k]) > 0);
    return keys.length === 1;
  }

  function pureDegreeKey(ing) {
    if (!isPureDegree(ing)) return "";
    return Object.keys(ing.degrees).find(k => num(ing.degrees[k]) > 0) || "";
  }

  /** 每种度取清单里第一个「纯单度」食材 */
  function puresByDegree(pool) {
    const map = {};
    pool.forEach(ing => {
      const key = pureDegreeKey(ing);
      if (!key) return;
      if (!map[key]) map[key] = [];
      map[key].push(ing);
    });
    return map;
  }

  function dishIdOf(dish) {
    if (!dish) return "";
    if (dish.id != null && String(dish.id).trim()) return String(dish.id).trim();
    return String(dish.name || "").trim();
  }

  function slotsMakeDish(slots, dish, allDishes) {
    const list = Array.isArray(allDishes) && allDishes.length ? allDishes : [dish];
    const check = cook(slots, list);
    if (!check.ok) return false;
    return check.candidates.some(d => dishIdOf(d) === dishIdOf(dish));
  }

  /**
   * 在已有格子上补料，不替换已放入的食材。
   * 必用、度要求都在符合条件的食材里随机挑。
   * 都满足后，随机选一种不在 limit 里、优先锅里还没有的度，再用该度的食材随机填满空格。
   */
  function supplementFill(dish, existing, foods) {
    const slots = [null, null, null, null];
    (Array.isArray(existing) ? existing : []).slice(0, SLOTS).forEach((item, i) => {
      slots[i] = item || null;
    });
    if (!dish) return { slots };
    const pool = (Array.isArray(foods) ? foods : []).map(ingredientFromFood).filter(Boolean);
    const pureGroups = puresByDegree(pool);
    const limits = Array.isArray(dish.limit) ? dish.limit : [];
    const limitedDegrees = {};
    limits.forEach(entry => {
      const raw = typeof entry === "string" ? entry : (entry && entry.degree);
      const key = normalizeDegreeKey(raw);
      if (key) limitedDegrees[key] = true;
    });

    function blocked(ing) {
      if (!ing) return true;
      const names = {};
      names[ing.id] = 1;
      if (ing.name !== ing.id) names[ing.name] = 1;
      return limits.some(entry => limitHits(entry, names, ing.degrees || {}));
    }

    function place(ing) {
      const i = slots.findIndex(slot => !slot);
      if (i < 0 || !ing || blocked(ing)) return false;
      slots[i] = ing;
      return true;
    }

    function foodsOfDegree(key) {
      const group = (pureGroups[key] || []).filter(ing => !blocked(ing));
      if (group.length) return group;
      return pool.filter(ing => !blocked(ing) && num((ing.degrees || {})[key]) > 0);
    }

    function mustHits(needName) {
      return pool.filter(ing => !blocked(ing) && ingredientMatchesMust(ing, needName))
        .map(ing => shapeForMust(ing, needName));
    }

    function resolveRandomMust(entry) {
      if (entry && Array.isArray(entry.or)) {
        const names = aggregate(slots).names;
        if (entry.or.some(part => mustSatisfied(part, names))) return null;
        const options = entry.or.filter(part => {
          const name = mustNeedName(part);
          return !!name && mustHits(name).length;
        });
        return pickOne(options.length ? options : entry.or);
      }
      return entry;
    }

    function placeRandom(group) {
      if (!group || !group.length) return false;
      const fresh = group.filter(ing => !slots.some(slot => slot && (slot.id || slot.name) === (ing.id || ing.name)));
      return place(pickOne(fresh.length ? fresh : group));
    }

    const must = Array.isArray(dish.must) ? dish.must : [];
    must.forEach(entry => {
      const target = resolveRandomMust(entry);
      const needName = mustNeedName(target);
      if (!needName) return;
      const forceRaw = shouldForceRawMust(dish, needName, aggregate(slots).names);
      const pickName = forceRaw ? parseFormTags(needName).base : needName;
      const hits = forceRaw
        ? pool.filter(ing => !blocked(ing) && ingredientMatchesMust(ing, pickName))
        : mustHits(needName);
      let guard = 0;
      while (!mustSatisfied(target, aggregate(slots).names) && slots.some(slot => !slot) && guard < SLOTS) {
        guard += 1;
        if (!hits.length || !placeRandom(hits)) break;
      }
    });

    const requires = Array.isArray(dish.requires) ? dish.requires : [];
    requires.forEach(req => {
      const target = resolveRequireEntry(req, aggregate(slots).tags, part => requireCanFill(part, foodsOfDegree));
      if (!target || target.degree == null) return;
      const op = String(target.op || ">=");
      if (op !== ">" && op !== ">=" && op !== "==" && op !== "=" && !isUpperBoundOp(op)) return;
      const key = normalizeDegreeKey(target.degree);
      const group = foodsOfDegree(key);
      let guard = 0;
      while (!requireSatisfied(target, aggregate(slots).tags) && slots.some(slot => !slot) && guard < SLOTS) {
        guard += 1;
        const tags = aggregate(slots).tags;
        const fits = group.filter(ing => requireAllowsAdd(target, tags, (ing.degrees || {})[key]));
        if (!fits.length || !placeRandom(fits)) break;
      }
    });

    const agg = aggregate(slots);
    const unmet = must.some(entry => !mustSatisfied(entry, agg.names))
      || !atLeastOneRawSatisfied(dish, agg.names)
      || requires.some(req => !requireSatisfied(req, agg.tags));
    if (!unmet && slots.some(slot => !slot)) {
      const usable = DEGREE_KEYS.filter(key => !limitedDegrees[key] && foodsOfDegree(key).length);
      const fresh = usable.filter(key => !(agg.tags[key] > 0));
      const key = pickOne(fresh.length ? fresh : usable);
      const group = key ? foodsOfDegree(key) : [];
      let guard = 0;
      while (group.length && slots.some(slot => !slot) && guard < SLOTS) {
        guard += 1;
        if (!placeRandom(group)) break;
      }
    }
    return { slots };
  }

  /**
   * 为料理生成示例填锅。优先用「只有一种度」的食材；must 仍按名字找。
   * foods 可含 hide:true 的原料；调用方应已去掉 plantOnly / noCook。
   */
  function sampleFill(dish, foods, allDishes, variant) {
    if (!dish) return { ok: false, slots: [], message: "未选择料理" };
    const reqIndex = variant && typeof variant === "object" ? (Number(variant.reqIndex) || 0) : (Number(variant) || 0);
    const fillerIndex = variant && typeof variant === "object" ? (Number(variant.fillerIndex) || 0) : (Number(variant) || 0);
    const pool = (Array.isArray(foods) ? foods : [])
      .map(ingredientFromFood)
      .filter(Boolean);
    if (!pool.length) return { ok: false, slots: [], message: "没有基础食物数据" };

    const pureGroups = puresByDegree(pool);
    const slots = [];

    const push = ing => {
      if (!ing || slots.length >= SLOTS) return false;
      slots.push(ing);
      return true;
    };

    const blocked = ing => {
      const limits = Array.isArray(dish.limit) ? dish.limit : [];
      const names = {};
      const tags = Object.assign({}, ing.degrees);
      names[ing.id] = 1;
      if (ing.name !== ing.id) names[ing.name] = 1;
      return limits.some(entry => limitHits(entry, names, tags));
    };

    const must = Array.isArray(dish.must) ? dish.must : [];
    must.forEach(entry => {
      const target = resolveMustEntry(entry, aggregate(slots).names, part => {
        const name = mustNeedName(part);
        return !!name && pool.some(ing => !blocked(ing) && ingredientMatchesMust(ing, name));
      });
      const needName = mustNeedName(target);
      if (!needName) return;
      const need = target && typeof target === "object" && target.value != null ? Math.ceil(num(target.value)) : 1;
      for (let n = 0; n < need && slots.length < SLOTS; n++) {
        const forceRaw = shouldForceRawMust(dish, needName, aggregate(slots).names);
        const pickName = forceRaw ? parseFormTags(needName).base : needName;
        const baseHit = pool.find(ing => !blocked(ing) && ingredientMatchesMust(ing, pickName));
        const hit = forceRaw ? baseHit : shapeForMust(baseHit, needName);
        if (hit) push(hit);
      }
    });

    const requires = Array.isArray(dish.requires) ? dish.requires : [];
    requires.forEach(req => {
      const ofDeg = key => {
        const pure = (pureGroups[key] || []).filter(ing => !blocked(ing));
        if (pure.length) return pure;
        return pool.filter(ing => !blocked(ing) && num((ing.degrees || {})[key]) > 0);
      };
      const target = resolveRequireEntry(req, aggregate(slots).tags, part => requireCanFill(part, ofDeg));
      if (!target || target.degree == null || slots.length >= SLOTS) return;
      const key = normalizeDegreeKey(target.degree);
      const group = (pureGroups[key] || []).filter(ing => !blocked(ing));
      const mixed = pool.filter(ing => !blocked(ing) && num((ing.degrees || {})[key]) > 0);
      let guard = 0;
      while (!requireSatisfied(target, aggregate(slots).tags) && slots.length < SLOTS && guard < SLOTS) {
        guard += 1;
        const tags = aggregate(slots).tags;
        const cands = (group.length ? group : mixed).filter(ing =>
          requireAllowsAdd(target, tags, (ing.degrees || {})[key])
        );
        if (!cands.length) break;
        const pick = group.length
          ? cands[Math.min(reqIndex, cands.length - 1)]
          : cands[0];
        if (!pick || !push(pick)) break;
      }
    });

    const fillerOrder = [
      "inedible", "ice", "veg", "fruit", "meat", "egg", "sweetener", "dairy",
      "fish", "monster", "magic", "fat", "seed", "decoration", "dried", "precook"
    ];
    const fillerCands = [];
    const pushCand = ing => {
      if (!ing || blocked(ing) || fillerCands.indexOf(ing) >= 0) return;
      fillerCands.push(ing);
    };
    fillerOrder.forEach(key => (pureGroups[key] || []).forEach(pushCand));
    pool.forEach(pushCand);
    const filler = fillerCands.length
      ? fillerCands[Math.min(fillerIndex, fillerCands.length - 1)]
      : null;
    while (slots.length < SLOTS) {
      if (!filler) break;
      push(filler);
    }

    if (slots.length < SLOTS) {
      return { ok: false, slots, message: "无法为该料理凑满 4 格示例配方（基础食物不足或全被 limit）" };
    }

    const ok = slotsMakeDish(slots, dish, allDishes);
    const check = cook(slots, Array.isArray(allDishes) && allDishes.length ? allDishes : [dish]);
    return {
      ok,
      slots,
      message: ok
        ? "示例配方"
        : (check.ok
          ? "示例被更高优先级挤掉：" + (check.candidates[0].name || "")
          : (check.message || "示例未匹配"))
    };
  }

  function shuffle(list) {
    const arr = list.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  function pickOne(list) {
    if (!list || !list.length) return null;
    return list[Math.floor(Math.random() * list.length)];
  }

  /**
   * 随机凑一条 4 格配方。
   * 必用按名字放；度要求在该度的可选食材里随机挑。
   * 都满足后，空格从所有不在 limit 里的纯单度食材里随机再配。
   */
  function randomFill(dish, foods) {
    const slots = [];
    if (!dish) return slots;
    const pool = (Array.isArray(foods) ? foods : []).map(ingredientFromFood).filter(Boolean);
    if (!pool.length) return slots;
    const pureGroups = puresByDegree(pool);
    const limits = Array.isArray(dish.limit) ? dish.limit : [];
    const limitedDegrees = {};
    limits.forEach(entry => {
      const raw = typeof entry === "string" ? entry : (entry && entry.degree);
      const key = normalizeDegreeKey(raw);
      if (key) limitedDegrees[key] = true;
    });

    function blocked(ing) {
      if (!ing) return true;
      const names = {};
      names[ing.id] = 1;
      if (ing.name !== ing.id) names[ing.name] = 1;
      return limits.some(entry => limitHits(entry, names, ing.degrees || {}));
    }

    function ofDegree(key, allowMixed) {
      const pure = (pureGroups[key] || []).filter(ing => !blocked(ing));
      if (pure.length || !allowMixed) return pure;
      return pool.filter(ing => !blocked(ing) && num((ing.degrees || {})[key]) > 0);
    }

    function push(ing) {
      if (!ing || slots.length >= SLOTS) return false;
      slots.push(ing);
      return true;
    }

    const must = Array.isArray(dish.must) ? dish.must : [];
    must.forEach(entry => {
      const target = resolveMustEntry(entry, aggregate(slots).names, part => {
        const name = mustNeedName(part);
        return !!name && pool.some(ing => !blocked(ing) && ingredientMatchesMust(ing, name));
      });
      const needName = mustNeedName(target);
      if (!needName) return;
      const forceRaw = shouldForceRawMust(dish, needName, aggregate(slots).names);
      const pickName = forceRaw ? parseFormTags(needName).base : needName;
      const hits = pool.filter(ing => !blocked(ing) && ingredientMatchesMust(ing, pickName))
        .map(ing => (forceRaw ? ing : shapeForMust(ing, needName)));
      const need = target && typeof target === "object" && target.value != null ? Math.max(1, Math.ceil(num(target.value))) : 1;
      for (let n = 0; n < need && slots.length < SLOTS; n++) push(pickOne(hits));
    });

    const requires = Array.isArray(dish.requires) ? dish.requires : [];
    requires.forEach(req => {
      const target = resolveRequireEntry(req, aggregate(slots).tags, part => requireCanFill(part, key => ofDegree(key, true)));
      if (!target || target.degree == null) return;
      const op = String(target.op || ">=");
      if (op !== ">" && op !== ">=" && op !== "==" && op !== "=" && !isUpperBoundOp(op)) return;
      const key = normalizeDegreeKey(target.degree);
      const group = ofDegree(key, true);
      let guard = 0;
      while (!requireSatisfied(target, aggregate(slots).tags) && slots.length < SLOTS && guard < SLOTS) {
        guard += 1;
        const tags = aggregate(slots).tags;
        const fits = group.filter(ing => requireAllowsAdd(target, tags, (ing.degrees || {})[key]));
        if (!fits.length || !push(pickOne(fits))) break;
      }
    });

    const agg = aggregate(slots);
    const unmet = must.some(entry => !mustSatisfied(entry, agg.names))
      || !atLeastOneRawSatisfied(dish, agg.names)
      || requires.some(req => !requireSatisfied(req, agg.tags));
    if (unmet) return slots;

    let bag = [];
    DEGREE_KEYS.forEach(key => {
      if (limitedDegrees[key]) return;
      ofDegree(key, false).forEach(ing => {
        if (bag.indexOf(ing) < 0) bag.push(ing);
      });
    });
    bag = shuffle(bag);
    let guard = 0;
    while (slots.length < SLOTS && bag.length && guard < SLOTS * bag.length) {
      guard += 1;
      const fresh = bag.filter(ing => !slots.some(slot => (slot.id || slot.name) === (ing.id || ing.name)));
      push(pickOne(fresh.length ? fresh : bag));
    }
    return slots;
  }

  /**
   * 料理详情底部的可实现举例。每次随机配几条不同配方，只保留真正能做出该料理的结果。
   */
  function recipeKey(slots) {
    return (Array.isArray(slots) ? slots : []).map(slot => slot.id || slot.name).slice().sort().join("\0");
  }

  function exampleRecipes(dish, foods, allDishes, options) {
    const note = "以下为随机举例，不是全部可行配方。";
    const pool = (Array.isArray(foods) ? foods : []).map(ingredientFromFood).filter(Boolean);
    if (!pool.length) return { recipes: [], note: "没有基础食物数据", fresh: 0 };
    const want = Math.max(1, Math.floor(num(options && options.want)) || 2);
    const blocked = {};
    const exclude = options && options.exclude;
    if (exclude && typeof exclude === "object") {
      Object.keys(exclude).forEach(key => { if (exclude[key]) blocked[key] = true; });
    }

    function gather(skip, limit) {
      const found = [];
      const seen = Object.assign({}, skip);
      for (let i = 0; i < 96 && found.length < limit; i++) {
        const slots = randomFill(dish, foods);
        if (!slots || slots.length < SLOTS) continue;
        if (!slotsMakeDish(slots, dish, allDishes)) continue;
        const key = recipeKey(slots);
        if (seen[key]) continue;
        seen[key] = true;
        found.push({
          slots,
          names: slots.map(slot => slot.name || slot.id),
          ok: true,
          message: "示例配方"
        });
      }
      return found;
    }

    const fresh = gather(blocked, want);
    const recipes = fresh.slice();
    if (recipes.length < want && Object.keys(blocked).length) {
      const already = {};
      recipes.forEach(rec => { already[recipeKey(rec.slots)] = true; });
      gather(already, want - recipes.length).forEach(rec => recipes.push(rec));
    }
    if (!recipes.length) return { recipes: [], note: "暂无示例配方", fresh: 0 };
    return { recipes, note, fresh: fresh.length };
  }

  return {
    SLOTS,
    DEGREE_KEYS,
    WANT,
    num,
    useFoods,
    ingredientFromFood,
    aggregate,
    dishMatches,
    requireSatisfied,
    isFallbackDish,
    findFallbackDish,
    cook,
    previewPossible,
    filterWanted,
    isPureDegree,
    sampleFill,
    supplementFill,
    exampleRecipes,
    priorityOf,
    weightOf,
    topPriorityGroup
  };
});
