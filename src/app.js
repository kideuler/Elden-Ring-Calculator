/* Elden Ring Infusion Calculator: page logic. Needs window.ArEngine and the #weapon-db, #boss-db, #attack-db and #talisman-db JSON. */
(function () {
  "use strict";

  const E = window.ArEngine;
  const readJson = (id) => JSON.parse(document.getElementById(id).textContent);
  const db = readJson("weapon-db");
  const model = E.createModel(db);
  const bossDb = readJson("boss-db");
  const bossById = new Map(bossDb.bosses.map((b) => [b.id, b]));
  const attackDb = readJson("attack-db");
  const talismanDb = readJson("talisman-db");
  const talismanByName = new Map(talismanDb.talismans.map((t) => [t.name, t]));
  const ATTRS = E.ATTRIBUTES;
  const STATS = ATTRS.concat(["end"]); // the attributes people enter: Endurance sets stamina
  const DMG = E.DAMAGE_TYPES;
  const STATUS = E.STATUS_TYPES;

  const ATTR_SHORT = { str: "STR", dex: "DEX", int: "INT", fai: "FAI", arc: "ARC", end: "END" };
  const ATTR_LONG = { str: "Strength", dex: "Dexterity", int: "Intelligence", fai: "Faith", arc: "Arcane", end: "Endurance" };
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
  const PHYS_LABEL = { standard: "Standard", slash: "Slash", strike: "Strike", pierce: "Pierce" };
  const NEG_TYPES = ["standard", "slash", "strike", "pierce", "magic", "fire", "lightning", "holy"];
  const NEG_LABEL = { ...PHYS_LABEL, magic: "Magic", fire: "Fire", lightning: "Lightning", holy: "Holy" };
  const BOSS_STATUS = ["bleed", "frost", "poison", "rot", "sleep", "madness"];
  const GRIP_LABEL = { "1h": "One-handed", "2h": "Two-handed" };
  const TALISMAN_SLOTS = 4;
  const TALISMAN_CATEGORIES = [
    ["attributes", "Attributes"],
    ["attack", "Attack"],
    ["fight", "During the fight"],
    ["stamina", "Stamina"],
  ];

  // The usual physical damage type of each weapon class, for weapons without moveset data
  // (each attack in the moveset data has its own type)
  const PHYSICAL_BY_CLASS = {};
  const classTypes = {
    slash: ["Dagger", "Throwing Blade", "Curved Sword", "Curved Greatsword", "Backhand Blade", "Katana", "Great Katana", "Twinblade", "Reaper", "Claw", "Beast Claw"],
    pierce: ["Thrusting Sword", "Heavy Thrusting Sword", "Spear", "Great Spear", "Light Bow", "Bow", "Greatbow", "Crossbow", "Ballista", "Thrusting Shield"],
    strike: ["Hammer", "Great Hammer", "Flail", "Colossal Weapon", "Fist", "Hand-to-Hand Art", "Torch", "Glintstone Staff", "Sacred Seal", "Dual Catalyst", "Small Shield", "Medium Shield", "Greatshield"],
  };
  for (const [type, classes] of Object.entries(classTypes)) for (const c of classes) PHYSICAL_BY_CLASS[c] = type;

  const STORAGE_KEY = "er-infusion-calculator:v1";
  const DEFAULT_STATE = {
    weapon: "Uchigatana",
    stats: { str: 18, dex: 40, int: 9, fai: 10, arc: 9, end: 25 },
    level25: 25, // upgrade level on the regular +25 scale; somber weapons convert it to +10
    sort: "ar", // "ar": best first (by AR, or by kill time when a boss is picked); "game": in-game order
    sample: true, // true while the attributes are still the example ones
    boss: "", // boss id, or "" to rank by attack rating
    talismans: ["", "", "", ""], // talisman names, "" for an empty slot
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
    statHint: $("stat-hint"),
    sampleNote: $("sample-note"),
    talismans: Array.from({ length: TALISMAN_SLOTS }, (_, i) => $(`talisman-${i + 1}`)),
    talismanEffects: $("talisman-effects"),
    verdict: $("verdict"),
    sortAr: $("sort-ar"),
    sortGame: $("sort-game"),
    title: $("results-title"),
    caption: $("ledger-caption"),
    head: $("ledger-head"),
    body: $("ledger-body"),
    legendKeys: $("legend-keys"),
    legendAr: $("legend-ar"),
    legendExtra: $("legend-extra"),
    legendBoss: $("legend-boss"),
    boss: $("boss"),
    bossHint: $("boss-hint"),
    bossCard: $("boss-card"),
  };
  const statInputs = {};
  const statBoxes = {};
  const reqLabels = {};
  for (const a of STATS) {
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
  const fmt = (n) => Math.round(n).toLocaleString("en-US");
  const pad2 = (n) => String(Math.floor(n)).padStart(2, "0");
  /** A duration in words: "31 s", "2 min 32 s" */
  const fmtTime = (s) => {
    const whole = Math.round(s);
    if (whole < 60) return `${whole} s`;
    if (whole < 3600) return `${Math.floor(whole / 60)} min ${pad2(whole % 60)} s`;
    return `${Math.floor(whole / 3600)} h ${pad2((whole % 3600) / 60)} min`;
  };
  /** A duration as a clock, for tables: "0:31", "2:32" */
  const fmtClock = (s) => {
    const whole = Math.round(s);
    return whole < 3600 ? `${Math.floor(whole / 60)}:${pad2(whole % 60)}` : `${Math.floor(whole / 3600)}:${pad2((whole % 3600) / 60)}:${pad2(whole % 60)}`;
  };
  const fmtSeconds = (s) => `${Number(s.toFixed(2))} s`;
  const fmtNeg = (n) => `${n < 0 ? "−" : ""}${Math.abs(Math.round(n * 100) / 100)}%`;
  const fmtDps = (dps) => (dps > 0 ? (dps < 20 ? dps.toFixed(1) : fmt(dps)) : "–");
  const percent = (v) => `${Math.round(v * 100)}%`;
  const percentMore = (a, b) => (a / b - 1) * 100;
  const fmtCount = (n) => (n >= 10 || Number.isInteger(n) ? String(Math.round(n)) : n.toFixed(1));
  const listText = (items) => (items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);
  const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);
  const canKill = (sim) => Number.isFinite(sim.seconds);
  const killSeconds = (sim) => (canKill(sim) ? sim.seconds : Number.MAX_VALUE);
  const rangeClock = (sim) => `${fmtClock(sim.seconds)} (${fmtClock(sim.p10)}–${fmtClock(sim.p90)})`;
  const mvText = (mvs) => mvs.map((v) => Number(v.toFixed(1))).join(" + ");
  const stringLabel = (p) => `${p.attacks}× ${p.label}`;

  // ---- movesets, talismans and fights ------------------------------------------------------

  const typeOf = (w) => PHYSICAL_BY_CLASS[w.typeName] || "standard";
  const movesetOf = (w) => attackDb.movesets[attackDb.weapons[w.name]] || null;
  const alwaysTwoHanded = (w) => !w.paired && E.getsTwoHandBonus(w, false);
  const canChooseGrip = (w) => !w.paired && !alwaysTwoHanded(w);

  /** How much room a boss leaves to attack: its tempo class with the shared spread. */
  function tempoOf(boss) {
    const { classes, shape, spread } = bossDb.meta.tempo;
    const c = classes[boss.tempo] || classes.standard;
    return { ...c, shape, spread };
  }

  // The same random fights for everything fought against one boss, so results can be compared
  const fightsByBoss = new Map();
  function fightsFor(boss) {
    if (!fightsByBoss.has(boss.id)) {
      let seed = 2166136261;
      for (const c of boss.id) seed = Math.imul(seed ^ c.charCodeAt(0), 16777619);
      fightsByBoss.set(boss.id, E.createFights(tempoOf(boss), { seed: seed >>> 0 }));
    }
    return fightsByBoss.get(boss.id);
  }

  /** The talismans in the slots, skipping empty ones. */
  const chosenTalismans = () => state.talismans.map((name) => talismanByName.get(name)).filter(Boolean);
  const conflicts = (a, b) => a === b || (!!a.group && a.group === b.group);

  function loadState() {
    const s = JSON.parse(JSON.stringify(DEFAULT_STATE));
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (saved && typeof saved === "object") {
        if (typeof saved.weapon === "string" && model.byName.has(saved.weapon)) s.weapon = saved.weapon;
        if (saved.stats && typeof saved.stats === "object") {
          for (const a of STATS) if (saved.stats[a] != null) s.stats[a] = clampStat(saved.stats[a]);
        }
        if (Number.isFinite(Number(saved.level25))) s.level25 = Math.max(0, Math.min(25, Math.floor(saved.level25)));
        s.sort = saved.sort === "game" ? "game" : "ar";
        s.sample = saved.sample !== false;
        if (typeof saved.boss === "string" && bossById.has(saved.boss)) s.boss = saved.boss;
        if (Array.isArray(saved.talismans)) {
          // Keep what can be worn together: known names, one of each, one version per talisman
          const kept = [];
          saved.talismans.slice(0, TALISMAN_SLOTS).forEach((name, slot) => {
            const t = talismanByName.get(name);
            if (!t || kept.some((other) => conflicts(other, t))) return;
            kept.push(t);
            s.talismans[slot] = t.name;
          });
        }
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

  // Fighting a boss takes a moment, so changes that arrive in a stream (dragging the level
  // slider, holding a stepper) wait for a pause before the page is worked out again
  let renderTimer = 0;
  function renderSoon() {
    clearTimeout(renderTimer);
    if (!state.boss) return render();
    renderTimer = setTimeout(render, 70);
  }

  els.level.addEventListener("input", () => {
    if (!weapon.maxLevel) return;
    state.level25 = E.convertLevel(Number(els.level.value), weapon.maxLevel, 25);
    els.levelOut.textContent = `+${els.level.value}`;
    saveState();
    renderSoon();
  });

  function setStat(attr, value) {
    state.stats[attr] = clampStat(value);
    state.sample = false;
    saveState();
    renderSoon();
  }

  for (const a of STATS) {
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
      statInputs[a].value = clampStat(state.stats[a] + Number(button.dataset.step));
      setStat(a, statInputs[a].value);
    });
  });

  // ---- talismans and boss ------------------------------------------------------------------

  els.talismans.forEach((select, slot) => {
    select.append(new Option("Empty slot", ""));
    for (const [category, label] of TALISMAN_CATEGORIES) {
      const group = document.createElement("optgroup");
      group.label = label;
      for (const t of talismanDb.talismans) if (t.category === category) group.append(new Option(t.name, t.name));
      select.append(group);
    }
    select.addEventListener("change", () => {
      state.talismans[slot] = select.value;
      saveState();
      render();
    });
  });

  for (const [label, dlc] of [["Base game", false], ["Shadow of the Erdtree", true]]) {
    const group = document.createElement("optgroup");
    group.label = label;
    for (const b of bossDb.bosses) if (b.dlc === dlc) group.append(new Option(b.label, b.id));
    els.boss.append(group);
  }

  els.boss.addEventListener("change", () => {
    state.boss = els.boss.value;
    saveState();
    render();
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

  // On wide screens the build panel is sticky; when it's taller than the window it sticks by its
  // bottom edge instead, so the boss picker stays reachable (styles.css reads --build-h)
  const buildPanel = document.querySelector(".build");
  if (window.ResizeObserver) {
    new ResizeObserver(() => buildPanel.style.setProperty("--build-h", `${buildPanel.offsetHeight}px`)).observe(buildPanel);
  }

  /**
   * Work everything out from the four inputs and draw it. Each entry of `results` is one
   * infusion: `one` and `two` are its attack rating one- and two-handed (two is null when the
   * weapon has no choice of grip), and with a boss `row` is its fight (see E.rankInfusions),
   * `sim` the fight in the faster grip and `r` the attack rating in that grip.
   */
  function render() {
    clearTimeout(renderTimer);
    const level = levelFor(weapon);
    const boss = bossById.get(state.boss) || null;
    const talismans = chosenTalismans();
    const effects = E.talismanEffects(talismans);
    const stats = E.boostedStats(state.stats, effects);
    const build = { level, talismans, effects, stats, stamina: E.staminaFor(stats.end, effects.stamina) };
    const calc = (inf, twoHanded) => E.calculate(model, weapon, inf, { stats, level, twoHanded });

    const fight = boss
      ? E.rankInfusions(model, weapon, {
          stats: state.stats,
          level,
          boss,
          tempo: tempoOf(boss),
          moveset: movesetOf(weapon),
          physicalType: typeOf(weapon),
          talismans,
          fights: fightsFor(boss),
        })
      : null;

    const results = weapon.infusions.map((inf, i) => {
      const one = calc(inf, false);
      const two = canChooseGrip(weapon) ? calc(inf, true) : null;
      const row = fight ? fight.rows[i] : null;
      return { inf, one, two, row, sim: row ? row.sim : null, r: row ? row.result : one };
    });
    const gameOrder = (a, b) => results.indexOf(a) - results.indexOf(b);
    const ranked = results
      .slice()
      .sort(
        boss
          ? (a, b) => killSeconds(a.sim) - killSeconds(b.sim) || b.r.total - a.r.total || gameOrder(a, b)
          : (a, b) => b.one.total - a.one.total || gameOrder(a, b),
      );

    renderBuild(build, results[0].one);
    renderTalismans(talismans);
    renderBoss(boss);
    if (boss) renderFightVerdict(boss, results, ranked, build, fight);
    else renderVerdict(results, ranked, build);
    renderTable(state.sort === "ar" ? ranked : results, ranked[0], build, boss, fight);
    renderLegend(results, boss, fight);
  }

  function renderBuild(build, sample) {
    const { level, effects, stats, stamina } = build;
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

    for (const a of STATS) {
      if (document.activeElement !== statInputs[a]) statInputs[a].value = state.stats[a];
      const req = weapon.requirements[a] || 0;
      const unmet = sample.unmet.includes(a);
      const bonus = effects.stats[a];
      statBoxes[a].classList.toggle("unmet", unmet);
      statInputs[a].setAttribute("aria-invalid", String(unmet));
      const lines = [req ? (unmet ? `Need ${req}` : `Req ${req}`) : "—"];
      if (bonus) lines.push(`+${bonus} = ${stats[a]}`);
      reqLabels[a].innerHTML = lines.join("<br>");
      const notes = [];
      if (a === "end") notes.push("Endurance sets your stamina, which limits how many attacks fit in one opening");
      else notes.push(req ? `${weapon.name} requires ${req} ${ATTR_LONG[a]}${unmet ? ". Damage that scales with it takes a 40% penalty" : ""}` : `No ${ATTR_LONG[a]} requirement`);
      if (bonus) notes.push(`Talismans add ${bonus}, for ${stats[a]}`);
      reqLabels[a].title = `${notes.join(". ")}.`;
    }
    const hint = [`${stamina} stamina at ${stats.end} Endurance.`];
    if (canChooseGrip(weapon) && weapon.requirements.str) {
      hint.push(`Two-handing counts Strength as ${Math.floor(stats.str * 1.5)}.`);
    }
    els.statHint.textContent = hint.join(" ");
    els.sampleNote.hidden = !state.sample;
  }

  function renderTalismans(talismans) {
    els.talismans.forEach((select, slot) => {
      const others = state.talismans.filter((name, i) => i !== slot && name).map((name) => talismanByName.get(name));
      for (const option of select.options) {
        const t = talismanByName.get(option.value);
        option.disabled = !!t && others.some((other) => conflicts(other, t));
      }
      select.value = state.talismans[slot];
    });
    els.talismanEffects.hidden = !talismans.length;
    els.talismanEffects.innerHTML = talismans.map((t) => `<li><strong>${esc(t.name)}</strong> ${esc(t.effect)}</li>`).join("");
  }

  function renderBoss(boss) {
    els.boss.value = state.boss;
    els.bossHint.hidden = !!boss;
    els.bossCard.hidden = !boss;
    els.bossCard.innerHTML = boss ? bossCardHTML(boss) : "";
  }

  function bossCardHTML(boss) {
    const html = [];
    const meta = [`<span>${esc(boss.location)}</span>`, `<span>${boss.dlc ? "Shadow of the Erdtree" : "Base game"}</span>`];
    if (boss.wiki) meta.push(`<a href="${esc(boss.wiki)}" target="_blank" rel="noopener">Wiki page</a>`);
    html.push(`<p class="weapon-meta">${meta.join("")}</p>`);

    // Most bosses defend equally against every type; a few armored ones don't
    const defense = DMG.map((t) => boss.defense[t]);
    const defenseHTML = defense.every((d) => d === defense[0])
      ? String(defense[0])
      : DMG.map(
          (t) =>
            `<span class="key" title="${DMG_LABEL[t]} defense"><span class="swatch c-${t}${t === "holy" ? " holy" : ""}"></span>${boss.defense[t]}</span>`,
        ).join(" ");
    html.push(
      `<dl class="boss-stats"><div><dt>HP</dt><dd>${fmt(boss.hp)}</dd></div><div><dt>Defense</dt><dd>${defenseHTML}</dd></div></dl>`,
    );

    const cells = NEG_TYPES.map((t) => {
      const n = boss.negation[t];
      const classes = ["neg", `c-${E.PHYSICAL_TYPES.includes(t) ? "physical" : t}`];
      if (n < 0) classes.push("weak");
      else if (n >= 40) classes.push("resists");
      const effect = n < 0 ? `takes ${-n}% extra` : n > 0 ? `${n}% is negated` : "no negation";
      return (
        `<div class="${classes.join(" ")}" title="${esc(`${NEG_LABEL[t]} damage: ${effect}`)}"><dt>${NEG_LABEL[t]}</dt>` +
        `<dd>${fmtNeg(n)}</dd></div>`
      );
    });
    html.push(`<p class="boss-sub">Damage negation</p><dl class="neg-grid">${cells.join("")}</dl>`);

    // The whole resistance ladder, written like the wiki: buildup for the 1st proc / 2nd / ...
    const rows = BOSS_STATUS.map((t) => {
      const thresholds = boss.status[t];
      const value = thresholds ? thresholds.map(fmt).join(" / ") : "Immune";
      return `<div class="c-${t}${thresholds ? "" : " immune"}"><dt>${STATUS_LABEL[t]}</dt><dd>${value}</dd></div>`;
    });
    html.push(`<p class="boss-sub">Buildup needed, proc by proc</p><dl class="resist">${rows.join("")}</dl>`);

    const notes = [];
    const example = BOSS_STATUS.find((t) => boss.status[t] && boss.status[t].length > 1);
    if (example) {
      const [first, second] = boss.status[example];
      notes.push(
        `Resistance rises with every proc: the first ${STATUS_LABEL[example].toLowerCase()} proc takes ${fmt(first)} buildup, ` +
          `the second ${fmt(second)}, and so on. After the last value, every proc needs that much.`,
      );
    } else if (BOSS_STATUS.some((t) => boss.status[t])) {
      notes.push("This boss's resistance doesn't rise between procs.");
    }
    if (boss.status.bleed || boss.status.frost) {
      notes.push(`Bleed and frost procs deal ${Math.round(boss.statusDamage * 100)}% of their usual damage to this boss.`);
    }
    html.push(`<p class="boss-note">${notes.join(" ")}</p>`);

    const tempo = tempoOf(boss);
    html.push(
      `<p class="boss-sub">Room to attack</p><p class="boss-note"><strong>${esc(tempo.label)}.</strong> ${esc(tempo.description)} ` +
        `Counted as openings of about ${fmtSeconds(tempo.opening)}, one every ${fmtSeconds(tempo.opening + tempo.gap)} or so. ` +
        `This is an estimate, not game data.</p>`,
    );
    return html.join("");
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

  function renderVerdict(results, ranked, build) {
    const best = ranked[0];
    const r = best.one;
    const total = floor(r.total);
    const html = [];
    html.push(
      `<div class="verdict-label">${weapon.infusable ? "Best infusion at your attributes" : "Attack rating at your attributes"}</div>`,
    );
    html.push(
      `<div class="verdict-main"><p class="verdict-name">${esc(best.inf.name)}<span class="lvl">${plusLevel(build.level)}</span></p>` +
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
      const gap = total - floor(runnerUp.one.total);
      if (gap === 0) {
        notes.push(`Tied with <strong>${esc(affinityName(runnerUp.inf))}</strong> (${floor(runnerUp.one.total)}).`);
      } else {
        notes.push(`<strong>+${gap}</strong> over ${esc(affinityName(runnerUp.inf))} (${floor(runnerUp.one.total)})`);
      }
      const standard = results.find((x) => x.inf.affinity === 0);
      if (standard && standard !== best && standard !== runnerUp) {
        notes.push(`<strong>+${total - floor(standard.one.total)}</strong> over Standard (${floor(standard.one.total)})`);
      }
    }
    if (weapon.paired) notes.push("paired, no two-handed bonus");
    else if (r.twoHandBonus) notes.push("always held in two hands");
    else if (best.two && floor(best.two.total) !== total) notes.push(`one-handed; <strong>${floor(best.two.total)}</strong> two-handed`);
    else notes.push("the same in either grip");
    html.push(`<p class="verdict-notes">${notes.join(" · ")}</p>`);
    html.push(unmetWarning(r));
    els.verdict.innerHTML = html.join("");
  }

  function unmetWarning(r) {
    if (!r.unmet.length) return "";
    const parts = r.unmet.map((a) => `${ATTR_SHORT[a]} ${r.stats[a]} (needs ${weapon.requirements[a]})`);
    let text = `Below the requirement: ${parts.join(", ")}. Damage that scales with an attribute you don't meet loses its scaling and takes a 40% penalty.`;
    if (r.unmet.includes("str") && !r.twoHandBonus && !weapon.paired) {
      const twoHandStr = Math.floor(r.stats.str * 1.5);
      if (twoHandStr >= weapon.requirements.str) text += ` Two-handing would count your Strength as ${twoHandStr}, which is enough.`;
    }
    return `<p class="warn">${text}</p>`;
  }

  /** Where a fight's damage came from on average: the hits, split by damage type, then each status. */
  function damageParts(sim) {
    const parts = [];
    for (const t of DMG) if (sim.direct[t] > 0) parts.push({ key: t, amount: sim.direct[t] });
    for (const t of E.DAMAGING_STATUS) if (sim.sources[t] > 0) parts.push({ key: t, amount: sim.sources[t] });
    return { parts, total: parts.reduce((sum, p) => sum + p.amount, 0) };
  }

  function partsBar({ parts, total }, scale) {
    if (!(total > 0)) return "";
    return parts
      .map((p) => {
        const width = (p.amount / total) * scale * 100;
        return `<span class="c-${p.key}${p.key === "holy" ? " holy" : ""}" style="width:${width.toFixed(2)}%"></span>`;
      })
      .join("");
  }

  /** "2× R1 (18%), 1× R1 (21%)": what a fighter most often does with an opening. */
  function planText(sim, count = 3) {
    return sim.plan
      .slice(0, count)
      .map((p) => `${stringLabel(p)} in ${percent(p.share)}`)
      .join(", ");
  }

  function renderFightVerdict(boss, results, ranked, build, fight) {
    const best = ranked[0];
    const { r, sim, row } = best;
    const count = fight.fights.count;
    const html = [];
    html.push(`<div class="verdict-label">${weapon.infusable ? "Best infusion against" : "Against"} ${esc(boss.name)}</div>`);
    html.push(
      `<div class="verdict-main"><p class="verdict-name">${esc(best.inf.name)}<span class="lvl">${plusLevel(build.level)}</span></p>` +
        `<div class="verdict-ar"><span class="num">${fmtDps(sim.dps)}</span><span class="unit">DPS</span></div></div>`,
    );
    const parts = damageParts(sim);
    if (parts.total > 0) html.push(`<div class="bar big" aria-hidden="true">${partsBar(parts, 1)}</div>`);

    const keys = parts.parts.map((p) => {
      const status = E.DAMAGING_STATUS.includes(p.key);
      const label = status ? STATUS_LABEL[p.key] : `${DMG_LABEL[p.key]} hits`;
      const procs = status && sim.procs[p.key] ? `, ${fmtCount(sim.procs[p.key])} procs a fight` : "";
      return `<span class="key"><span class="swatch c-${p.key}${p.key === "holy" ? " holy" : ""}"></span>${label} ${percent(p.amount / parts.total)}${procs}</span>`;
    });
    if (keys.length) html.push(`<p class="verdict-split">${keys.join("")}</p>`);

    if (!canKill(sim)) {
      html.push(`<p class="verdict-notes">This build can't bring ${esc(boss.name)} down.</p>`);
    } else {
      // How it fights
      const how = [];
      if (fight.generic) {
        how.push(`No moveset data for ${esc(weapon.name)}: counted as one ${PHYS_LABEL[typeOf(weapon)].toLowerCase()} hit at motion value 100 per second`);
      } else {
        how.push(`<strong>${GRIP_LABEL[row.grip]}</strong>${fight.grips.length > 1 ? "" : weapon.paired ? " (paired)" : ""}`);
        if (sim.plan.length) how.push(`an opening usually gets ${planText(sim)}`);
        if (sim.idle >= 0.005) how.push(`${percent(sim.idle)} of openings are too short to attack`);
      }
      html.push(`<p class="verdict-notes verdict-attack">${how.join(" · ")}</p>`);

      const notes = [
        `Kills in about <strong>${fmtTime(sim.seconds)}</strong>, between ${fmtTime(sim.p10)} and ${fmtTime(sim.p90)} in 8 of 10 fights, over about ${fmt(sim.openingsToKill)} openings`,
      ];
      if (weapon.infusable) {
        const runnerUp = ranked[1];
        if (runnerUp.sim.dps > 0) {
          const more = percentMore(sim.dps, runnerUp.sim.dps);
          const name = `${esc(affinityName(runnerUp.inf))} (${fmtDps(runnerUp.sim.dps)})`;
          notes.push(more < 1 ? `level with <strong>${name}</strong>` : `<strong>+${Math.round(more)}%</strong> DPS over ${name}`);
        }
        const others = ranked.filter((x) => x !== best && x.row.fastest >= 0.05).sort((a, b) => b.row.fastest - a.row.fastest);
        const rivals = others.slice(0, 2).map((x) => `${esc(affinityName(x.inf))} in ${percent(x.row.fastest)}`);
        notes.push(`first to kill in <strong>${percent(row.fastest)}</strong> of ${count} simulated fights${rivals.length ? ` (${rivals.join(", ")})` : ""}`);
        const topAr = results.reduce((a, b) => (b.r.total > a.r.total ? b : a));
        if (topAr !== best) notes.push(`highest AR: ${esc(affinityName(topAr.inf))} (${floor(topAr.r.total)} AR, ${fmtDps(topAr.sim.dps)} DPS)`);
      }
      html.push(`<p class="verdict-notes">${notes.join(" · ")}</p>`);

      const extras = [];
      for (const boost of sim.boosts) {
        if (boost.name === "Successive attacks") {
          extras.push(`The successive-attack bonus is up for ${percent(boost.share)} of hits (${percent(boost.top)} at its top stage)`);
        } else extras.push(`${esc(boost.name)} is active for ${percent(boost.share)} of hits`);
      }
      // A grease that would beat the best infusion is worth knowing about
      const greased = results.filter((x) => x.row.grease && x.row.grease.sim.dps > sim.dps * 1.005).sort((a, b) => b.row.grease.sim.dps - a.row.grease.sim.dps)[0];
      if (greased) {
        extras.push(
          `With ${esc(greased.row.grease.name)}, ${esc(affinityName(greased.inf))} would reach <strong>${fmtDps(greased.row.grease.sim.dps)}</strong> DPS`,
        );
      }
      if (extras.length) html.push(`<p class="verdict-notes">${extras.join(" · ")}.</p>`);
    }

    const immune = [...new Set(results.flatMap((x) => x.sim.immune))];
    if (immune.length) {
      const list = listText(immune.map((t) => STATUS_LABEL[t].toLowerCase()));
      html.push(`<p class="verdict-notes">${esc(boss.name)} is immune to ${list}, so that buildup adds nothing here.</p>`);
    }
    html.push(unmetWarning(r));
    els.verdict.innerHTML = html.join("");
  }

  function renderTable(rows, best, build, boss, fight) {
    const { level } = build;
    const all = weapon.infusions;
    const dmgCols = boss ? [] : DMG.filter((t) => rows.some((x) => x.one.damage[t]));
    const twoHandCol = !boss && rows.some((x) => x.two && floor(x.two.total) !== floor(x.one.total));
    const statusCol = rows.some((x) => Object.keys(x.r.status).length);
    const scaleCols = ATTRS.filter((a) => rows.some((x) => x.r.scaling[a] > 0));
    const spellCols = spellTypes();
    const maxTotal = Math.max(1, ...rows.map((x) => x.one.total));
    const maxDps = boss ? Math.max(1e-9, ...rows.map((x) => x.sim.dps)) : 0;
    const bestTotal = floor(best.one.total);
    const columnCount = 2 + (boss ? 1 : dmgCols.length + (twoHandCol ? 1 : 0)) + spellCols.length + (statusCol ? 1 : 0) + scaleCols.length;
    const at = plusLevel(level) || " +0";

    els.title.textContent = boss ? `DPS against ${boss.name}` : "Attack rating by infusion";
    els.caption.textContent = boss
      ? `Damage per second of every ${weapon.name} infusion at${at} against ${boss.name}`
      : `Attack rating of every ${weapon.name} infusion at${at}`;

    const head = [`<tr><th class="col-inf" scope="col">${weapon.infusable ? "Infusion" : "Weapon"}</th>`];
    if (boss) {
      head.push(`<th class="col-ar" scope="col" title="${esc(boss.name)}'s HP divided by the average time to kill it">DPS</th>`);
      head.push(`<th class="wide" scope="col" title="Attack rating in the grip it fights in">AR</th>`);
    } else {
      head.push(`<th class="col-ar" scope="col">Attack rating</th>`);
    }
    dmgCols.forEach((t) => {
      head.push(
        `<th class="wide" scope="col" title="${DMG_LABEL[t]} attack"><span class="key"><span class="swatch c-${t} ${t === "holy" ? "holy" : ""}"></span>${DMG_SHORT[t]}</span></th>`,
      );
    });
    if (twoHandCol) head.push(`<th class="wide" scope="col" title="Attack rating two-handed: Strength counts 1.5×">2H</th>`);
    spellCols.forEach((t) => head.push(`<th scope="col" title="${SPELL_LABEL[t]}">${SPELL_SHORT[t]}</th>`));
    if (statusCol) head.push(`<th scope="col"${boss ? ' title="Status procs in an average fight"' : ""}>${boss ? "Procs" : "Buildup"}</th>`);
    scaleCols.forEach((a, i) => {
      head.push(
        `<th class="wide col-scale${i === 0 ? " col-group-start" : ""}" scope="col" title="${ATTR_LONG[a]} scaling at${plusLevel(level) || " +0"}">${ATTR_SHORT[a].charAt(0)}${ATTR_SHORT[a].slice(1).toLowerCase()}</th>`,
      );
    });
    head.push("</tr>");
    els.head.innerHTML = head.join("");

    const body = [];
    for (const x of rows) {
      const { inf, r, sim } = x;
      const aff = inf.affinity;
      const isBest = weapon.infusable && inf === best.inf;
      const open = expanded.has(aff);
      const label = weapon.infusable ? affinityName(inf) : weapon.name;
      body.push(`<tr class="row${isBest ? " best" : ""}" data-aff="${aff}">`);
      body.push(
        `<th class="col-inf" scope="row"><button type="button" class="inf-btn" aria-expanded="${open}" aria-controls="det-${aff + 1}" title="${esc(inf.name)}${plusLevel(level)}: show the breakdown">` +
          `<span class="chev" aria-hidden="true"></span>${esc(label)}</button>${isBest ? '<span class="tag tag-best">Best</span>' : ""}</th>`,
      );
      if (boss) {
        const behind = best.sim.dps > 0 ? (1 - sim.dps / best.sim.dps) * 100 : 0;
        const delta = weapon.infusable && behind > 0 ? `<span class="ar-delta">−${behind < 1 ? "&lt;1" : Math.round(behind)}%</span>` : "";
        const lines = [];
        if (canKill(sim)) {
          lines.push(`${fight.generic ? "" : `${GRIP_LABEL[x.row.grip]} · `}<span title="Average time to kill, and the range 8 of 10 fights fall in">${rangeClock(sim)}</span>`);
          if (weapon.infusable && x.row.fastest >= 0.005) lines.push(`First to kill in ${percent(x.row.fastest)} of fights`);
        } else lines.push("Can't kill");
        const grease = x.row.grease;
        if (grease && grease.sim.dps > 0 && sim.dps > 0) {
          lines.push(`<span class="grease" title="${esc(`${grease.name}: +${grease.attack} ${grease.type} attack, kept on for the whole fight`)}">${esc(grease.name)}: ${fmtDps(grease.sim.dps)} (+${Math.round(percentMore(grease.sim.dps, sim.dps))}%)</span>`);
        }
        body.push(
          `<td class="col-ar"><div class="ar-line"><span class="ar-num">${fmtDps(sim.dps)}</span>${delta}</div>` +
            `<div class="bar" aria-hidden="true">${partsBar(damageParts(sim), sim.dps / maxDps)}</div>` +
            `<div class="kill">${lines.join("<br>")}</div></td>`,
        );
        body.push(`<td class="wide">${floor(r.total)}</td>`);
      } else {
        const total = floor(x.one.total);
        const delta = total - bestTotal;
        body.push(
          `<td class="col-ar"><div class="ar-line"><span class="ar-num">${total}</span>` +
            `${weapon.infusable && delta < 0 ? `<span class="ar-delta">${delta.toString().replace("-", "−")}</span>` : ""}</div>` +
            `<div class="bar" aria-hidden="true">${barHTML(x.one, maxTotal)}</div></td>`,
        );
      }
      dmgCols.forEach((t) => {
        const d = x.one.damage[t];
        if (!d) body.push(`<td class="wide"><span class="none">–</span></td>`);
        else if (d.ineffective) {
          body.push(`<td class="wide"><span class="ineffective" title="Requirement not met: 40% penalty">${floor(d.total)}</span></td>`);
        } else body.push(`<td class="wide">${floor(d.total)}</td>`);
      });
      if (twoHandCol) body.push(`<td class="wide">${x.two ? floor(x.two.total) : '<span class="none">–</span>'}</td>`);
      spellCols.forEach((t) => {
        const s = r.spell[t];
        body.push(`<td><span class="${s.ineffective ? "ineffective" : ""}">${floor(s.value)}</span></td>`);
      });
      if (statusCol) {
        const chips = STATUS.filter((t) => r.status[t]).map((t) => statusChip(t, r, sim, boss));
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
        `<tr class="details" id="det-${aff + 1}"${open ? "" : " hidden"}><td colspan="${columnCount}">${open ? breakdownHTML(x, build, boss, fight) : ""}</td></tr>`,
      );
    }
    els.body.innerHTML = body.join("");

    els.sortAr.textContent = boss ? "Fastest kill" : "Highest AR";
    els.sortAr.setAttribute("aria-pressed", String(state.sort === "ar"));
    els.sortGame.setAttribute("aria-pressed", String(state.sort === "game"));
    els.sortAr.parentElement.hidden = all.length < 2;
  }

  function statusChip(t, r, sim, boss) {
    const s = r.status[t];
    const ineffective = s.ineffective ? " ineffective" : "";
    const name = STATUS_LABEL[t];
    if (!boss) return `<span class="chip c-${t}${ineffective}" title="${name} buildup">${name} ${floor(s.total)}</span>`;
    if (!boss.status[t]) {
      return `<span class="chip c-${t} immune" title="${esc(boss.name)} is immune to ${name.toLowerCase()}">${name} immune</span>`;
    }
    const n = sim.procs[t] || 0;
    const dealt = sim.sources[t] > 0 ? `, ${percent(sim.sources[t] / boss.hp)} of the damage` : "";
    const title = `${name}: ${floor(s.total)} buildup a hit, ${fmtCount(n)} procs in an average fight${dealt}`;
    return `<span class="chip c-${t}${n ? "" : " zero"}${ineffective}" title="${esc(title)}">${name} ×${fmtCount(n)}</span>`;
  }

  function breakdownHTML(x, build, boss, fight) {
    const { level } = build;
    const { inf, r } = x;
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
    notes.push(reqs.length ? `Requires ${reqs.join(", ")}.` : "No attribute requirements.");
    if (r.twoHandBonus) notes.push(`STR counts as ${r.stats.str} two-handed.`);
    else if (x.two && floor(x.two.total) !== floor(r.total)) notes.push(`Two-handed it reaches ${floor(x.two.total)} AR.`);
    const added = ATTRS.filter((a) => build.effects.stats[a]).map((a) => `${ATTR_SHORT[a]} +${build.effects.stats[a]}`);
    if (added.length) notes.push(`Talismans add ${added.join(", ")}.`);
    const scaling = attrs
      .filter((a) => r.scaling[a] > 0)
      .map((a) => `${ATTR_SHORT[a]} ${(r.scaling[a] * 100).toFixed(1)}`);
    if (scaling.length) notes.push(`Scaling values at${plusLevel(level) || " +0"}: ${scaling.join(", ")}.`);
    if (Object.values(r.status).some((s) => !s.parts.arc && !s.ineffective)) {
      notes.push("Frost, scarlet rot and death blight never scale. Bleed, poison, sleep and madness scale with Arcane only when the weapon has Arcane scaling.");
    }

    const grip = boss && !fight.generic ? `, ${GRIP_LABEL[x.row.grip].toLowerCase()}` : "";
    return (
      `<div class="details-inner"><p class="details-title">${esc(inf.name)}${plusLevel(level)}${grip}</p>` +
      `<div class="breakdown-wrap"><table class="breakdown"><thead>${head.join("")}</thead><tbody>${rows.join("")}</tbody></table></div>` +
      `<p class="details-notes">${notes.join(" ")}</p>${boss ? fightHTML(x, boss, fight) : ""}${movesetHTML(x, boss, fight)}</div>`
    );
  }

  /** The boss half of a breakdown: the grips, what it does with an opening, one hit, the procs. */
  function fightHTML(x, boss, fight) {
    const { r, sim, row } = x;
    const dash = '<span class="none">–</span>';
    const html = [];

    // One- against two-handed
    const grips = Object.entries(row.grips);
    if (grips.length > 1) {
      const gripRows = grips.map(([grip, g]) => {
        const chosen = grip === row.grip;
        return (
          `<tr${chosen ? ' class="chosen"' : ""}><th scope="row">${GRIP_LABEL[grip]}${chosen ? '<span class="tag tag-best">Faster</span>' : ""}</th>` +
          `<td class="total">${fmtDps(g.sim.dps)}</td><td>${canKill(g.sim) ? rangeClock(g.sim) : "Can't kill"}</td>` +
          `<td>${floor(g.result.total)}</td><td>${percent(g.sim.idle)}</td></tr>`
        );
      });
      html.push(`<p class="details-sub">Against ${esc(boss.name)}, in each grip</p>`);
      html.push(
        `<div class="breakdown-wrap"><table class="breakdown attacks"><thead><tr><th scope="col">Grip</th><th scope="col">DPS</th>` +
          `<th scope="col" title="Average time to kill, and the range 8 of 10 fights fall in">Kill time</th><th scope="col">AR</th>` +
          `<th scope="col" title="Openings too short for any attack in this grip">Openings missed</th></tr></thead><tbody>${gripRows.join("")}</tbody></table></div>`,
      );
    }

    // What it does with an opening
    const picks = sim.plan.filter((p, i) => i < 6 && p.share >= 0.01);
    if (picks.length) {
      const pickRows = picks.map(
        (p) =>
          `<tr><th scope="row">${esc(stringLabel(p))}</th><td>${percent(p.share)}</td><td>${fmtSeconds(p.seconds)}</td>` +
          `<td>${p.stamina ? fmt(p.stamina) : dash}</td><td class="total">${fmt(p.damage)}</td></tr>`,
      );
      const shown = picks.reduce((sum, p) => sum + p.share, 0);
      const rest = 1 - shown - sim.idle;
      if (rest >= 0.01) pickRows.push(`<tr><th scope="row">Other strings</th><td>${percent(rest)}</td><td>${dash}</td><td>${dash}</td><td>${dash}</td></tr>`);
      if (sim.idle >= 0.005) pickRows.push(`<tr><th scope="row">Too short to attack</th><td>${percent(sim.idle)}</td><td>${dash}</td><td>${dash}</td><td>${dash}</td></tr>`);
      html.push(`<p class="details-sub">What it does with an opening${grips.length > 1 ? `, ${GRIP_LABEL[row.grip].toLowerCase()}` : ""}</p>`);
      html.push(
        `<div class="breakdown-wrap"><table class="breakdown attacks"><thead><tr><th scope="col">Attacks</th>` +
          `<th scope="col" title="Share of the boss's openings that get this string">Openings</th>` +
          `<th scope="col" title="From the first attack until you can dodge after the last">Takes</th>` +
          `<th scope="col" title="Stamina the string costs, of your ${fmt(fight.stamina)}">Stamina</th>` +
          `<th scope="col" title="Damage of the string's hits, before status procs">Damage</th></tr></thead><tbody>${pickRows.join("")}</tbody></table></div>`,
      );
    }

    // One hit of the attack it uses most, type by type
    const families = fight.families[row.grip];
    const used = sim.plan.length ? families.find((f) => f.id === sim.plan[0].id) : families[0];
    const step = used.steps[0];
    const multiplier = E.attackMultiplier(fight.effects, row.grip, used, step);
    const hit = E.hitDamage(r, boss, { motionValue: step.mvs[0], physicalType: step.type, multiplier, typeMultipliers: fight.effects.damage });
    const hitRows = [];
    for (const t of DMG) {
      const p = hit.perType[t];
      if (!p) continue;
      const label = t === "physical" ? `Physical (${PHYS_LABEL[step.type].toLowerCase()})` : DMG_LABEL[t];
      hitRows.push(
        `<tr><th scope="row">${label}</th><td>${floor(p.attack)}</td><td>${fmt(p.defense)}</td><td>${percent(p.defenseMultiplier)}</td>` +
          `<td>${fmtNeg(p.negation * 100)}</td><td class="total">${fmt(p.dealt)}</td></tr>`,
      );
    }
    if (hitRows.length > 1) {
      hitRows.push(`<tr><th scope="row">One hit</th><td></td><td></td><td></td><td></td><td class="total">${fmt(hit.total)}</td></tr>`);
    }
    const boosted = Math.abs(multiplier - 1) > 1e-9 || Object.keys(fight.effects.damage).length > 0;
    const hitName = step.name === "Hit" ? "One hit" : `One hit of ${step.name}`;
    html.push(`<p class="details-sub">${hitName}, motion value ${Number(step.mvs[0].toFixed(1))}${boosted ? ", with your talismans" : ""}</p>`);
    html.push(
      `<div class="breakdown-wrap"><table class="breakdown"><thead><tr><th scope="col"></th>` +
        `<th scope="col" title="Attack rating × motion value × talisman bonuses">Attack</th><th scope="col">Defense</th>` +
        `<th scope="col" title="Share of the attack left after defense">After defense</th><th scope="col">Negation</th>` +
        `<th scope="col">Damage</th></tr></thead><tbody>${hitRows.join("")}</tbody></table></div>`,
    );

    const statusRows = STATUS.filter((t) => r.status[t]).map((t) => {
      const thresholds = boss.status[t];
      const cells = [`<th scope="row">${STATUS_LABEL[t]}</th><td>${floor(r.status[t].total)}</td>`];
      if (!thresholds) cells.push(`<td>Immune</td><td>${dash}</td><td>${dash}</td>`);
      else {
        const share = E.STATUS_EFFECTS[t] ? percent((sim.sources[t] || 0) / boss.hp) : "not counted";
        cells.push(`<td>${thresholds.map(fmt).join(" / ")}</td><td>${fmtCount(sim.procs[t] || 0)}</td><td class="total">${share}</td>`);
      }
      return `<tr>${cells.join("")}</tr>`;
    });
    if (statusRows.length) {
      html.push(
        `<div class="breakdown-wrap"><table class="breakdown"><thead><tr><th scope="col"></th><th scope="col">Buildup a hit</th>` +
          `<th scope="col" title="Buildup for the 1st proc / 2nd / 3rd ...; procs after the last value need the last value">Needed per proc</th>` +
          `<th scope="col" title="Procs in an average fight">Procs a fight</th>` +
          `<th scope="col" title="Share of the boss's HP this status takes in an average fight">Of the damage</th></tr></thead><tbody>${statusRows.join("")}</tbody></table></div>`,
      );
    }

    const notes = [];
    if (canKill(sim)) {
      notes.push(
        `Over ${fight.fights.count} simulated fights it takes ${esc(boss.name)}'s ${fmt(boss.hp)} HP in ${fmtTime(sim.seconds)} on average ` +
          `(${fmtTime(sim.p10)} to ${fmtTime(sim.p90)} in 8 of 10), with about ${fmt(sim.hits)} hits over ${fmt(sim.openingsToKill)} openings: ${fmtDps(sim.dps)} damage per second.`,
      );
      const { parts, total } = damageParts(sim);
      const fromStatus = parts.filter((p) => E.DAMAGING_STATUS.includes(p.key));
      if (fromStatus.length && total > 0) {
        const shares = fromStatus.map((p) => `${STATUS_LABEL[p.key].toLowerCase()} ${percent(p.amount / total)}`);
        notes.push(`Hits deal ${percent(sim.sources.direct / total)} of the damage, ${listText(shares)}.`);
      }
    } else {
      notes.push(`This build can't bring ${esc(boss.name)} down.`);
    }
    for (const boost of sim.boosts) {
      if (boost.name === "Successive attacks") {
        notes.push(`The successive-attack bonus is up for ${percent(boost.share)} of hits, ${percent(boost.top)} at its top stage.`);
      } else notes.push(`${esc(boost.name)} is active for ${percent(boost.share)} of hits.`);
    }
    if (row.grease && row.grease.sim.dps > 0 && sim.dps > 0) {
      const g = row.grease;
      notes.push(
        `With ${esc(g.name)} (+${g.attack} ${g.type} attack, kept on for the whole fight) it reaches ${fmtDps(g.sim.dps)} DPS, ` +
          `${Math.round(percentMore(g.sim.dps, sim.dps))}% more. Of the four greases, that one adds the most against this boss.`,
      );
    }
    notes.push(
      "Attack is attack rating × the hit's motion value. Defense lets 10–90% of an attack through, more as attack outgrows it; negation then removes its share.",
    );
    if (sim.procs.frost) notes.push("Each frost proc also makes the boss take 20% more damage for 30 seconds.");
    html.push(`<p class="details-notes">${notes.join(" ")}</p>`);
    return html.join("");
  }

  /** The weapon's attacks, with what the fight model knows about each. */
  function movesetHTML(x, boss, fight) {
    const moveset = movesetOf(weapon);
    if (!moveset) return "";
    const grips = boss ? [x.row.grip] : weapon.paired ? ["1h"] : alwaysTwoHanded(weapon) ? ["2h"] : ["1h", "2h"];
    const html = [];
    let estimated = false;
    let untimed = false;
    for (const grip of grips) {
      const attacks = moveset[grip];
      if (!attacks || !attacks.length) continue;
      const planned = new Map();
      for (const family of E.attackFamilies(attacks)) for (const step of family.steps) planned.set(step.name, { family, step });
      const rows = attacks.map(([name, mvs, type, next, exit, stamina]) => {
        const p = planned.get(name);
        const situational = E.SITUATIONAL_ATTACKS.includes(name);
        const mark = p && p.family.estimated ? "*" : "";
        if (mark) estimated = true;
        if (!p && !situational) untimed = true;
        const seconds = (frames, timed) => (frames == null ? '<span class="none">–</span>' : `${fmtSeconds(timed ?? frames / E.FPS)}${mark}`);
        return (
          `<tr><th scope="row">${esc(name)}</th><td class="mvs">${mvText(mvs)}</td><td class="type">${type ? PHYS_LABEL[type].toLowerCase() : '<span class="none">–</span>'}</td>` +
          `<td>${seconds(next, p && p.step.chain)}</td><td>${seconds(exit, p && p.step.exit)}</td><td>${stamina == null ? '<span class="none">–</span>' : stamina}</td></tr>`
        );
      });
      html.push(`<p class="details-sub">${GRIP_LABEL[grip]} attacks</p>`);
      html.push(
        `<div class="breakdown-wrap"><table class="breakdown attacks"><thead><tr><th scope="col">Attack</th>` +
          `<th scope="col" class="mvs" title="Motion value of each hit: at 100 a hit deals the attack rating">Motion values</th>` +
          `<th scope="col" class="type">Type</th>` +
          `<th scope="col" title="Seconds from the start of the attack until the next one can start">Next attack</th>` +
          `<th scope="col" title="Seconds from the start of the attack until you can dodge">Dodge</th>` +
          `<th scope="col">Stamina</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>`,
      );
    }
    if (!html.length) return "";

    const notes = [
      "The fight is planned with the R1 chain, heavies, charged heavies and jump attacks. Running, rolling and backstep attacks and guard counters need a setup first, so they are listed but not used.",
    ];
    if (estimated) {
      notes.push(
        `* The game's animation data starts uncharged heavies at the release and jump attacks at the landing, so these include an estimated ${E.TIMING.windup} s of wind-up or ${E.TIMING.airtime} s in the air.`,
      );
    }
    if (untimed) notes.push("An attack without timing can't be planned, and neither can the rest of its chain.");
    notes.push("Every hit adds the weapon's full status buildup whatever its motion value.");
    if (!boss) notes.push("Pick a boss to see which of these the weapon should use.");
    html.push(`<p class="details-notes">${notes.join(" ")}</p>`);
    return html.join("");
  }

  function renderLegend(results, boss, fight) {
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

    els.legendAr.hidden = !!boss;
    els.legendBoss.hidden = !boss;
    if (!boss) return;
    const tempo = tempoOf(boss);
    const count = fight.fights.count;
    const text = [
      `<strong>What DPS means.</strong> ${esc(boss.name)}'s HP divided by the average time to kill it over ${count} simulated fights. A fight is a run of openings: the boss attacks, then leaves you room. In each opening the calculator plays the attacks worth the most in the time you have, within your stamina, and stops in time to dodge. It tries one- and two-handed and keeps the faster. Select an infusion to see what it does.`,
      `<strong>The fights are random, and the same for every infusion.</strong> Openings and the waits between them vary from one to the next and from fight to fight, so each result is an average with a range: 8 of 10 fights fall inside it. Every infusion meets the same ${count} fights, so a lead of a few percent means little, and “first to kill” says how often an infusion actually won.`,
      `<strong>How long the openings are is an estimate.</strong> No one has published how long bosses leave themselves open, so each boss is placed in one of five classes. ${esc(boss.name)} counts as ${esc(lower(tempo.label))}: openings of about ${fmtSeconds(tempo.opening)}, one every ${fmtSeconds(tempo.opening + tempo.gap)} or so. Kill times move with that guess; the order of the infusions moves much less.`,
      `<strong>Damage.</strong> Each damage type in a hit is cut by the boss's defense against it and then by its negation, so spreading damage across types or into a type the boss resists costs DPS. Every hit adds the weapon's full status buildup, which procs when it reaches the boss's resistance, rising after every proc: bleed and frost deal a share of max HP at once, poison and scarlet rot tick for 90 seconds, and frostbite makes the boss take 20% more damage for 30 seconds. Sleep and madness procs deal nothing.`,
      `<strong>Fixed assumptions.</strong> ${E.TIMING.windup} s of wind-up before an uncharged heavy and ${E.TIMING.airtime} s in the air before a jump attack; a string of attacks must leave some stamina to dodge with; New Game numbers. Not counted: buffs, weapon skills, spells, spirit ashes, stance breaks and ripostes, counter-hits, and status buildup draining between hits. The four physical infusions also show their best grease (+${E.GREASES[0].attack} attack of one element), assumed to stay on for the whole fight.`,
    ];
    if (fight.generic) {
      text.push(`<strong>No moveset data.</strong> ${esc(weapon.name)} is counted as one hit at motion value 100 per second of opening.${weapon.sorcery || weapon.incantation ? " This ranks hits with the tool itself; spell damage follows the spell scaling instead." : ""}`);
    }
    els.legendBoss.innerHTML = text.map((p) => `<p>${p}</p>`).join("");
  }

  render();
})();
