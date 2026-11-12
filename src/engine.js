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
 * Results match the formula used by eldenring.tclark.io (MIT, Tom Clark); they were checked
 * against that site value by value, and the test suite pins down the formula's pieces.
 *
 * Against a boss (hitDamage and fightBoss below), each damage type of a hit is reduced
 * separately:
 *
 *   attack  = AR(type) x motion value
 *   dealt   = attack x defenseMultiplier(attack / boss defense) x (1 - boss negation)
 *
 * The defense multiplier climbs from 10% to 90% of attack as attack outgrows defense, which is
 * why splitting the same AR across two damage types loses damage. fightBoss then plays out a
 * fight one hit at a time at a fixed pace, adding status procs (bleed, frost, poison, rot) as
 * the boss's resistance rises after each one, and reports hits and seconds to kill.
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

  // ---------------------------------------------------------------------------------------
  // Damage against a boss

  const PHYSICAL_TYPES = ["standard", "slash", "strike", "pierce"];

  /**
   * What a status does when its meter fills. Bleed and frost hit at once for a share of max HP
   * plus a flat amount, scaled by the boss's statusDamage (bosses take 50-70% of the normal
   * amount); poison and rot tick per second. Frost also makes the target take 20% more damage
   * for 30 seconds, and none of frost, poison or rot can build up again while active.
   */
  const STATUS_EFFECTS = {
    bleed: { hpShare: 0.15, flat: 100, bossScaled: true },
    frost: { hpShare: 0.1, flat: 30, bossScaled: true, seconds: 30, damageTaken: 1.2 },
    poison: { hpSharePerSecond: 0.0007, flatPerSecond: 7, seconds: 90 },
    rot: { hpSharePerSecond: 0.0018, flatPerSecond: 15, seconds: 90 },
  };
  const DAMAGING_STATUS = ["bleed", "frost", "poison", "rot"];
  const MAX_FIGHT_HITS = 20000;

  /**
   * Share of an attack that gets through defense, from the ratio of attack to defense:
   * 10% at 1/8 of defense or less, 40% at equal values, 70% at 2.5x and 90% at 8x or more,
   * joined by quadratic curves.
   */
  function defenseMultiplier(attack, defense) {
    if (!(attack > 0)) return 0;
    if (!(defense > 0)) return 0.9;
    const r = attack / defense;
    if (r >= 8) return 0.9;
    if (r >= 2.5) return 0.9 - 0.2 * ((8 - r) / 5.5) ** 2;
    if (r >= 1) return 0.7 - 0.3 * ((2.5 - r) / 1.5) ** 2;
    if (r >= 0.125) return 0.1 + 0.3 * ((r - 0.125) / 0.875) ** 2;
    return 0.1;
  }

  /**
   * Damage one hit deals to a boss.
   * @param result  the output of calculate()
   * @param boss    an entry of the boss database
   * @param options { motionValue = 100, physicalType = "standard" | "slash" | "strike" | "pierce" }
   */
  function hitDamage(result, boss, options = {}) {
    const motion = (options.motionValue ?? 100) / 100;
    const physicalType = PHYSICAL_TYPES.includes(options.physicalType) ? options.physicalType : "standard";
    const perType = {};
    let total = 0;
    for (const type of DAMAGE_TYPES) {
      const d = result.damage[type];
      if (!d) continue;
      const attack = d.total * motion;
      const defense = boss.defense[type];
      const negation = boss.negation[type === "physical" ? physicalType : type] / 100;
      const multiplier = defenseMultiplier(attack, defense);
      const dealt = attack * multiplier * (1 - negation);
      perType[type] = { attack, defense, defenseMultiplier: multiplier, negation, dealt };
      total += dealt;
    }
    return { perType, total };
  }

  /**
   * Play out a fight: one hit every secondsPerHit seconds until the boss's HP runs out.
   * Each hit deals hitDamage() and adds its status buildup; when a meter fills the status
   * procs and the meter empties. Resistance rises with every proc: proc k needs
   * boss.status[type][k - 1] (for example 293, then 335, 433, 723 and 1180), and every proc
   * after the end of the list needs its last value.
   *
   * seconds counts only the part of the last swing that was needed, so dps is the fight's
   * damage throughput: with no status effects it is exactly damage per hit / secondsPerHit,
   * instead of jumping whenever the hit count changes.
   *
   * @param options hitDamage options plus { secondsPerHit = 2 }
   * @returns { hit, hits, seconds, dps, sources: damage by source, procs: count per status,
   *            procHits: the hit number of each proc per status, immune }
   *          (hits and seconds are Infinity when the weapon can't kill the boss)
   */
  function fightBoss(result, boss, options = {}) {
    const hit = hitDamage(result, boss, options);
    const interval = Math.max(0.1, Number(options.secondsPerHit) || 2);
    const hp = boss.hp;

    const building = [];
    const immune = [];
    for (const type of STATUS_TYPES) {
      const s = result.status[type];
      if (!s || !(s.total > 0)) continue;
      if (Array.isArray(boss.status[type])) building.push({ type, perHit: s.total });
      else if (type !== "blight") immune.push(type);
    }

    const sources = { direct: 0, bleed: 0, frost: 0, poison: 0, rot: 0 };
    const procs = {};
    const procHits = {};
    const meter = {};
    const procCount = {};
    const lockedUntil = {};
    const dots = [];
    let frostUntil = -Infinity;
    let remaining = hp;
    let seconds = Infinity;
    let hits = Infinity;

    const statusDamage = boss.statusDamage ?? 1;
    const amplify = (t) => (t < frostUntil ? STATUS_EFFECTS.frost.damageTaken : 1);
    const deal = (source, amount) => {
      sources[source] += amount;
      remaining -= amount;
    };

    for (let n = 1; n <= MAX_FIGHT_HITS; n++) {
      const start = (n - 1) * interval;
      const end = n * interval;

      // Poison and rot tick between hits
      let ticked = 0;
      for (const dot of dots) {
        const from = Math.max(start, dot.from);
        const to = Math.min(end, dot.until);
        if (to <= from) continue;
        const amount = dot.perSecond * (to - from) * amplify(from);
        if (amount >= remaining) {
          // Dies partway through the gap
          seconds = from + ((to - from) * remaining) / amount;
          deal(dot.type, remaining);
          hits = n - 1;
          break;
        }
        deal(dot.type, amount);
        ticked += amount;
      }
      if (remaining <= 0) break;

      // The hit lands
      const before = remaining;
      const multiplier = amplify(end);
      deal("direct", hit.total * multiplier);

      for (const { type, perHit } of building) {
        if ((lockedUntil[type] ?? -Infinity) > end) continue;
        const thresholds = boss.status[type];
        const k = procCount[type] ?? 0;
        meter[type] = (meter[type] ?? 0) + perHit;
        if (meter[type] < thresholds[Math.min(k, thresholds.length - 1)]) continue;

        meter[type] = 0;
        procCount[type] = k + 1;
        procs[type] = k + 1;
        (procHits[type] = procHits[type] || []).push(n);
        const effect = STATUS_EFFECTS[type];
        if (!effect) continue; // sleep and madness don't deal damage to bosses here
        if (type === "bleed") {
          deal("bleed", (effect.hpShare * hp + effect.flat) * statusDamage * multiplier);
        } else if (type === "frost") {
          deal("frost", (effect.hpShare * hp + effect.flat) * statusDamage);
          frostUntil = end + effect.seconds;
          lockedUntil.frost = frostUntil;
        } else {
          dots.push({
            type,
            perSecond: effect.hpSharePerSecond * hp + effect.flatPerSecond,
            from: end,
            until: end + effect.seconds,
          });
          lockedUntil[type] = end + effect.seconds;
        }
      }

      if (remaining <= 0) {
        seconds = start + (interval * before) / (before - remaining);
        hits = n;
        break;
      }
      if (hit.total <= 0 && building.length === 0 && ticked === 0 && dots.every((d) => d.until <= end)) break;
    }

    return {
      hit,
      hits,
      seconds,
      dps: Number.isFinite(seconds) && seconds > 0 ? hp / seconds : 0,
      sources,
      procs,
      procHits,
      immune,
    };
  }

  return {
    DAMAGE_TYPES,
    STATUS_TYPES,
    ATTRIBUTES,
    REQUIREMENT_PENALTY,
    PHYSICAL_TYPES,
    STATUS_EFFECTS,
    DAMAGING_STATUS,
    evaluateCurve,
    createModel,
    effectiveStats,
    getsTwoHandBonus,
    scalingGrade,
    calculate,
    floor,
    convertLevel,
    defenseMultiplier,
    hitDamage,
    fightBoss,
  };
});
