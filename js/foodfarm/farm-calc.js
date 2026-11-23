/**
 * 种植肥料配比计算：一块地皮 slots 格（默认 9），在勾选的作物里找三种肥料净值都 >= 0 的配比。
 * 每株作物一个周期的净变化取自 basic_food 的 seed.fertilizer（负=消耗，正=产出）。
 * 用法：
 *   const crops = Foodfarm.plantEntries().map(FarmCalc.cropFromEntry).filter(Boolean);
 *   FarmCalc.solve(crops.slice(0, 3), { kinds: 2 });
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.FarmCalc = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  const NUTRIENTS = ["formula", "compost", "manure"];
  const NUTRIENT_NAMES = { formula: "催长剂", compost: "堆肥", manure: "粪肥" };
  const MAX_CROPS = 8;
  const DEFAULT_SLOTS = 9;
  const DEFAULT_LIMIT = 20;

  /** 家族条件只作页面提示，不参与配比计算 */
  const FAMILY = {
    min: 4,
    radiusTiles: 1,
    notice: "一个地皮范围内的同种作物需要至少 4 株（含自身），才能满足家族条件。"
  };

  function nutrientName(key) {
    const tags = typeof window !== "undefined" && window.Foodfarm && window.Foodfarm.FERTILIZER_TAGS;
    return (tags && tags[key] && tags[key].name) || NUTRIENT_NAMES[key] || key;
  }

  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  function vec(src) {
    const out = {};
    NUTRIENTS.forEach(key => { out[key] = num(src && src[key]); });
    return out;
  }

  /** plantEntries() 的条目 → 计算用作物；没有肥料数据返回 null */
  function cropFromEntry(entry) {
    const food = entry && entry.food;
    const seed = entry && entry.seed;
    const fert = seed && seed.fertilizer;
    if (!food || !fert) return null;
    // 新格式：{ formula, compost, manure }，负=消耗、正=产出
    // 旧格式兼容：{ consume, produce }
    let delta;
    if (fert.consume != null || fert.produce != null) {
      const consume = vec(fert.consume);
      const produce = vec(fert.produce);
      delta = {};
      NUTRIENTS.forEach(key => { delta[key] = produce[key] - consume[key]; });
    } else {
      delta = vec(fert);
    }
    const consume = {};
    const produce = {};
    NUTRIENTS.forEach(key => {
      consume[key] = delta[key] < 0 ? -delta[key] : 0;
      produce[key] = delta[key] > 0 ? delta[key] : 0;
    });
    const waterRaw = seed.water;
    const water = waterRaw == null || waterRaw === "" ? null : num(waterRaw);
    return {
      id: String(food.id || seed.id || food.name || ""),
      name: String(food.name || food.id || ""),
      consume,
      produce,
      delta,
      /** 耗水/阶段；仅展示，不参与配比 */
      water: water == null || !Number.isFinite(water) ? null : water
    };
  }

  function combinations(list, k) {
    const out = [];
    const pick = [];
    (function walk(start) {
      if (pick.length === k) {
        out.push(pick.slice());
        return;
      }
      for (let i = start; i <= list.length - (k - pick.length); i++) {
        pick.push(list[i]);
        walk(i + 1);
        pick.pop();
      }
    })(0);
    return out;
  }

  /** 把 total 拆成 parts 份、每份 >= min 的所有有序拆分 */
  function forEachComposition(total, parts, min, fn) {
    const counts = new Array(parts).fill(0);
    (function walk(i, left) {
      if (i === parts - 1) {
        if (left < min) return;
        counts[i] = left;
        fn(counts);
        return;
      }
      const rest = parts - i - 1;
      for (let c = min; c <= left - rest * min; c++) {
        counts[i] = c;
        walk(i + 1, left - c);
      }
    })(0, total);
  }

  function netOf(crops, counts) {
    const net = { formula: 0, compost: 0, manure: 0 };
    for (let i = 0; i < crops.length; i++) {
      const d = crops[i].delta;
      const c = counts[i];
      net.formula += d.formula * c;
      net.compost += d.compost * c;
      net.manure += d.manure * c;
    }
    return net;
  }

  function deficitOf(net) {
    let total = 0;
    let max = 0;
    NUTRIENTS.forEach(key => {
      if (net[key] < 0) {
        total -= net[key];
        max = Math.max(max, -net[key]);
      }
    });
    return { total, max };
  }

  function surplusOf(net) {
    return NUTRIENTS.reduce((sum, key) => sum + Math.max(0, net[key]), 0);
  }

  function spreadOf(counts) {
    let lo = Infinity;
    let hi = -Infinity;
    counts.forEach(c => {
      if (c < lo) lo = c;
      if (c > hi) hi = c;
    });
    return hi - lo;
  }

  function planOf(crops, counts, net) {
    return {
      counts: crops.map((crop, i) => ({ crop, count: counts[i] })),
      net: Object.assign({}, net),
      surplus: surplusOf(net)
    };
  }

  function diagnose(crops, closest) {
    const deficits = NUTRIENTS
      .filter(key => closest.net[key] < 0)
      .map(key => ({ key, name: nutrientName(key), amount: -closest.net[key] }));

    const advice = deficits.map(def => {
      const consumers = crops
        .filter(crop => crop.delta[def.key] < 0)
        .map(crop => ({ crop, amount: -crop.delta[def.key] }))
        .sort((a, b) => b.amount - a.amount);
      const producers = crops
        .filter(crop => crop.delta[def.key] > 0)
        .map(crop => ({ crop, amount: crop.delta[def.key] }))
        .sort((a, b) => b.amount - a.amount);
      return Object.assign({}, def, { consumers, producers, noProducer: !producers.length });
    });

    const lines = advice.map(item => {
      const who = item.consumers.map(c => c.crop.name).join("、") || "所选作物";
      const head = item.name + "缺 " + item.amount;
      if (item.noProducer) {
        return head + "：所选作物都不产出" + item.name + "，请减少消耗" + item.name + "的作物（" + who + "），或加入产出" + item.name + "的作物";
      }
      return head + "：请减少消耗" + item.name + "的作物（" + who + "）";
    });

    return { deficits: advice, message: lines.join("；") };
  }

  /**
   * crops: cropFromEntry 结果，1–8 种
   * options.slots   地块格数，默认 9
   * options.kinds   实际种几种（从勾选里挑），默认等于勾选数
   * options.limit   返回方案数上限，默认 20
   */
  function solve(crops, options) {
    const opts = options || {};
    const list = (Array.isArray(crops) ? crops : []).filter(Boolean);
    const slots = Math.max(1, Math.floor(num(opts.slots) || DEFAULT_SLOTS));
    const limit = Math.max(1, Math.floor(num(opts.limit) || DEFAULT_LIMIT));
    const minPer = 1;

    if (!list.length) return { ok: false, reason: "empty", message: "请至少勾选一种作物" };
    if (list.length > MAX_CROPS) {
      return { ok: false, reason: "too-many", message: "最多勾选 " + MAX_CROPS + " 种作物" };
    }

    const kinds = opts.kinds == null ? list.length : Math.floor(num(opts.kinds));
    if (kinds < 1 || kinds > list.length) {
      return { ok: false, reason: "kinds", message: "种植种类数需在 1 到 " + list.length + " 之间" };
    }
    if (kinds * minPer > slots) {
      return { ok: false, reason: "slots", message: slots + " 格最多种 " + slots + " 种" };
    }

    const solutions = [];
    let closest = null;
    let closestScore = null;
    let checked = 0;

    combinations(list, kinds).forEach(group => {
      forEachComposition(slots, kinds, minPer, counts => {
        checked += 1;
        const net = netOf(group, counts);
        const def = deficitOf(net);
        if (def.total === 0) {
          solutions.push({ group, counts: counts.slice(), net, surplus: surplusOf(net), spread: spreadOf(counts) });
          return;
        }
        const score = [def.total, def.max];
        if (!closestScore || score[0] < closestScore[0] || (score[0] === closestScore[0] && score[1] < closestScore[1])) {
          closestScore = score;
          closest = { group, counts: counts.slice(), net };
        }
      });
    });

    if (solutions.length) {
      solutions.sort((a, b) => a.surplus - b.surplus || a.spread - b.spread);
      return {
        ok: true,
        checked,
        total: solutions.length,
        solutions: solutions.slice(0, limit).map(s => planOf(s.group, s.counts, s.net))
      };
    }

    const diag = diagnose(closest.group, closest);
    return {
      ok: false,
      reason: "deficit",
      checked,
      closest: planOf(closest.group, closest.counts, closest.net),
      deficits: diag.deficits,
      message: diag.message
    };
  }

  function deltaKey(delta) {
    return NUTRIENTS.map(key => delta[key]).join(",");
  }

  /** 肥料净值完全相同的作物合并成一类，枚举只按类进行 */
  function groupByDelta(crops) {
    const map = new Map();
    crops.forEach(crop => {
      const key = deltaKey(crop.delta);
      if (!map.has(key)) map.set(key, { key, delta: Object.assign({}, crop.delta), members: [] });
      map.get(key).members.push(crop);
    });
    return [...map.values()];
  }

  function addNet(base, delta, count) {
    return {
      formula: base.formula + delta.formula * count,
      compost: base.compost + delta.compost * count,
      manure: base.manure + delta.manure * count
    };
  }

  /**
   * 锁定作物按精确株数种下，剩余格子从 pool（全部种子，排除已锁定的）补齐。
   * locked: [{ crop, count }]
   * pool:   cropFromEntry 结果
   * options.slots 默认 9；options.limit 返回方案上限，默认 300
   * 返回的方案按「类」给出：parts = [{ group: { delta, members }, count }]
   */
  function solveFill(locked, pool, options) {
    const opts = options || {};
    const slots = Math.max(1, Math.floor(num(opts.slots) || DEFAULT_SLOTS));
    const limit = Math.max(1, Math.floor(num(opts.limit) || 300));
    const picks = (Array.isArray(locked) ? locked : [])
      .filter(item => item && item.crop && num(item.count) > 0)
      .map(item => ({ crop: item.crop, count: Math.floor(num(item.count)) }));

    if (!picks.length) return { ok: false, reason: "empty", message: "请先选择一种作物" };
    if (picks.length > MAX_CROPS) {
      return { ok: false, reason: "too-many", message: "最多选择 " + MAX_CROPS + " 种作物" };
    }

    const used = picks.reduce((sum, item) => sum + item.count, 0);
    let base = { formula: 0, compost: 0, manure: 0 };
    picks.forEach(item => { base = addNet(base, item.crop.delta, item.count); });
    const head = { locked: picks, used, slots, base };

    if (used > slots) {
      return Object.assign(head, { ok: false, reason: "slots", message: "已选 " + used + " 株，超过一个地皮的 " + slots + " 格" });
    }

    const lockedIds = new Set(picks.map(item => item.crop.id));
    const groups = groupByDelta((Array.isArray(pool) ? pool : []).filter(crop => crop && !lockedIds.has(crop.id)));
    const left = slots - used;

    const plans = [];
    let total = 0;
    let checked = 0;
    let closest = null;
    let closestScore = null;
    const counts = new Array(groups.length).fill(0);

    const record = net => {
      checked += 1;
      const def = deficitOf(net);
      if (def.total === 0) {
        total += 1;
        const parts = [];
        counts.forEach((c, i) => { if (c > 0) parts.push({ group: groups[i], count: c }); });
        plans.push({ parts, net, surplus: surplusOf(net), kinds: parts.length });
        return;
      }
      if (!closestScore || def.total < closestScore[0] || (def.total === closestScore[0] && def.max < closestScore[1])) {
        closestScore = [def.total, def.max];
        const parts = [];
        counts.forEach((c, i) => { if (c > 0) parts.push({ group: groups[i], count: c }); });
        closest = { parts, net };
      }
    };

    if (left === 0 || !groups.length) {
      record(base);
    } else {
      (function walk(i, remain, net) {
        if (i === groups.length - 1) {
          counts[i] = remain;
          record(addNet(net, groups[i].delta, remain));
          counts[i] = 0;
          return;
        }
        for (let c = 0; c <= remain; c++) {
          counts[i] = c;
          walk(i + 1, remain - c, addNet(net, groups[i].delta, c));
        }
        counts[i] = 0;
      })(0, left, base);
    }

    if (plans.length) {
      plans.sort((a, b) => a.surplus - b.surplus || a.kinds - b.kinds);
      return Object.assign(head, { ok: true, checked, total, groups, plans: plans.slice(0, limit) });
    }

    const deficits = NUTRIENTS
      .filter(key => closest && closest.net[key] < 0)
      .map(key => {
        const consumers = picks
          .filter(item => item.crop.delta[key] < 0)
          .map(item => ({ crop: item.crop, amount: -item.crop.delta[key] * item.count }))
          .sort((a, b) => b.amount - a.amount);
        return { key, name: nutrientName(key), amount: -closest.net[key], consumers };
      });
    const message = deficits.map(def => {
      const who = def.consumers.map(c => c.crop.name).join("、");
      return def.name + "缺 " + def.amount + (who ? "：请减少消耗" + def.name + "的作物（" + who + "）" : "：请减少" + def.name + "的消耗");
    }).join("；");

    return Object.assign(head, { ok: false, reason: "deficit", checked, groups, closest, deficits, message });
  }

  function pairNet(a, b) {
    return {
      formula: a.formula + b.formula,
      compost: a.compost + b.compost,
      manure: a.manure + b.manure
    };
  }

  function scaleNet(net, factor) {
    const n = num(factor);
    return {
      formula: net.formula * n,
      compost: net.compost * n,
      manure: net.manure * n
    };
  }

  /** 与 crop 各 1 株时，三种肥料都不为负的其他种子 */
  function solvePair(crop, pool) {
    if (!crop) return { ok: false, mode: "1-1", reason: "empty", message: "请先选择一种作物" };
    const mates = (Array.isArray(pool) ? pool : []).filter(other => {
      if (!other || other.id === crop.id) return false;
      const net = pairNet(crop.delta, other.delta);
      return NUTRIENTS.every(key => net[key] >= 0);
    }).map(other => ({ crop: other, net: pairNet(crop.delta, other.delta) }));
    return {
      ok: true,
      mode: "1-1",
      focus: crop,
      mates,
      message: mates.length ? "" : crop.name + " 没有 1:1 互补种子"
    };
  }

  /** 把 remaining 拆成若干 3/6（非递减，避免重复分拆） */
  function tripleCountPartitions(remaining) {
    if (remaining === 0) return [[]];
    if (remaining < 0 || remaining > 9 || remaining % 3 !== 0) return [];
    const out = [];
    (function walk(left, minPart, acc) {
      if (left === 0) {
        out.push(acc.slice());
        return;
      }
      [3, 6].forEach(part => {
        if (part < minPart || part > left) return;
        acc.push(part);
        walk(left - part, part, acc);
        acc.pop();
      });
    })(remaining, 3, []);
    return out;
  }

  /** counts 的去重全排列，用于把 [3,6] 分给不同补种组 */
  function uniqueCountPerms(counts) {
    const sorted = (counts || []).slice().sort((a, b) => a - b);
    const out = [];
    const used = new Array(sorted.length).fill(false);
    const cur = [];
    (function walk() {
      if (cur.length === sorted.length) {
        out.push(cur.slice());
        return;
      }
      for (let i = 0; i < sorted.length; i++) {
        if (used[i]) continue;
        if (i > 0 && sorted[i] === sorted[i - 1] && !used[i - 1]) continue;
        used[i] = true;
        cur.push(sorted[i]);
        walk();
        cur.pop();
        used[i] = false;
      }
    })();
    return out;
  }

  function normalizeTripleCount(count) {
    const n = Math.floor(num(count));
    return n >= 6 ? 6 : 3;
  }

  /**
   * 3+3+3 / 3+6 配比：已选作物每株计数只能是 3 或 6，合计 ≤ 9。
   * 剩余格用 3、6 的组合补齐；总肥按株数加权，三项都不为负才算配上。
   */
  function solveTriple(locked, pool, options) {
    const opts = options || {};
    const limit = Math.max(1, Math.floor(num(opts.limit) || 300));
    const picks = (Array.isArray(locked) ? locked : [])
      .filter(item => item && item.crop)
      .map(item => ({ crop: item.crop, count: normalizeTripleCount(item.count) }));
    if (!picks.length) return { ok: false, mode: "3-3-3", reason: "empty", message: "请先选择一种作物" };
    if (picks.length > 3) {
      return { ok: false, mode: "3-3-3", reason: "kinds", message: "最多 3 种作物（3+3+3 或 3+6）" };
    }

    const used = picks.reduce((sum, item) => sum + item.count, 0);
    if (used > 9) {
      return { ok: false, mode: "3-3-3", reason: "slots", message: "已选株数超过 9 格" };
    }

    let lockedNet = { formula: 0, compost: 0, manure: 0 };
    picks.forEach(item => { lockedNet = addNet(lockedNet, item.crop.delta, item.count); });
    const remaining = 9 - used;
    const lockedIds = new Set(picks.map(item => item.crop.id));
    const groups = groupByDelta((Array.isArray(pool) ? pool : []).filter(crop => crop && !lockedIds.has(crop.id)));
    const plans = [];
    const consider = parts => {
      let net = lockedNet;
      parts.forEach(part => { net = addNet(net, part.group.delta, part.count); });
      if (NUTRIENTS.some(key => net[key] < 0)) return;
      plans.push({
        parts: parts.map(part => ({ group: part.group, count: part.count })),
        net: Object.assign({}, net),
        surplus: surplusOf(net)
      });
    };

    const partitions = tripleCountPartitions(remaining);
    partitions.forEach(counts => {
      const need = counts.length;
      if (!need) {
        consider([]);
        return;
      }
      if (groups.length < need) return;
      const perms = uniqueCountPerms(counts);
      combinations(groups, need).forEach(chosen => {
        perms.forEach(perm => {
          consider(chosen.map((group, i) => ({ group, count: perm[i] })));
        });
      });
    });

    const head = {
      mode: "3-3-3",
      slots: 9,
      used,
      base: Object.assign({}, lockedNet),
      locked: picks.map(item => ({ crop: item.crop, count: item.count }))
    };
    if (!plans.length) {
      return Object.assign(head, {
        ok: false,
        reason: "deficit",
        message: "没有在 3+3+3 / 3+6 规则下肥料不为负的配比"
      });
    }
    plans.sort((a, b) => a.surplus - b.surplus || a.parts.length - b.parts.length);
    return Object.assign(head, { ok: true, total: plans.length, plans: plans.slice(0, limit) });
  }

  return {
    NUTRIENTS,
    MAX_CROPS,
    DEFAULT_SLOTS,
    FAMILY,
    nutrientName,
    cropFromEntry,
    groupByDelta,
    solve,
    solveFill,
    solvePair,
    solveTriple
  };
});
