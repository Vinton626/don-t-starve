let fishQuery = "";
let activeFish = null;

const esc = text => Foodfarm.escapeHTML(text == null ? "" : String(text));

function fishKey(fish) {
  if (!fish) return "";
  if (fish.id != null && String(fish.id).trim()) return String(fish.id).trim();
  return String(fish.name || "").trim();
}

function fishCardHTML(fish) {
  const areasText = Foodfarm.fishAreasText(fish);
  const weight = Foodfarm.fishWeightRange(fish);
  const weightText = weight.min != null && weight.max != null
    ? `${weight.min}–${weight.max}`
    : (weight.min != null ? `≥${weight.min}` : (weight.max != null ? `≤${weight.max}` : ""));
  return (
    `<button type="button" class="food-card" data-fish-id="${esc(fishKey(fish))}">` +
    `<div class="food-card-name">${esc(fish.name || fish.id || "未命名")}</div>` +
    (areasText ? `<div class="food-card-type">${esc(areasText)}</div>` : "") +
    (weightText ? `<div class="fish-card-weight">重量 ${esc(weightText)}</div>` : "") +
    `</button>`
  );
}

function fishSearchBlob(fish) {
  const areas = Foodfarm.fishAreasText(fish);
  const drops = Foodfarm.fishDropsOf(fish).map(Foodfarm.fishDropLabel).join(" ");
  const seasons = Foodfarm.fishSeasonsText(fish);
  const events = Foodfarm.fishEventsOf(fish).join(" ");
  const info = Foodfarm.fishingInfo(fish);
  return [
    fish.name || "",
    fish.id || "",
    fish.source || "",
    areas,
    drops,
    seasons,
    events,
    info.note || ""
  ].join(" ").toLowerCase();
}

function renderFish() {
  const host = Foodfarm.$("fish-body");
  if (!host) return;
  const all = Foodfarm.fishItems();
  if (!all.length) {
    host.innerHTML = `<p class="panel-note">暂无鱼类数据。在 basic_food.json 里写 <code>fish: true</code> 即可出现在这里。</p>`;
    Foodfarm.bindContentTags(host);
    return;
  }
  const q = String(fishQuery || "").trim().toLowerCase();
  const items = q ? all.filter(fish => fishSearchBlob(fish).includes(q)) : all;
  if (!items.length) {
    host.innerHTML = `<p class="panel-note">没有匹配的鱼类。</p>`;
    Foodfarm.bindContentTags(host);
    return;
  }
  const groups = Foodfarm.groupItemsByOrigin(items);
  host.innerHTML = Foodfarm.originSectionsHTML(groups, fishCardHTML);
  Foodfarm.bindOriginSections(host);
  Foodfarm.bindContentTags(host);
}

function fishDetailHTML(fish) {
  const areasText = Foodfarm.fishAreasText(fish);
  const drops = Foodfarm.fishDropsOf(fish).map(Foodfarm.fishDropLabel).filter(Boolean);
  const seasonsText = Foodfarm.fishSeasonsText(fish);
  const events = Foodfarm.fishEventsOf(fish).filter(Boolean);
  const weight = Foodfarm.fishWeightRange(fish);
  const info = Foodfarm.fishingInfo(fish);
  const weightText = weight.min != null && weight.max != null
    ? `${weight.min} – ${weight.max}`
    : (weight.min != null ? `最轻 ${weight.min}` : (weight.max != null ? `最重 ${weight.max}` : ""));
  const appear = [];
  if (seasonsText) appear.push(seasonsText);
  if (events.length) appear.push(events.join("、"));
  return [
    `<p>来源：${esc(Foodfarm.originLabel(fish))}</p>`,
    fish.source ? `<p>产出：${esc(fish.source)}</p>` : "",
    areasText ? `<p>区域：${esc(areasText)}</p>` : "",
    drops.length ? `<p>掉落：${esc(drops.join("、"))}</p>` : "",
    appear.length ? `<p>出现：${esc(appear.join("；"))}</p>` : "",
    weightText ? `<p>重量：<b>${esc(weightText)}</b></p>` : "",
    info.note ? `<p>${info.note}</p>` : ""
  ].join("");
}

function openFishModal(fish) {
  if (!fish) return;
  activeFish = fish;
  Foodfarm.$("fish-modal-title").textContent = fish.name || fish.id || "鱼";
  const stats = Foodfarm.$("fish-modal-stats");
  if (stats) stats.innerHTML = "";
  const meta = Foodfarm.$("fish-modal-meta");
  if (meta) {
    const areasText = Foodfarm.fishAreasText(fish);
    meta.innerHTML = areasText ? `<span>区域：${esc(areasText)}</span>` : "";
  }
  const desc = Foodfarm.$("fish-modal-desc");
  if (desc) {
    desc.innerHTML = fishDetailHTML(fish);
    Foodfarm.bindContentTags(desc);
  }
  const modal = Foodfarm.$("fish-modal");
  if (modal) modal.hidden = false;
  document.body.classList.add("food-modal-open");
}

function closeFishModal() {
  const modal = Foodfarm.$("fish-modal");
  if (modal) modal.hidden = true;
  document.body.classList.remove("food-modal-open");
  activeFish = null;
}

function bindFishUI() {
  const host = Foodfarm.$("fish-body");
  if (host && host.dataset.bound !== "1") {
    host.dataset.bound = "1";
    host.addEventListener("click", e => {
      const card = e.target.closest(".food-card[data-fish-id]");
      if (!card) return;
      const id = card.getAttribute("data-fish-id");
      const fish = Foodfarm.fishItems().find(item => fishKey(item) === id) || null;
      openFishModal(fish);
    });
  }

  const search = Foodfarm.$("fish-search");
  if (search && search.dataset.bound !== "1") {
    search.dataset.bound = "1";
    search.addEventListener("input", () => {
      fishQuery = search.value || "";
      renderFish();
    });
  }

  const backdrop = Foodfarm.$("fish-modal-backdrop");
  const closeBtn = Foodfarm.$("fish-modal-close");
  if (backdrop) backdrop.addEventListener("click", closeFishModal);
  if (closeBtn) closeBtn.addEventListener("click", closeFishModal);
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    const modal = Foodfarm.$("fish-modal");
    if (!modal || modal.hidden) return;
    closeFishModal();
  });
}

bindFishUI();

Foodfarm.bootFoodfarm({
  onReady: renderFish,
  onModsChange: () => {
    closeFishModal();
    renderFish();
  }
});
