/* Elden Ring Infusion Calculator: page logic. Needs window.ArEngine and the #weapon-db JSON. */
(function () {
  "use strict";

  const E = window.ArEngine;
  const db = JSON.parse(document.getElementById("weapon-db").textContent);
  const model = E.createModel(db);
  const ATTRS = E.ATTRIBUTES;
  const DMG = E.DAMAGE_TYPES;
  const STATUS = E.STATUS_TYPES;

  const ATTR_SHORT = { str: "STR", dex: "DEX", int: "INT", fai: "FAI", arc: "ARC" };
  const ATTR_LONG = { str: "Strength", dex: "Dexterity", int: "Intelligence", fai: "Faith", arc: "Arcane" };
  const DMG_LABEL = { physical: "Physical", magic: "Magic", fire: "Fire", lightning: "Lightning", holy: "Holy" };
  const DMG_SHORT = { physical: "Phys", magic: "Magic", fire: "Fire", lightning: "Light", holy: "Holy" };
  const STATUS_LABEL = {
    poison: "Poison",
    rot: "Scarlet Rot",
    bleed: "Bleed",
    frost: "Frost",
    sleep: "Sleep",
    madness: "Madness",
    blight: "Death Blight",
  };
  const SPELL_LABEL = { magic: "Sorcery scaling", holy: "Incantation scaling" };
  const SPELL_SHORT = { magic: "Sorcery", holy: "Incant." };
  const RANGED_TYPES = new Set([50, 51, 53, 55, 56]);
  const STORAGE_KEY = "er-infusion-calculator:v1";
  const DEFAULT_STATE = {
    weapon: "Uchigatana",
    stats: { str: 18, dex: 40, int: 9, fai: 10, arc: 9 },
    level25: 25, // upgrade level on the regular +25 scale; somber weapons convert it to +10
    twoHanded: false,
    sort: "ar",
    sample: true, // true while the stats are still the example ones
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    input: $("weapon-input"),
    toggle: $("weapon-toggle"),
    list: $("weapon-list"),
    meta: $("weapon-meta"),
    level: $("level"),
    levelOut: $("level-out"),
    levelHint: $("level-hint"),
    grip1: $("grip-1h"),
    grip2: $("grip-2h"),
    gripHint: $("grip-hint"),
    sampleNote: $("sample-note"),
    verdict: $("verdict"),
    sortAr: $("sort-ar"),
    sortGame: $("sort-game"),
    caption: $("ledger-caption"),
    head: $("ledger-head"),
    body: $("ledger-body"),
    legendKeys: $("legend-keys"),
    legendExtra: $("legend-extra"),
  };
  const statInputs = {};
  const statBoxes = {};
  const reqLabels = {};
  for (const a of ATTRS) {
    statInputs[a] = $("stat-" + a);
    statBoxes[a] = $("box-" + a);
    reqLabels[a] = $("req-" + a);
  }

  // ---- helpers --------------------------------------------------------------------------

  const floor = E.floor;
  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const oneDecimal = (v) => (Math.floor(v * 10 + 1e-6) / 10).toFixed(1);
  const clampStat = (v) => {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) ? Math.max(1, Math.min(99, n)) : 1;
  };
  const plusLevel = (lvl) => (lvl > 0 ? ` +${lvl}` : "");
  const affinityName = (inf) => model.affinityNames.get(inf.affinity);

  function loadState() {
    const s = JSON.parse(JSON.stringify(DEFAULT_STATE));
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (saved && typeof saved === "object") {
        if (typeof saved.weapon === "string" && model.byName.has(saved.weapon)) s.weapon = saved.weapon;
        if (saved.stats && typeof saved.stats === "object") {
          for (const a of ATTRS) if (saved.stats[a] != null) s.stats[a] = clampStat(saved.stats[a]);
        }
        if (Number.isFinite(Number(saved.level25))) s.level25 = Math.max(0, Math.min(25, Math.floor(saved.level25)));
        s.twoHanded = saved.twoHanded === true;
        s.sort = saved.sort === "game" ? "game" : "ar";
        s.sample = saved.sample !== false;
      }
    } catch (err) {
      /* storage unavailable: start from the defaults */
    }
    return s;
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      /* storage unavailable: settings just won't be remembered */
    }
  }

  const state = loadState();
  let weapon = model.byName.get(state.weapon) || model.byName.get(DEFAULT_STATE.weapon);
  const expanded = new Set();

  const levelFor = (w) => E.convertLevel(state.level25, 25, w.maxLevel);

  function upgradeMaterial(w) {
    if (w.maxLevel === 0) return "Can't be upgraded";
    if (w.maxLevel === 10) return "Somber Smithing Stones";
    return "Smithing Stones";
  }

  // ---- weapon search --------------------------------------------------------------------

  const normalize = (s) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/['’`]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

  const searchIndex = model.weapons.map((w) => ({
    weapon: w,
    name: normalize(w.name),
    haystack: normalize(
      [w.name, w.typeName, w.dlc ? "dlc shadow of the erdtree" : "", w.infusable ? "" : "unique"]
        .concat(w.infusions.map((i) => i.name))
        .join(" "),
    ),
  }));

  const byTypeThenName = (a, b) =>
    model.weaponTypeOrder.get(a.type) - model.weaponTypeOrder.get(b.type) || a.name.localeCompare(b.name);
  const browseOrder = model.weapons.slice().sort(byTypeThenName);

  function search(query) {
    const q = normalize(query);
    if (!q) return { grouped: true, weapons: browseOrder };
    const tokens = q.split(" ");
    const hits = [];
    for (const entry of searchIndex) {
      if (!tokens.every((t) => entry.haystack.includes(t))) continue;
      let rank = 3;
      if (entry.name === q) rank = 0;
      else if (entry.name.startsWith(q)) rank = 1;
      else if (entry.name.split(" ").some((word) => word.startsWith(tokens[0]))) rank = 2;
      hits.push([rank, entry.weapon]);
    }
    hits.sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name));
    return { grouped: false, weapons: hits.map((h) => h[1]) };
  }

  let options = [];
  let active = -1;

  function openList(query) {
    const found = search(query);
    options = found.weapons;
    active = options.length ? 0 : -1;
    if (found.grouped) active = Math.max(0, options.indexOf(weapon));
    const html = [];
    if (!options.length) {
      html.push(
        `<li class="option-empty" role="presentation">No weapon matches “${esc(query)}”. Try part of its name or a weapon type, like “katana”.</li>`,
      );
    }
    let lastType = null;
    options.forEach((w, i) => {
      if (found.grouped && w.type !== lastType) {
        lastType = w.type;
        html.push(`<li class="option-more" role="presentation">${esc(w.typeName)}</li>`);
      }
      html.push(
        `<li class="option" role="option" id="opt-${w.index}" data-index="${w.index}" aria-selected="${i === active}">` +
          `<span class="option-name">${esc(w.name)}${w.dlc ? '<span class="badge">DLC</span>' : ""}</span>` +
          `<span class="option-type">${esc(w.typeName)}</span></li>`,
      );
    });
    els.list.innerHTML = html.join("");
    els.list.hidden = false;
    els.input.setAttribute("aria-expanded", "true");
    showActive();
  }

  function closeList() {
    els.list.hidden = true;
    els.input.setAttribute("aria-expanded", "false");
    els.input.removeAttribute("aria-activedescendant");
    active = -1;
  }

  function showActive() {
    const items = els.list.querySelectorAll(".option");
    items.forEach((li, i) => li.setAttribute("aria-selected", String(i === active)));
    const current = items[active];
    if (current) {
      els.input.setAttribute("aria-activedescendant", current.id);
      const top = current.offsetTop;
      const bottom = top + current.offsetHeight;
      if (top < els.list.scrollTop) els.list.scrollTop = top - 4;
      else if (bottom > els.list.scrollTop + els.list.clientHeight) els.list.scrollTop = bottom - els.list.clientHeight + 4;
    } else {
      els.input.removeAttribute("aria-activedescendant");
    }
  }

  function choose(w, { keepFocus = false } = {}) {
    if (!w) return;
    if (w !== weapon) {
      weapon = w;
      state.weapon = w.name;
      expanded.clear();
      saveState();
    }
    els.input.value = w.name;
    closeList();
    if (keepFocus) els.input.select();
    else els.input.blur();
    render();
  }

  els.input.addEventListener("focus", () => {
    els.input.select();
    openList("");
  });
  els.input.addEventListener("input", () => openList(els.input.value));
  els.input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (els.list.hidden) {
        openList(els.input.value === weapon.name ? "" : els.input.value);
        return;
      }
      if (!options.length) return;
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
      showActive();
    } else if (e.key === "Enter") {
      if (!els.list.hidden && active >= 0) {
        e.preventDefault();
        choose(options[active], { keepFocus: true });
      }
    } else if (e.key === "Escape") {
      if (!els.list.hidden) {
        e.preventDefault();
        closeList();
        els.input.value = weapon.name;
        els.input.select();
      }
    }
  });
  els.input.addEventListener("blur", () => {
    closeList();
    els.input.value = weapon.name;
  });
  els.list.addEventListener("mousedown", (e) => e.preventDefault()); // keep focus in the input
  els.list.addEventListener("click", (e) => {
    const li = e.target.closest(".option");
    if (li) choose(model.weapons[Number(li.dataset.index)]);
  });
  els.toggle.addEventListener("mousedown", (e) => e.preventDefault());
  els.toggle.addEventListener("click", () => {
    if (!els.list.hidden) closeList();
    else if (document.activeElement === els.input) openList("");
    else els.input.focus();
  });

  // ---- build inputs ---------------------------------------------------------------------

  els.level.addEventListener("input", () => {
    if (!weapon.maxLevel) return;
    state.level25 = E.convertLevel(Number(els.level.value), weapon.maxLevel, 25);
    saveState();
    render();
  });

  els.grip1.addEventListener("change", () => {
    state.twoHanded = false;
    saveState();
    render();
  });
  els.grip2.addEventListener("change", () => {
    state.twoHanded = true;
    saveState();
    render();
  });

  function setStat(attr, value) {
    state.stats[attr] = clampStat(value);
    state.sample = false;
    saveState();
    render();
  }

  for (const a of ATTRS) {
    const input = statInputs[a];
    input.addEventListener("input", () => {
      if (input.value.trim() === "") return; // let people clear the box while typing
      setStat(a, input.value);
    });
    input.addEventListener("blur", () => {
      input.value = state.stats[a];
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") input.blur();
    });
  }
  document.querySelectorAll(".steppers button").forEach((button) => {
    button.addEventListener("click", () => {
      const a = button.dataset.attr;
      setStat(a, state.stats[a] + Number(button.dataset.step));
    });
  });

  function setSort(sort) {
    state.sort = sort;
    saveState();
    render();
  }
  els.sortAr.addEventListener("click", () => setSort("ar"));
  els.sortGame.addEventListener("click", () => setSort("game"));

  els.body.addEventListener("click", (e) => {
    if (e.target.closest("a")) return;
    const row = e.target.closest("tr.row");
    if (!row) return;
    const aff = Number(row.dataset.aff);
    if (expanded.has(aff)) expanded.delete(aff);
    else expanded.add(aff);
    const hadFocus = !!e.target.closest(".inf-btn");
    render();
    if (hadFocus) els.body.querySelector(`tr.row[data-aff="${aff}"] .inf-btn`)?.focus();
  });

  // ---- rendering ------------------------------------------------------------------------

  function render() {
    const level = levelFor(weapon);
    const calcOptions = { stats: state.stats, level, twoHanded: state.twoHanded };
    const results = weapon.infusions.map((inf) => ({ inf, r: E.calculate(model, weapon, inf, calcOptions) }));
    const ranked = results.slice().sort((a, b) => b.r.total - a.r.total || results.indexOf(a) - results.indexOf(b));
    renderBuild(level, results[0].r);
    renderVerdict(results, ranked, level);
    renderTable(state.sort === "ar" ? ranked : results, ranked[0], level);
    renderLegend(results);
  }

  function renderBuild(level, sample) {
    if (document.activeElement !== els.input) els.input.value = weapon.name;

    const meta = [
      `<span>${esc(weapon.typeName)}</span>`,
      `<span>${weapon.infusable ? "Takes every infusion" : "Can't be infused"}</span>`,
      `<span>${upgradeMaterial(weapon)}</span>`,
    ];
    if (weapon.dlc) meta.push("<span>Shadow of the Erdtree</span>");
    if (weapon.wiki) {
      meta.push(`<a href="${esc(weapon.wiki)}" target="_blank" rel="noopener">Wiki page</a>`);
    }
    els.meta.innerHTML = meta.join("");

    els.level.max = String(weapon.maxLevel);
    els.level.value = String(level);
    els.level.disabled = weapon.maxLevel === 0;
    els.levelOut.textContent = `+${level}`;
    els.levelHint.textContent =
      weapon.maxLevel === 0
        ? "This weapon can't be upgraded."
        : `${upgradeMaterial(weapon)}, up to +${weapon.maxLevel}.`;

    const alwaysTwoHanded = !weapon.paired && E.getsTwoHandBonus(weapon, false);
    const shownTwoHanded = weapon.paired ? false : alwaysTwoHanded || state.twoHanded;
    els.grip1.checked = !shownTwoHanded;
    els.grip2.checked = shownTwoHanded;
    els.grip1.disabled = els.grip2.disabled = !!weapon.paired || alwaysTwoHanded;
    if (weapon.paired) {
      els.gripHint.textContent = "Paired weapons don't get the two-handed Strength bonus.";
    } else if (alwaysTwoHanded) {
      els.gripHint.textContent = `Bows are always held in two hands, so STR counts 1.5× (${state.stats.str} → ${sample.stats.str}).`;
    } else if (state.twoHanded) {
      els.gripHint.textContent = `Two-handing counts your STR as 1.5×: ${state.stats.str} → ${sample.stats.str}.`;
    } else {
      els.gripHint.textContent = "Two-handing counts your STR as 1.5×.";
    }

    for (const a of ATTRS) {
      if (document.activeElement !== statInputs[a]) statInputs[a].value = state.stats[a];
      const req = weapon.requirements[a] || 0;
      const unmet = sample.unmet.includes(a);
      statBoxes[a].classList.toggle("unmet", unmet);
      statInputs[a].setAttribute("aria-invalid", String(unmet));
      let text = req ? (unmet ? `Need ${req}` : `Req ${req}`) : "—";
      if (a === "str" && sample.twoHandBonus) text += `<br>2H: ${sample.stats.str}`;
      reqLabels[a].innerHTML = text;
      reqLabels[a].title = req
        ? `${weapon.name} requires ${req} ${ATTR_LONG[a]}${unmet ? ". Damage that scales with it takes a 40% penalty." : "."}`
        : `No ${ATTR_LONG[a]} requirement`;
    }
    els.sampleNote.hidden = !state.sample;
  }

  function barHTML(r, scaleTo) {
    return DMG.filter((t) => r.damage[t])
      .map((t) => {
        const width = Math.max(0, (r.damage[t].total / scaleTo) * 100);
        return `<span class="c-${t} ${t === "holy" ? "holy" : ""}" style="width:${width.toFixed(2)}%"></span>`;
      })
      .join("");
  }

  function spellTypes() {
    const types = [];
    if (weapon.sorcery) types.push("magic");
    if (weapon.incantation) types.push("holy");
    return types;
  }

  function renderVerdict(results, ranked, level) {
    const best = ranked[0];
    const r = best.r;
    const total = floor(r.total);
    const html = [];
    html.push(
      `<div class="verdict-label">${weapon.infusable ? "Best infusion at your stats" : "Attack rating at your stats"}</div>`,
    );
    html.push(
      `<div class="verdict-main"><p class="verdict-name">${esc(best.inf.name)}<span class="lvl">${plusLevel(level)}</span></p>` +
        `<div class="verdict-ar"><span class="num">${total}</span><span class="unit">AR</span></div></div>`,
    );
    if (r.total > 0) html.push(`<div class="bar big" aria-hidden="true">${barHTML(r, r.total)}</div>`);

    const split = DMG.filter((t) => r.damage[t]).map(
      (t) =>
        `<span class="key"><span class="swatch c-${t} ${t === "holy" ? "holy" : ""}"></span>${DMG_LABEL[t]} ${floor(r.damage[t].total)}</span>`,
    );
    for (const t of STATUS) {
      if (r.status[t]) split.push(`<span class="key"><span class="swatch c-${t}"></span>${STATUS_LABEL[t]} ${floor(r.status[t].total)}</span>`);
    }
    for (const t of spellTypes()) {
      split.push(`<span class="key">${SPELL_LABEL[t]} ${floor(r.spell[t].value)}</span>`);
    }
    if (split.length) html.push(`<p class="verdict-split">${split.join("")}</p>`);

    const notes = [];
    if (!weapon.infusable) {
      notes.push(`${esc(weapon.name)} can't be infused, so this is its only form.`);
    } else {
      const runnerUp = ranked[1];
      const gap = total - floor(runnerUp.r.total);
      if (gap === 0) {
        notes.push(`Tied with <strong>${esc(affinityName(runnerUp.inf))}</strong> (${floor(runnerUp.r.total)}).`);
      } else {
        notes.push(`<strong>+${gap}</strong> over ${esc(affinityName(runnerUp.inf))} (${floor(runnerUp.r.total)})`);
      }
      const standard = results.find((x) => x.inf.affinity === 0);
      if (standard && standard !== best && standard !== runnerUp) {
        notes.push(`<strong>+${total - floor(standard.r.total)}</strong> over Standard (${floor(standard.r.total)})`);
      }
    }
    notes.push(weapon.paired ? "paired, no two-handed bonus" : r.twoHandBonus ? "two-handed" : "one-handed");
    html.push(`<p class="verdict-notes">${notes.join(" · ")}</p>`);

    if (r.unmet.length) {
      const parts = r.unmet.map((a) => `${ATTR_SHORT[a]} ${r.stats[a]} (needs ${weapon.requirements[a]})`);
      let text = `Below the requirement: ${parts.join(", ")}. Damage that scales with a stat you don't meet loses its scaling and takes a 40% penalty.`;
      if (r.unmet.includes("str") && !r.twoHandBonus && !weapon.paired) {
        const twoHandStr = Math.floor(r.stats.str * 1.5);
        if (twoHandStr >= weapon.requirements.str) text += ` Two-handing would count your STR as ${twoHandStr}, which is enough.`;
      }
      html.push(`<p class="warn">${text}</p>`);
    }
    els.verdict.innerHTML = html.join("");
  }

  function renderTable(rows, best, level) {
    const all = weapon.infusions;
    const dmgCols = DMG.filter((t) => rows.some((x) => x.r.damage[t]));
    const statusCol = rows.some((x) => Object.keys(x.r.status).length);
    const scaleCols = ATTRS.filter((a) => rows.some((x) => x.r.scaling[a] > 0));
    const spellCols = spellTypes();
    const maxTotal = Math.max(1, ...rows.map((x) => x.r.total));
    const bestTotal = floor(best.r.total);
    const columnCount = 2 + dmgCols.length + spellCols.length + (statusCol ? 1 : 0) + scaleCols.length;

    els.caption.textContent = `Attack rating of every ${weapon.name} infusion at${plusLevel(level) || " +0"}`;

    const head = [`<tr><th class="col-inf" scope="col">${weapon.infusable ? "Infusion" : "Weapon"}</th>`];
    head.push(`<th class="col-ar" scope="col">Attack rating</th>`);
    dmgCols.forEach((t) => {
      head.push(
        `<th class="wide" scope="col" title="${DMG_LABEL[t]} attack"><span class="key"><span class="swatch c-${t} ${t === "holy" ? "holy" : ""}"></span>${DMG_SHORT[t]}</span></th>`,
      );
    });
    spellCols.forEach((t) => head.push(`<th scope="col" title="${SPELL_LABEL[t]}">${SPELL_SHORT[t]}</th>`));
    if (statusCol) head.push(`<th scope="col">Buildup</th>`);
    scaleCols.forEach((a, i) => {
      head.push(
        `<th class="wide col-scale${i === 0 ? " col-group-start" : ""}" scope="col" title="${ATTR_LONG[a]} scaling at${plusLevel(level) || " +0"}">${ATTR_SHORT[a].charAt(0)}${ATTR_SHORT[a].slice(1).toLowerCase()}</th>`,
      );
    });
    head.push("</tr>");
    els.head.innerHTML = head.join("");

    const body = [];
    for (const { inf, r } of rows) {
      const aff = inf.affinity;
      const isBest = weapon.infusable && inf === best.inf;
      const open = expanded.has(aff);
      const label = weapon.infusable ? affinityName(inf) : weapon.name;
      const total = floor(r.total);
      const delta = total - bestTotal;
      body.push(`<tr class="row${isBest ? " best" : ""}" data-aff="${aff}">`);
      body.push(
        `<th class="col-inf" scope="row"><button type="button" class="inf-btn" aria-expanded="${open}" aria-controls="det-${aff + 1}" title="${esc(inf.name)}${plusLevel(level)}: show the damage breakdown">` +
          `<span class="chev" aria-hidden="true"></span>${esc(label)}</button>${isBest ? '<span class="tag tag-best">Best</span>' : ""}</th>`,
      );
      body.push(
        `<td class="col-ar"><div class="ar-line"><span class="ar-num">${total}</span>` +
          `${weapon.infusable && delta < 0 ? `<span class="ar-delta">${delta.toString().replace("-", "−")}</span>` : ""}</div>` +
          `<div class="bar" aria-hidden="true">${barHTML(r, maxTotal)}</div></td>`,
      );
      dmgCols.forEach((t) => {
        const d = r.damage[t];
        if (!d) body.push(`<td class="wide"><span class="none">–</span></td>`);
        else if (d.ineffective) {
          body.push(`<td class="wide"><span class="ineffective" title="Requirement not met: 40% penalty">${floor(d.total)}</span></td>`);
        } else body.push(`<td class="wide">${floor(d.total)}</td>`);
      });
      spellCols.forEach((t) => {
        const s = r.spell[t];
        body.push(`<td><span class="${s.ineffective ? "ineffective" : ""}">${floor(s.value)}</span></td>`);
      });
      if (statusCol) {
        const chips = STATUS.filter((t) => r.status[t]).map(
          (t) =>
            `<span class="chip c-${t}${r.status[t].ineffective ? " ineffective" : ""}" title="${STATUS_LABEL[t]} buildup">${STATUS_LABEL[t]} ${floor(r.status[t].total)}</span>`,
        );
        body.push(`<td>${chips.length ? `<span class="chips">${chips.join("")}</span>` : '<span class="none">–</span>'}</td>`);
      }
      scaleCols.forEach((a, i) => {
        const grade = E.scalingGrade(model, r.scaling[a]);
        body.push(
          `<td class="wide col-scale${i === 0 ? " col-group-start" : ""}" title="${ATTR_LONG[a]} scaling ${(r.scaling[a] * 100).toFixed(1)}">${grade || '<span class="none">–</span>'}</td>`,
        );
      });
      body.push("</tr>");
      body.push(
        `<tr class="details" id="det-${aff + 1}"${open ? "" : " hidden"}><td colspan="${columnCount}">${open ? breakdownHTML(inf, r, level) : ""}</td></tr>`,
      );
    }
    els.body.innerHTML = body.join("");

    els.sortAr.setAttribute("aria-pressed", String(state.sort === "ar"));
    els.sortGame.setAttribute("aria-pressed", String(state.sort === "game"));
    els.sortAr.parentElement.hidden = all.length < 2;
  }

  function breakdownHTML(inf, r, level) {
    const attrs = ATTRS.filter((a) => r.scaling[a] > 0 || weapon.requirements[a]);
    const head = ["<tr><th scope=\"col\"></th><th scope=\"col\">Base</th>"];
    attrs.forEach((a) => {
      const grade = E.scalingGrade(model, r.scaling[a]);
      head.push(
        `<th scope="col" title="${ATTR_LONG[a]} ${r.stats[a]}, scaling ${grade || "none"}">${ATTR_SHORT[a]} ${r.stats[a]}${grade ? ` · ${grade}` : ""}</th>`,
      );
    });
    head.push('<th scope="col">Total</th></tr>');

    const rowHTML = (label, base, parts, ineffective, total, factor = 1) => {
      const cells = [`<tr><th scope="row">${label}</th><td>${oneDecimal(base)}</td>`];
      if (ineffective) {
        cells.push(`<td class="penalty" colspan="${attrs.length}">Requirement not met: −40% instead of scaling</td>`);
      } else {
        attrs.forEach((a) => {
          const p = parts[a];
          cells.push(p ? `<td>+${oneDecimal(p.curve * p.scaling * factor)}</td>` : '<td><span class="none">–</span></td>');
        });
      }
      cells.push(`<td class="total">${floor(total)}</td></tr>`);
      return cells.join("");
    };

    const rows = [];
    for (const t of DMG) {
      const d = r.damage[t];
      if (d) rows.push(rowHTML(DMG_LABEL[t], d.base, d.parts, d.ineffective, d.total, d.base));
    }
    for (const t of STATUS) {
      const s = r.status[t];
      if (s) rows.push(rowHTML(`${STATUS_LABEL[t]} buildup`, s.base, s.parts, s.ineffective, s.total, s.base));
    }
    for (const t of spellTypes()) {
      const s = r.spell[t];
      rows.push(rowHTML(SPELL_LABEL[t], 100, s.parts, s.ineffective, s.value, 100));
    }

    const notes = [];
    const reqs = ATTRS.filter((a) => weapon.requirements[a]).map((a) => `${ATTR_SHORT[a]} ${weapon.requirements[a]}`);
    notes.push(reqs.length ? `Requires ${reqs.join(", ")}.` : "No stat requirements.");
    if (r.twoHandBonus) notes.push(`STR counts as ${r.stats.str} two-handed.`);
    const scaling = attrs
      .filter((a) => r.scaling[a] > 0)
      .map((a) => `${ATTR_SHORT[a]} ${(r.scaling[a] * 100).toFixed(1)}`);
    if (scaling.length) notes.push(`Scaling values at${plusLevel(level) || " +0"}: ${scaling.join(", ")}.`);
    if (Object.values(r.status).some((s) => !s.parts.arc && !s.ineffective)) {
      notes.push("Frost, scarlet rot and death blight never scale. Bleed, poison, sleep and madness scale with Arcane only when the weapon has Arcane scaling.");
    }

    return (
      `<div class="details-inner"><p class="details-title">${esc(inf.name)}${plusLevel(level)}</p>` +
      `<div class="breakdown-wrap"><table class="breakdown"><thead>${head.join("")}</thead><tbody>${rows.join("")}</tbody></table></div>` +
      `<p class="details-notes">${notes.join(" ")}</p></div>`
    );
  }

  function renderLegend(results) {
    const keys = [];
    DMG.forEach((t) => {
      if (results.some((x) => x.r.damage[t])) {
        keys.push(`<span class="key"><span class="swatch c-${t} ${t === "holy" ? "holy" : ""}"></span>${DMG_LABEL[t]}</span>`);
      }
    });
    STATUS.forEach((t) => {
      if (results.some((x) => x.r.status[t])) keys.push(`<span class="key"><span class="swatch c-${t}"></span>${STATUS_LABEL[t]}</span>`);
    });
    els.legendKeys.innerHTML = keys.join("");

    const extra = [];
    if (RANGED_TYPES.has(weapon.type)) extra.push("Bow and crossbow attack rating doesn't include ammunition, which adds its own damage in game.");
    if (weapon.sorcery || weapon.incantation) {
      extra.push("Spell scaling is the casting tool's spell power: 100 means no bonus, 300 means spells hit three times as hard as their base.");
    }
    els.legendExtra.textContent = extra.join(" ");
    els.legendExtra.hidden = !extra.length;
  }

  render();
})();
