/**
 * 全局正文标签逻辑：roles / repeat / table / character / notice / states
 * 以及潮湿度 / 伤害 / b / warn / keyboard 等内联标签转义
 * 规则见 rules/commonrules.html；样式见 css/common-tags.css
 * 用法（经典脚本）：
 *   <script src="../js/common/tags.js"></script>
 *   CommonTags.bind(root, { onCharacterClick });
 *   CommonTags.installNoticeTips({ tipId: "notice-tip", onBind });
 *   CommonTags.escapeKeepingTags(recipeText);
 * 也可用 ES module：import Tags from "../js/common/tags.js"
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (typeof define === "function" && define.amd) define([], () => api);
  root.CommonTags = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  /** 全局内联标签（颜色见 css/common-tags.css；规则见 rules/commonrules.html） */
  const INLINE_TAGS = [
    "b",
    "health",
    "hunger",
    "sanity",
    "seablue",
    "trans",
    "damage",
    "physical",
    "planar",
    "warn",
    "keyboard",
    "green",
    "cyan",
    "lightpurple",
    "age",
    "notice",
    "meat",
    "veg",
    "fruit",
    "fish",
    "egg",
    "sweetener",
    "monster",
    "dairy",
    "ice",
    "inedible",
    "magic",
    "fat",
    "seed",
    "decoration",
    "dried",
    "precook",
    "manure",
    "compost",
    "formula",
    "brown",
    "grey",
    "lightblue",
    "coldfood",
    "hotfood"
  ];

  const TAG_COLORS = {
    b: "#7fd4ff",
    health: "#ff6b78",
    hunger: "#c49212",
    sanity: "#c65a12",
    seablue: "#3ec4e0",
    damage: "#5d7084",
    physical: "#ffd0f8",
    planar: "#bbf0fc",
    warn: "#ff3d2a",
    keyboard: "#b7c4d0",
    green: "#7dce7a",
    notice: "#f0d060",
    meat: "#c2185b",
    veg: "#7dce7a",
    fruit: "#ff9b9b",
    fish: "#6d93ad",
    egg: "#e8c4a8",
    sweetener: "#ffb6c1",
    monster: "#c084fc",
    dairy: "#cfc8b4",
    ice: "#8ec8f0",
    inedible: "#9a9a9a",
    magic: "#9b6bff",
    fat: "#e6b85c",
    seed: "#a3c96b",
    decoration: "#d4a0c8",
    dried: "#b08968",
    precook: "#7eb8a8",
    manure: "#d4925a",
    compost: "#c5c5c5",
    formula: "#b3e5ff",
    brown: "#d4925a",
    grey: "#c5c5c5",
    lightblue: "#b3e5ff",
    coldfood: "#6ec8f0",
    hotfood: "#e4572e"
  };

  function escapeHTML(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /** 转义文本，但保留白名单内联标签（配方 / 短文案） */
  function escapeKeepingTags(text, tags) {
    const list = Array.isArray(tags) && tags.length ? tags : INLINE_TAGS;
    const re = new RegExp("<(/?)(" + list.join("|") + ")(\\s[^>]*)?>", "gi");
    const s = String(text == null ? "" : text);
    let html = "";
    let last = 0;
    let m;
    while ((m = re.exec(s))) {
      html += escapeHTML(s.slice(last, m.index));
      html += m[0];
      last = m.index + m[0].length;
    }
    html += escapeHTML(s.slice(last));
    return html;
  }

  function bindRoleSwitch(root) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll("roles").forEach(box => {
      if (box.querySelector(":scope > .role-switch")) return;
      const roles = ["role1", "role2", "role3", "role4", "role5", "role6", "role7"]
        .map(tag => box.querySelector(":scope > " + tag))
        .filter(Boolean);
      if (!roles.length) return;
      const bar = document.createElement("div");
      bar.className = "role-switch";
      const show = el => {
        roles.forEach(role => role.classList.toggle("is-on", role === el));
        bar.querySelectorAll("button").forEach(btn => {
          btn.classList.toggle("is-on", btn.dataset.role === el.tagName.toLowerCase());
        });
      };
      roles.forEach((el, i) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.dataset.role = el.tagName.toLowerCase();
        const title = el.querySelector("h3");
        btn.textContent = (title && title.textContent.trim()) || ("形态" + (i + 1));
        btn.addEventListener("click", () => show(el));
        bar.appendChild(btn);
      });
      box.insertBefore(bar, box.firstChild);
      show(roles[0]);
    });
  }

  function wrapWideTables(root) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll("table").forEach(table => {
      if (table.parentElement && table.parentElement.classList.contains("table-scroll")) return;
      const wrap = document.createElement("div");
      wrap.className = "table-scroll";
      table.parentNode.insertBefore(wrap, table);
      wrap.appendChild(table);
    });
  }

  function bindSharedCopies(root) {
    if (!root || !root.querySelectorAll) return;
    const sources = new Map();
    root.querySelectorAll("repeat").forEach(el => {
      const key = (el.getAttribute("class") || "").trim();
      if (key && !sources.has(key)) sources.set(key, el);
    });
    const fill = (anchor, stack) => {
      if (!anchor || anchor.dataset.copy || anchor.hasAttribute("href")) return;
      if (anchor.closest("repeat")) return;
      const key = (anchor.getAttribute("class") || "").trim();
      const source = sources.get(key);
      if (!source || stack.includes(key)) return;
      anchor.dataset.copy = "1";
      anchor.replaceChildren();
      [...source.childNodes].forEach(node => anchor.appendChild(node.cloneNode(true)));
      anchor.querySelectorAll("a[class]").forEach(inner => fill(inner, stack.concat(key)));
    };
    root.querySelectorAll("a[class]").forEach(anchor => fill(anchor, []));
  }

  function bindTags(root, options) {
    if (!root) return;
    const opts = options || {};
    bindSharedCopies(root);
    wrapWideTables(root);
    bindRoleSwitch(root);
    if (typeof opts.onCharacterClick === "function") {
      root.querySelectorAll("character").forEach(el => {
        el.addEventListener("click", () => {
          const name = (el.getAttribute("name") || el.textContent || "").trim();
          opts.onCharacterClick(name, el);
        });
      });
    }
  }

  /** 生成三维 / 攻击力圆圈 HTML。label 有值时，悬停圆圈显示这段说明 */
  function stateOrbHTML(kind, valueHTML, emoji, label) {
    const map = {
      health: { className: "stat-health", emoji: "❤️" },
      hunger: { className: "stat-hunger", emoji: "🍗" },
      sanity: { className: "stat-sanity", emoji: "🧠" },
      attack: { className: "stat-attack", emoji: "⚔️" },
      formula: { className: "stat-formula", emoji: "🧪" },
      compost: { className: "stat-compost", emoji: "🍂" },
      manure: { className: "stat-manure", emoji: "💩" },
      water: { className: "stat-water", emoji: "💧" }
    };
    const conf = map[kind] || map.health;
    const face = emoji || conf.emoji;
    let orb = '<span class="stat-orb ' + conf.className + '"><span class="stat-emoji">' + face + "</span></span>";
    if (label) {
      const text = String(label).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
      orb = '<notice text="' + text + '">' + orb + "</notice>";
    }
    return (
      "<state>" +
      orb +
      '<span class="stat-value">' + (valueHTML == null ? "" : String(valueHTML)) + "</span>" +
      "</state>"
    );
  }

  function statesHTML(items) {
    const list = Array.isArray(items) ? items : [];
    return "<states>" + list.map(item => stateOrbHTML(item.kind, item.valueHTML, item.emoji, item.label)).join("") + "</states>";
  }

  let noticePinned = false;
  let noticeHideTimer = 0;
  let noticeOpts = {
    tipId: "notice-tip",
    frameSelectors: ".profile-drawer, .item-drawer, .insight-drawer, .char-notice, .notree-host, .app, .content-host, .page",
    scrollSelectors: ".profile-scroll, .item-scroll, .insight-drawer-panel, .char-notice-panel, .notree-host, .content-host",
    bindOptions: null
  };
  let noticeInstalled = false;

  function tipEl() {
    return document.getElementById(noticeOpts.tipId || "notice-tip");
  }

  function cancelNoticeHide() {
    clearTimeout(noticeHideTimer);
  }

  function scheduleNoticeHide() {
    if (noticePinned) return;
    cancelNoticeHide();
    noticeHideTimer = setTimeout(() => {
      if (noticePinned) return;
      const tip = tipEl();
      if (!tip) return;
      tip.hidden = true;
      tip._anchor = null;
    }, 220);
  }

  function noticeFrame(el) {
    const drawer = el.closest(noticeOpts.frameSelectors);
    const scroll = el.closest(noticeOpts.scrollSelectors);
    const box = (scroll || drawer || document.documentElement).getBoundingClientRect();
    const limit = (drawer || scroll || document.documentElement).getBoundingClientRect();
    const pad = 8;
    return {
      left: Math.max(limit.left + pad, pad),
      right: Math.min(limit.right - pad, window.innerWidth - pad),
      top: Math.max(box.top + 4, pad),
      bottom: Math.min(box.bottom - 4, window.innerHeight - pad)
    };
  }

  function hideNoticeTip() {
    noticePinned = false;
    cancelNoticeHide();
    const tip = tipEl();
    if (!tip) return;
    tip.hidden = true;
    tip._anchor = null;
  }

  function showNoticeTip(el) {
    cancelNoticeHide();
    const tip = tipEl();
    if (!tip) return;
    if (!el || !el.isConnected) {
      tip.hidden = true;
      return;
    }
    const text = el.getAttribute("text");
    if (!text) {
      tip.hidden = true;
      return;
    }
    const frame = noticeFrame(el);
    const maxW = frame.right - frame.left;
    const maxH = frame.bottom - frame.top;
    if (maxW < 8 || maxH < 8) {
      tip.hidden = true;
      return;
    }
    const anchor = el.getBoundingClientRect();
    const visible =
      anchor.bottom > frame.top &&
      anchor.top < frame.bottom &&
      anchor.right > frame.left &&
      anchor.left < frame.right;
    tip._anchor = el;
    tip.innerHTML = String(text).replace(/\\n|\r?\n/g, "<br>");
    bindTags(tip, noticeOpts.bindOptions || {});
    tip.style.maxWidth = maxW + "px";
    tip.style.maxHeight = maxH + "px";
    if (!visible) {
      tip.hidden = true;
      return;
    }
    tip.hidden = false;
    tip.style.left = frame.left + "px";
    tip.style.top = frame.top + "px";
    const box = tip.getBoundingClientRect();
    let x = anchor.left;
    let y = anchor.bottom + 6;
    if (x + box.width > frame.right) x = frame.right - box.width;
    if (x < frame.left) x = frame.left;
    if (y + box.height > frame.bottom) {
      const above = anchor.top - 6 - box.height;
      y = above >= frame.top ? above : frame.top;
    }
    if (y < frame.top) y = frame.top;
    tip.style.left = Math.round(x) + "px";
    tip.style.top = Math.round(y) + "px";
  }

  function installNoticeTips(options) {
    noticeOpts = Object.assign({}, noticeOpts, options || {});
    if (noticeInstalled) return;
    noticeInstalled = true;

    document.addEventListener("pointerover", e => {
      if (e.pointerType === "touch") return;
      const tip = tipEl();
      if (tip && (e.target === tip || tip.contains(e.target))) {
        cancelNoticeHide();
        return;
      }
      const el = e.target.closest && e.target.closest("notice");
      if (!el || !el.getAttribute("text")) return;
      noticePinned = false;
      cancelNoticeHide();
      showNoticeTip(el);
    });

    document.addEventListener("pointerout", e => {
      if (e.pointerType === "touch" || noticePinned) return;
      const tip = tipEl();
      const notice = e.target.closest && e.target.closest("notice");
      const inTip = tip && (e.target === tip || tip.contains(e.target));
      if (!notice && !inTip) return;
      const to = e.relatedTarget;
      if (notice && to && notice.contains(to)) return;
      if (tip && to && (to === tip || tip.contains(to))) return;
      if (inTip && tip._anchor && to && (to === tip._anchor || tip._anchor.contains(to))) return;
      scheduleNoticeHide();
    });

    document.addEventListener("click", e => {
      if (!window.matchMedia("(hover: none), (pointer: coarse)").matches) return;
      const el = e.target.closest && e.target.closest("notice");
      const tip = tipEl();
      if (el && el.getAttribute("text")) {
        if (noticePinned && tip && tip._anchor === el && !tip.hidden) {
          hideNoticeTip();
          return;
        }
        noticePinned = true;
        showNoticeTip(el);
        return;
      }
      if (noticePinned) hideNoticeTip();
    });

    document.addEventListener(
      "scroll",
      () => {
        const tip = tipEl();
        if (!tip || tip.hidden || !tip._anchor) return;
        if (!tip._anchor.isConnected) {
          hideNoticeTip();
          return;
        }
        showNoticeTip(tip._anchor);
      },
      true
    );
  }

  return {
    INLINE_TAGS,
    TAG_COLORS,
    escapeHTML,
    escapeKeepingTags,
    bindRoleSwitch,
    wrapWideTables,
    bindSharedCopies,
    bind: bindTags,
    bindTags,
    stateOrbHTML,
    statesHTML,
    installNoticeTips,
    showNoticeTip,
    hideNoticeTip
  };
});
