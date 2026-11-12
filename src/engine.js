/**
 * Elden Ring attack rating (AR) engine.
 *
 * Works in the browser (sets window.ArEngine) and in Node (module.exports).
 *
 * How the game computes AR for one damage type (physical, magic, fire, lightning, holy):
 *
 *   base    = weapon base damage x ReinforceParamWeapon rate for the upgrade level
 *   scaling = weapon attribute scaling x ReinforceParamWeapon scaling rate for the level
 *   bonus   = base x sum over attributes of ( scaling[attr] x curve(stat[attr]) )
 *   AR      = base + bonus
 *
 * - AttackElementCorrectParam decides which attributes count for each damage type
 *   (e.g. a Fire infusion's fire damage scales with STR, Flame Art's with FAI).
 * - CalcCorrectGraph is the piecewise curve that turns a stat into a 0..~1.1 multiplier
 *   (the "soft caps" are the curve's stage breakpoints).
 * - Two-handing multiplies STR by 1.5 (rounded down). Paired weapons never get the bonus;
 *   bows and ballistae always do.
 * - If a stat is below the weapon's requirement, every damage type that scales with that stat
 *   loses its bonus and takes a 40% penalty instead (AR = base x 0.6).
 * - Bleed, poison, sleep and madness buildup scale with Arcane through the same formula.
 *   Frost, scarlet rot and death blight never scale.
 * - Sorcery / incantation scaling is the same multiplier applied to a base of 100.
 *
 * Results match the formula used by eldenring.tclark.io (MIT, Tom Clark); the test suite
 * checks this implementation against it for every weapon and infusion.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ArEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DAMAGE_TYPES = ["physical", "magic", "fire", "lightning", "holy"];
  const STATUS_TYPES = ["poison", "rot", "bleed", "frost", "sleep", "madness", "blight"];
  const ATTRIBUTES = ["str", "dex", "int", "fai", "arc"];
  const ARCANE_STATUS = new Set(["poison", "bleed", "sleep", "madness"]);
  const ALWAYS_TWO_HANDED_TYPES = new Set([50, 51, 53, 56]); // light bow, bow, greatbow, ballista
  const DEFAULT_DAMAGE_CURVE = 0;
  const DEFAULT_STATUS_CURVE = 6;
  const REQUIREMENT_PENALTY = 0.4;
  const MAX_EFFECTIVE_STAT = 148; // 99 STR x 1.5
  const EPSILON = 1e-9;

  /**
   * Expand a CalcCorrectGraph (stages of [statValue, growth, exponent]) into a lookup table of
   * multipliers indexed by stat value 1..148.
   */
  function evaluateCurve(stages) {
    const table = new Array(MAX_EFFECTIVE_STAT + 1).fill(undefined);
    for (let i = 1; i < stages.length; i++) {
      const [prevMax, prevGrow, exponent] = stages[i - 1];
      const [stageMax, stageGrow] = stages[i];
      const from = i === 1 ? 1 : prevMax + 1;
      const to = i === stages.length - 1 ? MAX_EFFECTIVE_STAT : stageMax;
      for (let stat = from; stat <= to; stat++) {
        if (table[stat]) continue;
        let ratio = Math.max(0, Math.min(1, (stat - prevMax) / (stageMax - prevMax)));
        if (exponent > 0) ratio = ratio ** exponent;
        else if (exponent < 0) ratio = 1 - (1 - ratio) ** -exponent;
        table[stat] = prevGrow + (stageGrow - prevGrow) * ratio;
      }
    }
    for (let stat = 0; stat <= MAX_EFFECTIVE_STAT; stat++) table[stat] = table[stat] || 0;
    return table;
  }

  /** Index the raw database (data/weapons.json) for fast lookups. */
  function createModel(db) {
    const curves = {};
    for (const id of Object.keys(db.curves)) curves[id] = evaluateCurve(db.curves[id]);
    const affinityNames = new Map(db.affinities);
    const weaponTypeNames = new Map(db.weaponTypes);
    const weaponTypeOrder = new Map(db.weaponTypes.map(([id], i) => [id, i]));
    const weapons = db.weapons.map((w, index) => ({
      ...w,
      index,
      typeName: weaponTypeNames.get(w.type) || "Weapon",
      infusable: w.infusions.length > 1 || w.infusions[0].affinity !== -1,
      maxLevel: db.reinforce[w.infusions[0].reinforce].length - 1,
    }));
    return {
      db,
      curves,
      weapons,
      affinityNames,
      weaponTypeNames,
      weaponTypeOrder,
      byName: new Map(weapons.map((w) => [w.name, w])),
      scalingTiers: db.scalingTiers.slice().sort((a, b) => b[0] - a[0]),
    };
  }

  function clampStat(value) {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n)) return 1;
    return Math.max(1, Math.min(99, n));
  }

  function getsTwoHandBonus(weapon, twoHanded) {
    if (weapon.paired) return false;
    if (ALWAYS_TWO_HANDED_TYPES.has(weapon.type)) return true;
    return !!twoHanded;
  }

  /** Stats as the game sees them for this weapon (STR x1.5 when two-handing). */
  function effectiveStats(weapon, stats, twoHanded) {
    const eff = {};
    for (const a of ATTRIBUTES) eff[a] = clampStat(stats[a]);
    if (getsTwoHandBonus(weapon, twoHanded)) eff.str = Math.floor(eff.str * 1.5);
    return eff;
  }

  /** Scaling grade letter (S, A, B, C, D, E) for a scaling value, or "" for none. */
  function scalingGrade(model, value) {
    if (!value) return "";
    for (const [threshold, label] of model.scalingTiers) if (value >= threshold) return label;
    return "";
  }

  /**
   * Attack rating, status buildup and spell scaling for one infusion of a weapon.
   *
   * @param model    from createModel()
   * @param weapon   an entry of model.weapons
   * @param infusion an entry of weapon.infusions
   * @param options  { stats: {str,dex,int,fai,arc}, level: number, twoHanded: boolean }
   */
  function calculate(model, weapon, infusion, options) {
    const { db, curves } = model;
    const rows = db.reinforce[infusion.reinforce];
    const level = Math.max(0, Math.min(rows.length - 1, Math.floor(options.level || 0)));
    const row = rows[level];
    const row0 = rows[0];
    const correct = db.elementCorrect[infusion.elementCorrect];
    const isCaster = !!(weapon.sorcery || weapon.incantation);

    const raw = {};
    for (const a of ATTRIBUTES) raw[a] = clampStat(options.stats[a]);
    const twoHandBonus = getsTwoHandBonus(weapon, options.twoHanded);
    const eff = effectiveStats(weapon, raw, options.twoHanded);

    const unmet = ATTRIBUTES.filter((a) => (weapon.requirements[a] || 0) > eff[a]);

    const scaling = {};
    for (const a of ATTRIBUTES) {
      scaling[a] = (infusion.scaling[a] || 0) * row.scaling[ATTRIBUTES.indexOf(a)];
    }

    function scalingFor(type, attr, correctValue) {
      if (correctValue === true) return scaling[attr];
      // AttackElementCorrectParam overrides the scaling value but keeps the upgrade multiplier
      const i = ATTRIBUTES.indexOf(attr);
      const at0 = (infusion.scaling[attr] || 0) * row0.scaling[i];
      return at0 ? (correctValue * scaling[attr]) / at0 : 0;
    }

    function evaluate(type, base, isDamage) {
      const attrs =
        (isDamage ? correct[type] : ARCANE_STATUS.has(type) ? { arc: true } : null) || {};
      const statsUsed = isDamage ? eff : raw;
      const curveId = infusion.curves[type] ?? (isDamage ? DEFAULT_DAMAGE_CURVE : DEFAULT_STATUS_CURVE);
      const curve = curves[curveId];
      const result = {
        base,
        multiplier: 1,
        parts: {},
        scalesWith: ATTRIBUTES.filter((a) => attrs[a]),
        ineffective: false,
      };
      if (unmet.some((a) => attrs[a])) {
        result.ineffective = true;
        result.multiplier = 1 - REQUIREMENT_PENALTY;
      } else {
        for (const a of ATTRIBUTES) {
          if (!attrs[a]) continue;
          const s = scalingFor(type, a, attrs[a]);
          if (!s) continue;
          const curveValue = curve[statsUsed[a]];
          result.multiplier += curveValue * s;
          result.parts[a] = { scaling: s, curve: curveValue, bonus: base * curveValue * s };
        }
      }
      result.total = base * result.multiplier;
      result.bonus = result.total - base;
      return result;
    }

    const damage = {};
    const spell = isCaster ? {} : null;
    let total = 0;
    for (let i = 0; i < DAMAGE_TYPES.length; i++) {
      const type = DAMAGE_TYPES[i];
      const base = (infusion.attack[type] || 0) * row.attack[i];
      if (!base && !isCaster) continue;
      const r = evaluate(type, base, true);
      if (base) {
        damage[type] = r;
        total += r.total;
      }
      if (isCaster) {
        spell[type] = { value: 100 * r.multiplier, ineffective: r.ineffective, parts: r.parts, scalesWith: r.scalesWith };
      }
    }

    // Status buildup comes from SpEffectParams; each upgrade level points at a different row
    const statusBase = {};
    (infusion.statusEffects || []).forEach((spId, slot) => {
      if (!spId) return;
      const effect = db.statusEffects[spId + (row.statusOffsets[slot] || 0)];
      if (effect) Object.assign(statusBase, effect);
    });
    const status = {};
    for (const type of STATUS_TYPES) {
      if (statusBase[type]) status[type] = evaluate(type, statusBase[type], false);
    }

    return {
      level,
      maxLevel: rows.length - 1,
      twoHandBonus,
      stats: eff,
      unmet,
      scaling,
      damage,
      status,
      spell,
      total,
    };
  }

  /** In-game numbers are truncated; the epsilon guards against float error (e.g. 299.9999999). */
  function floor(value) {
    return Math.floor(value + EPSILON);
  }

  /**
   * Map an upgrade level between regular (+25) and somber (+10) weapons, so switching weapons
   * keeps a comparable level.
   */
  function convertLevel(level, fromMax, toMax) {
    if (fromMax === toMax) return Math.min(level, toMax);
    if (fromMax === 25 && toMax === 10) return Math.floor((level + 0.5) * 0.4);
    if (fromMax === 10 && toMax === 25) return Math.floor(level * 2.5);
    if (toMax === 0) return 0;
    return Math.round((level / Math.max(1, fromMax)) * toMax);
  }

  return {
    DAMAGE_TYPES,
    STATUS_TYPES,
    ATTRIBUTES,
    REQUIREMENT_PENALTY,
    evaluateCurve,
    createModel,
    effectiveStats,
    getsTwoHandBonus,
    scalingGrade,
    calculate,
    floor,
    convertLevel,
  };
});
