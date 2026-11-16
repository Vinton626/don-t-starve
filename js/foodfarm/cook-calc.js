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
    "sweetener", "monster", "dairy", "ice", "inedible"
  ];

  /** 「我想做」筛选项；原版无稳定「扣饥饿」料理，故不收录 hungerDown */
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
    DEGREE_KEYS.forEach(key => {
      if (Object.prototype.hasOwnProperty.call(raw, key)) out[key] = num(raw[key]);
    });
    Object.keys(raw).forEach(key => {
      if (out[key] == null) out[key] = num(raw[key]);
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
        tags[key] = (tags[key] || 0) + num(ing.degrees[key]);
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
    const degree = entry.degree != null ? String(entry.degree).trim() : "";
    if (degree && (tags[degree] || 0) > 0) return true;
    return false;
  }

  function mustSatisfied(entry, names) {
    if (entry == null) return false;
    if (typeof entry === "string") {
      const s = entry.trim();
      return !!s && (names[s] || 0) >= 1;
    }
    if (typeof entry !== "object") return false;
    const id = entry.id != null ? String(entry.id).trim() : "";
    const name = entry.name != null ? String(entry.name).trim() : "";
    const need = entry.value == null ? 1 : num(entry.value);
    const op = entry.op || ">=";
    let have = 0;
    if (id) have = Math.max(have, names[id] || 0);
    if (name) have = Math.max(have, names[name] || 0);
    return compareOp(have, op, need);
  }

  function requireSatisfied(req, tags) {
    if (!req || req.degree == null) return false;
    const key = String(req.degree);
    return compareOp(tags[key] || 0, req.op, req.value);
  }

  /** 单道料理是否匹配当前 names/tags（不看槽位是否满 4） */
  function dishMatches(dish, names, tags) {
    if (!dish || (!dish.id && !dish.name)) return false;
    const limits = Array.isArray(dish.limit) ? dish.limit : [];
    if (limits.some(entry => limitHits(entry, names, tags))) return false;
    const must = Array.isArray(dish.must) ? dish.must : [];
    if (must.some(entry => !mustSatisfied(entry, names))) return false;
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

  /**
   * 从匹配列表中取出最高优先级一组（DST GetCandidateRecipes）
   */
  function topPriorityGroup(matched) {
    if (!matched.length) return [];
    const sorted = matched.slice().sort((a, b) => priorityOf(b) - priorityOf(a));
    const top = priorityOf(sorted[0]);
    return sorted.filter(d => priorityOf(d) === top);
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
   *   wetGoop    满 4 格且无匹配
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
        wetGoop: false
      };
    }

    const matching = list.filter(d => dishMatches(d, agg.names, agg.tags));
    const candidates = topPriorityGroup(matching);
    if (!candidates.length) {
      return {
        ok: false,
        reason: "wetgoop",
        message: "没有匹配料理（湿腻焦糊）",
        aggregate: agg,
        matching: [],
        candidates: [],
        result: null,
        wetGoop: true
      };
    }

    const totalWeight = candidates.reduce((sum, d) => sum + weightOf(d), 0);
    return {
      ok: true,
      reason: candidates.length === 1 ? "unique" : "tie",
      message: candidates.length === 1
        ? "确定产出：" + (candidates[0].name || candidates[0].id)
        : "同优先级并列 " + candidates.length + " 道，游戏内按权重随机",
      aggregate: agg,
      matching: matching.slice().sort((a, b) => priorityOf(b) - priorityOf(a)),
      candidates,
      result: candidates.length === 1 ? candidates[0] : null,
      totalWeight,
      chances: candidates.map(d => ({
        dish: d,
        weight: weightOf(d),
        chance: weightOf(d) / totalWeight
      }))
    };
  }

  /** 未满 4 格时：哪些料理「目前条件尚未被打破」，供预览（must/requires 已满足的部分 + 未踩 limit） */
  function previewPossible(slots, dishes) {
    const agg = aggregate(slots);
    const list = Array.isArray(dishes) ? dishes : [];
    if (!agg.count) return { aggregate: agg, dishes: list.slice() };
    if (agg.filled) {
      const r = cook(slots, dishes);
      return { aggregate: agg, dishes: r.matching };
    }

    // 未满锅：limit 已踩中的排除；must/requires 只检查「已有量是否已超过失败」——
    // 宽松预览：当前 tags/names 不违反 limit，且已有 must 计数不超过需求失败的反向（即已放入的指名不冲突）
    const loose = list.filter(dish => {
      const limits = Array.isArray(dish.limit) ? dish.limit : [];
      if (limits.some(entry => limitHits(entry, agg.names, agg.tags))) return false;
      // 已放入的度若某 requires 用 < / <= 且已经超标，则不可能
      const requires = Array.isArray(dish.requires) ? dish.requires : [];
      for (let i = 0; i < requires.length; i++) {
        const req = requires[i];
        if (!req || req.degree == null) continue;
        const have = agg.tags[String(req.degree)] || 0;
        const op = String(req.op || ">=");
        if ((op === "<" || op === "<=") && !compareOp(have, op, req.value)) return false;
        if ((op === "==" || op === "=") && have > num(req.value)) return false;
      }
      return true;
    });
    return {
      aggregate: agg,
      dishes: loose.slice().sort((a, b) => priorityOf(b) - priorityOf(a))
    };
  }

  /**
   * 「我想做」过滤。wantKeys 为 WANT 的 key 数组；多选为且（同时满足）。
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
  function firstPureByDegree(pool) {
    const map = {};
    pool.forEach(ing => {
      const key = pureDegreeKey(ing);
      if (!key || map[key]) return;
      map[key] = ing;
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
   * 为料理生成示例填锅。优先用「只有一种度」的食材；must 仍按名字找。
   * foods 可含 hide:true 的原料。
   */
  function sampleFill(dish, foods, allDishes) {
    if (!dish) return { ok: false, slots: [], message: "未选择料理" };
    const pool = (Array.isArray(foods) ? foods : [])
      .map(ingredientFromFood)
      .filter(Boolean);
    if (!pool.length) return { ok: false, slots: [], message: "没有基础食物数据" };

    const pureMap = firstPureByDegree(pool);
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
      const needName = typeof entry === "string"
        ? entry.trim()
        : String((entry && (entry.name || entry.id)) || "").trim();
      const need = typeof entry === "object" && entry && entry.value != null ? Math.ceil(num(entry.value)) : 1;
      for (let n = 0; n < need && slots.length < SLOTS; n++) {
        const hit = pool.find(ing =>
          !blocked(ing) && (ing.name === needName || ing.id === needName)
        );
        if (hit) push(hit);
      }
    });

    const requires = Array.isArray(dish.requires) ? dish.requires : [];
    requires.forEach(req => {
      if (!req || req.degree == null || slots.length >= SLOTS) return;
      const key = String(req.degree);
      const need = num(req.value);
      let have = slots.reduce((sum, ing) => sum + num(ing.degrees[key]), 0);
      // 优先纯单度
      while (have < need && slots.length < SLOTS) {
        const pure = pureMap[key];
        const pick = pure && !blocked(pure)
          ? pure
          : pool.find(ing => !blocked(ing) && num(ing.degrees[key]) > 0);
        if (!pick) break;
        push(pick);
        have += num(pick.degrees[key]);
      }
    });

    const fillerOrder = ["inedible", "ice", "veg", "fruit", "meat", "egg", "sweetener", "dairy", "fish", "monster"];
    while (slots.length < SLOTS) {
      let pick = null;
      for (let i = 0; i < fillerOrder.length; i++) {
        const cand = pureMap[fillerOrder[i]];
        if (cand && !blocked(cand)) {
          pick = cand;
          break;
        }
      }
      if (!pick) pick = pool.find(ing => !blocked(ing));
      if (!pick) break;
      push(pick);
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

  /**
   * 料理详情底部用的「可实现举例」，不做全量枚举。
   * 默认给 1 条：must + 各度第一个纯单度食材 + 纯单度填充。
   */
  function exampleRecipes(dish, foods, allDishes) {
    const one = sampleFill(dish, foods, allDishes);
    if (!one.slots || !one.slots.length) {
      return { recipes: [], note: one.message || "暂无示例配方" };
    }
    return {
      recipes: [{
        slots: one.slots,
        names: one.slots.map(s => s.name || s.id),
        ok: one.ok,
        message: one.message
      }],
      note: "以下为单度食材举例，不是全部可行配方。"
    };
  }

  return {
    SLOTS,
    DEGREE_KEYS,
    WANT,
    num,
    ingredientFromFood,
    aggregate,
    dishMatches,
    cook,
    previewPossible,
    filterWanted,
    isPureDegree,
    sampleFill,
    exampleRecipes,
    priorityOf,
    weightOf,
    topPriorityGroup
  };
});
