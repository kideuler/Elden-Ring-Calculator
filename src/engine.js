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
 * Against a boss (hitDamage below), each damage type of a hit is reduced separately:
 *
 *   attack  = AR(type) x motion value x attack multipliers (talismans, and Scadutree Blessing
 *             against a Shadow of the Erdtree boss)
 *   dealt   = attack x defenseMultiplier(attack / boss defense) x (1 - boss negation)
 *
 * The defense multiplier climbs from 10% to 90% of attack as attack outgrows defense, which is
 * why splitting the same AR across two damage types loses damage, and why an attack multiplier
 * is worth more than its percentage.
 *
 * The fight model (rankInfusions, built on createFights, prepareFighter and simulate) then asks
 * how long a weapon takes to kill a boss. A fight is a run of openings: the boss attacks for a
 * while, then leaves a gap you can attack in. Opening lengths and the time between them are
 * random, drawn from the boss's tempo, and every infusion faces the same random fights. In each
 * opening the model plays the best attacks that fit, within your stamina, and leaves in time to
 * dodge. Status procs, their rising thresholds and talisman effects play out hit by hit. The
 * score is the boss's HP divided by the average time to kill.
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

  /**
   * Scadutree Blessing: in the Land of Shadow each level multiplies your attack, from x1.10 at
   * level 1 to x2.05 at 20 (the values since patch 1.12.2, from the wiki's table). It has no
   * effect outside the realm of shadow, so only Shadow of the Erdtree bosses (`dlc`) count it.
   * It raises the attack of every damage type before defense, as an attack talisman does. The
   * wiki lists only damage dealt and taken, so status buildup and proc damage (a share of the
   * boss's HP) are taken not to change with it.
   */
  const BLESSING_ATTACK = [1, 1.1, 1.2, 1.25, 1.3, 1.35, 1.42, 1.5, 1.55, 1.6, 1.65, 1.75, 1.85, 1.87, 1.9, 1.92, 1.95, 1.97, 2, 2.02, 2.05];
  const MAX_BLESSING = BLESSING_ATTACK.length - 1;

  /** The attack multiplier of a Scadutree Blessing level against a boss: 1 outside the DLC. */
  function blessingMultiplier(level, boss) {
    if (!boss || !boss.dlc) return 1;
    const n = Math.floor(Number(level));
    return Number.isFinite(n) ? BLESSING_ATTACK[Math.max(0, Math.min(MAX_BLESSING, n))] : 1;
  }

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
   * @param options { motionValue = 100, physicalType = "standard" | "slash" | "strike" | "pierce",
   *                  multiplier: attack multiplier for every damage type (talismans),
   *                  typeMultipliers: { type: attack multiplier }, bonus: { type: flat attack
   *                  added to the attack rating (a grease) } }
   */
  function hitDamage(result, boss, options = {}) {
    const motion = (options.motionValue ?? 100) / 100;
    const physicalType = PHYSICAL_TYPES.includes(options.physicalType) ? options.physicalType : "standard";
    const multiplier = options.multiplier ?? 1;
    const typeMultipliers = options.typeMultipliers || {};
    const bonus = options.bonus || {};
    const perType = {};
    let total = 0;
    for (const type of DAMAGE_TYPES) {
      const rating = ((result.damage[type] && result.damage[type].total) || 0) + (bonus[type] || 0);
      if (!rating) continue;
      const attack = rating * motion * multiplier * (typeMultipliers[type] || 1);
      const defense = boss.defense[type];
      const negation = boss.negation[type === "physical" ? physicalType : type] / 100;
      const share = defenseMultiplier(attack, defense);
      const dealt = attack * share * (1 - negation);
      perType[type] = { attack, defense, defenseMultiplier: share, negation, dealt };
      total += dealt;
    }
    return { perType, total };
  }

  // ---------------------------------------------------------------------------------------
  // Attacks

  /** The game's animation data runs at 30 frames per second. */
  const FPS = 30;

  /**
   * Seconds the animation data leaves out, filled in with fixed estimates:
   * windup:  the wind-up before an uncharged heavy, whose data starts at the release
   * airtime: the time in the air before a jump attack lands, whose data starts at the landing
   */
  const TIMING = { windup: 0.3, airtime: 0.9 };

  /**
   * The kinds of attack a fight is built from. In one opening you repeat one of them as often as
   * fits: the R1 chain runs through every R1, heavies alternate their two swings, jump attacks
   * repeat.
   * kind:   what talismans look at (charged heavies, jump attacks)
   * points: what one landed attack adds to the successive-attack talismans (see SUCCESSIVE)
   */
  const ATTACK_FAMILIES = [
    { id: "r1", label: "R1", kind: "light", points: 8, pattern: /^R1 \d$/, chain: true },
    { id: "r2", label: "R2", kind: "heavy", points: 10, pattern: /^R2 \d$/, windup: true },
    { id: "charged-r2", label: "Charged R2", kind: "charged", points: 14, pattern: /^Charged R2 \d$/ },
    { id: "jump-r1", label: "Jump R1", kind: "jump", points: 8, pattern: /^Jumping R1$/, airtime: true },
    { id: "jump-r2", label: "Jump R2", kind: "jump", points: 10, pattern: /^Jumping R2$/, airtime: true },
    // Powerstance: L1 with a weapon of the same type in each hand (data/attacks.json "paired")
    { id: "l1", label: "L1", kind: "light", points: 8, pattern: /^L1 \d$/, chain: true },
    { id: "jump-l1", label: "Jump L1", kind: "jump", points: 8, pattern: /^Jumping L1$/, airtime: true },
  ];

  /** Attacks that need a sprint, roll, backstep or block first, so the model doesn't plan them. */
  const SITUATIONAL_ATTACKS = ["Running R1", "Running R2", "Rolling R1", "Backstep R1", "Guard Counter", "Running L1", "Rolling L1", "Backstep L1"];

  /**
   * The attack families in one grip of a moveset, with their timing in seconds.
   * @param attacks  [[name, [motion value per hit], physical type, frames until the next attack
   *                 can start, frames until a dodge can start, stamina cost, hands], ...] as in
   *                 data/attacks.json (the frames and cost may be null; hands, the hand of each
   *                 hit as "R" or "L", is there for powerstance attacks only)
   * @returns [{ id, label, kind, points, estimated, steps: [{ name, mvs, type, chain, exit,
   *            stamina, finisher, frames, exitFrames, hands }] }]. A family with an attack the
   *            animation data doesn't cover is left out, since it can't be timed.
   */
  function attackFamilies(attacks) {
    const families = [];
    for (const def of ATTACK_FAMILIES) {
      const list = (attacks || []).filter((a) => def.pattern.test(a[0]));
      if (!list.length || list.some((a) => a[3] == null || a[4] == null)) continue;
      const extra = (def.windup ? TIMING.windup : 0) + (def.airtime ? TIMING.airtime : 0);
      const steps = list.map(([name, mvs, type, next, exit, stamina, hands], i) => ({
        name,
        mvs,
        type,
        // Seconds until the family's next attack can start. A jump attack has to leave the ground
        // again first, which needs the same recovery as a dodge.
        chain: (def.airtime ? exit : next) / FPS + extra,
        // Seconds until you can dodge
        exit: exit / FPS + extra,
        stamina: stamina || 0,
        // The last light attack of a chain, which the Twinblade Talisman strengthens
        finisher: !!def.chain && list.length > 1 && i === list.length - 1,
        frames: next,
        exitFrames: exit,
        hands: hands || null,
      }));
      families.push({ id: def.id, label: def.label, kind: def.kind, points: def.points, estimated: extra > 0, steps });
    }
    return families;
  }

  /**
   * A right-hand weapon's powerstance attacks with the left weapon's motion values on the left
   * hand's hits: each hand swings with its own weapon's values. The timing and the hands come from
   * the right hand's animations; where the left weapon's attack has a different number of hits,
   * the right hand's values stand for both.
   */
  function pairedAttacks(right, left) {
    if (!right) return null;
    if (!left || left === right) return right;
    const byName = new Map(left.map((a) => [a[0], a]));
    return right.map((a) => {
      const other = byName.get(a[0]);
      if (!other || other[1].length !== a[1].length || !a[6]) return a;
      const mvs = a[1].map((mv, h) => (a[6][h] === "L" ? other[1][h] : mv));
      return [a[0], mvs, ...a.slice(2)];
    });
  }

  /** A stand-in for weapons without moveset data: one 100 motion value hit a second. */
  function basicFamily(physicalType) {
    const type = PHYSICAL_TYPES.includes(physicalType) ? physicalType : "standard";
    const step = { name: "Hit", mvs: [100], type, chain: 1, exit: 1, stamina: 0, finisher: false, frames: FPS, exitFrames: FPS };
    return [{ id: "basic", label: "Basic hit", kind: "light", points: 8, estimated: true, steps: [step] }];
  }

  // ---------------------------------------------------------------------------------------
  // Stamina and talismans

  /** Maximum stamina by Endurance: straight lines between the game's soft caps, rounded down. */
  const STAMINA_CURVE = [[1, 80], [15, 105], [30, 130], [50, 155], [99, 170]];

  function staminaFor(endurance, multiplier = 1) {
    const level = clampStat(endurance);
    let base = STAMINA_CURVE[STAMINA_CURVE.length - 1][1];
    for (let i = 1; i < STAMINA_CURVE.length; i++) {
      const [x0, y0] = STAMINA_CURVE[i - 1];
      const [x1, y1] = STAMINA_CURVE[i];
      if (level <= x1) {
        base = y0 + ((y1 - y0) * (level - x0)) / (x1 - x0);
        break;
      }
    }
    return floor(floor(base) * multiplier);
  }

  /**
   * The successive-attack talismans (Winged Sword Insignia, Millicent's Prosthesis) count points:
   * each landed attack adds some (ATTACK_FAMILIES.points), and holding 17, 30 or 45 gives the
   * first, second or third bonus. Points drain while you aren't hitting: one every `decay`
   * seconds, by how many you hold. The wiki lists the four intervals without saying which range
   * each belongs to; they are read here in the order of the thresholds.
   */
  const SUCCESSIVE = {
    thresholds: [17, 30, 45],
    cap: 60,
    decay: [[60, 0.4], [45, 0.7], [30, 1], [0, 0.5]],
  };

  /**
   * Add up what a set of talismans (entries of data/talismans.json) does.
   * @returns { names, stats: attribute points added, stamina: multiplier, damage: multiplier per
   *            damage type, kinds: multiplier per kind of attack (charged, jump, finisher,
   *            two-handed), assumed: multiplier from effects counted for a fixed share of the
   *            fight, successive: [m1, m2, m3] or null, after: [{ name, status, multiplier, seconds }] }
   */
  function talismanEffects(talismans) {
    const effects = {
      names: [],
      stats: { str: 0, dex: 0, int: 0, fai: 0, arc: 0, end: 0 },
      stamina: 1,
      damage: {},
      kinds: {},
      assumed: 1,
      successive: null,
      after: [],
    };
    for (const t of talismans || []) {
      if (!t) continue;
      effects.names.push(t.name);
      for (const [attr, points] of Object.entries(t.stats || {})) {
        if (attr in effects.stats) effects.stats[attr] += points;
      }
      if (t.stamina) effects.stamina *= t.stamina;
      for (const [type, m] of Object.entries(t.damage || {})) effects.damage[type] = (effects.damage[type] || 1) * m;
      if (t.attack) effects.kinds[t.attack.kind] = (effects.kinds[t.attack.kind] || 1) * t.attack.multiplier;
      if (t.assumed) effects.assumed *= 1 + (t.assumed.multiplier - 1) * t.assumed.share;
      if (t.successive) {
        effects.successive = effects.successive
          ? effects.successive.map((m, i) => m * t.successive[i])
          : t.successive.slice();
      }
      if (t.after) effects.after.push({ name: t.name, ...t.after });
    }
    return effects;
  }

  /**
   * What talismans multiply one attack's attack by, apart from the effects that come and go
   * during a fight (those are states of the fighter, see prepareFighter).
   * @param grip   "1h" | "2h"
   * @param family an attackFamilies() entry, @param step one of its steps
   */
  function attackMultiplier(effects, grip, family, step) {
    return (
      effects.assumed *
      (grip === "2h" ? effects.kinds["two-handed"] || 1 : 1) *
      (effects.kinds[family.kind] || 1) *
      (step.finisher ? effects.kinds.finisher || 1 : 1)
    );
  }

  /** Attributes with the talismans' points added (the game caps them at 99). */
  function boostedStats(stats, effects) {
    const out = {};
    for (const attr of Object.keys(effects.stats)) out[attr] = Math.min(99, clampStat(stats[attr] ?? 10) + effects.stats[attr]);
    return out;
  }

  /**
   * Greases add flat attack of one element for 60 seconds. Only the four physical infusions of
   * an infusable weapon are counted as able to take one.
   */
  const GREASES = [
    { name: "Fire Grease", type: "fire", attack: 85 },
    { name: "Lightning Grease", type: "lightning", attack: 85 },
    { name: "Magic Grease", type: "magic", attack: 85 },
    { name: "Holy Grease", type: "holy", attack: 85 },
  ];
  const BUFFABLE_AFFINITIES = new Set([0, 1, 2, 3]); // Standard, Heavy, Keen, Quality

  // ---------------------------------------------------------------------------------------
  // The fight model

  const DEFAULT_FIGHTS = 300;
  const MAX_OPENING = 12; // seconds: longer openings are cut to this
  const MAX_OPENINGS = 4000; // per fight: past this the weapon counts as unable to kill
  const MAX_STRING = 16; // attacks in one opening
  const FROST_AMP = STATUS_EFFECTS.frost.damageTaken;

  /**
   * Random fights against one boss. A fight is a run of cycles: the boss attacks for a gap, then
   * leaves an opening. Both lengths are Gamma distributed around the fight's own means, and
   * those means vary from fight to fight (log-normally, by `spread`) around the boss's tempo:
   * no two attempts at a boss go the same way, and the tempo itself is an estimate.
   *
   * Everything compared against a boss should use the same fights object: each fight's cycles
   * are generated once, from its own seeded stream, so every infusion meets the same openings
   * and differences between them aren't noise.
   *
   * @param tempo   { opening: mean seconds you can attack for, gap: mean seconds between
   *                  openings, shape: Gamma shape of both (default 3; Infinity = every cycle
   *                  the same, for tests), spread: sigma of the fight-to-fight variation }
   * @param options { count: fights to draw (default 300), seed }
   * @returns { count, tempo, gaps: [Float32Array of seconds], opens: [Uint16Array of frames],
   *            extend(fight): grow one fight's cycles }
   */
  function createFights(tempo, options = {}) {
    const count = Math.max(1, Math.floor(options.count ?? DEFAULT_FIGHTS));
    const opening = Math.max(0, Number(tempo.opening) || 0);
    const gap = Math.max(0, Number(tempo.gap) || 0);
    const steady = tempo.shape === Infinity;
    const shape = steady ? Infinity : Math.max(1, Math.round(Number(tempo.shape) || 3));
    const spread = steady ? 0 : Math.max(0, Number(tempo.spread) || 0);
    const seed = (Number(options.seed) || 1) >>> 0;

    // One mulberry32 stream per fight
    const state = new Uint32Array(count);
    const random = (f) => {
      const s = (state[f] = (state[f] + 0x6d2b79f5) >>> 0);
      let x = Math.imul(s ^ (s >>> 15), s | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
    const normal = (f) => Math.sqrt(-2 * Math.log(1 - random(f))) * Math.cos(2 * Math.PI * random(f));
    const gamma = (f, mean) => {
      if (steady) return mean;
      let product = 1;
      for (let i = 0; i < shape; i++) product *= 1 - random(f);
      return (-Math.log(product) * mean) / shape;
    };

    const openingMean = new Float64Array(count);
    const gapMean = new Float64Array(count);
    const gaps = new Array(count);
    const opens = new Array(count);
    for (let f = 0; f < count; f++) {
      state[f] = (seed ^ Math.imul(f + 1, 0x9e3779b1)) >>> 0;
      random(f);
      // exp(sigma z - sigma^2 / 2) has mean 1, so the tempo stays the average
      openingMean[f] = opening * Math.exp(spread * normal(f) - (spread * spread) / 2);
      gapMean[f] = gap * Math.exp(spread * normal(f) - (spread * spread) / 2);
      gaps[f] = new Float32Array(0);
      opens[f] = new Uint16Array(0);
    }

    function extend(f) {
      const old = gaps[f].length;
      const size = Math.max(32, old * 2);
      const g = new Float32Array(size);
      const o = new Uint16Array(size);
      g.set(gaps[f]);
      o.set(opens[f]);
      for (let j = old; j < size; j++) {
        g[j] = gamma(f, gapMean[f]);
        o[j] = Math.floor(Math.min(MAX_OPENING, gamma(f, openingMean[f])) * FPS + 1e-6);
      }
      gaps[f] = g;
      opens[f] = o;
    }

    return { count, tempo: { opening, gap, shape, spread }, gaps, opens, extend, openingMean, gapMean };
  }

  /**
   * One form of a weapon in one grip, ready to fight a boss: how many attacks of each family fit
   * an opening of every length, and what each hit deals.
   *
   * A string of n attacks fits an opening when the attacks before the last have each reached the
   * frame where the next can start, the last has reached the frame where you can dodge, and the
   * string's stamina cost stays below your stamina (so there is some left to dodge with).
   *
   * Powerstance attacks hit with both hands. Each hit of a step with `hands` uses its own hand's
   * weapon: its attack rating for the damage and its buildup for status effects.
   *
   * @param options { result: calculate() output (the right hand), boss, families:
   *                  attackFamilies() output, grip: "1h" | "2h" | "ps" (powerstance), stamina
   *                  (default: unlimited), effects: talismanEffects() output, bonus: flat attack
   *                  added per damage type (a grease), tempo: the boss's tempo (used to value
   *                  frostbite when choosing attacks), left: calculate() output of the left
   *                  hand's weapon (default: the same weapon, as a paired weapon holds one in
   *                  each hand), leftBonus: the left hand's grease (default: none for a left
   *                  weapon of its own, the same as `bonus` otherwise), blessing: Scadutree
   *                  Blessing level, which multiplies every hit's attack against a DLC boss (see
   *                  blessingMultiplier) }
   */
  function prepareFighter(options) {
    const { result, boss } = options;
    const effects = options.effects || talismanEffects([]);
    const grip = options.grip === "2h" || options.grip === "ps" ? options.grip : "1h";
    const stamina = options.stamina ?? Infinity;
    const bonus = options.bonus || {};
    const left = options.left || result;
    const leftBonus = options.left ? options.leftBonus || {} : options.leftBonus || bonus;

    const arOf = (r, b) => DAMAGE_TYPES.map((t) => ((r.damage[t] && r.damage[t].total) || 0) + (b[t] || 0));
    const ar = arOf(result, bonus);
    const arLeft = arOf(left, leftBonus);
    const blessing = blessingMultiplier(options.blessing, boss);
    const typeMultiplier = DAMAGE_TYPES.map((t) => (effects.damage[t] || 1) * blessing);
    const defense = DAMAGE_TYPES.map((t) => boss.defense[t]);

    // Effects that switch on and off during a fight: the successive-attack tier (0-3) and one
    // bit per talisman that answers a status proc. A hit's attack is multiplied by its state's
    // multiplier before defense.
    const tiers = effects.successive ? 4 : 1;
    const after = effects.after;
    const stateCount = tiers << after.length;
    const stateMultiplier = new Float64Array(stateCount);
    for (let state = 0; state < stateCount; state++) {
      const tier = state % tiers;
      const bits = (state - tier) / tiers;
      let m = tier ? effects.successive[tier - 1] : 1;
      after.forEach((a, i) => {
        if ((bits >> i) & 1) m *= a.multiplier;
      });
      stateMultiplier[state] = m;
    }

    const fighter = { boss, result, left, grip, stamina, effects, tiers, after, stateCount, stateMultiplier, defense };

    const families = [];
    for (const family of options.families || []) {
      const steps = family.steps.map((step) => {
        const multiplier = attackMultiplier(effects, fighter.grip, family, step);
        // hand[h]: 0 the right hand, 1 the left
        const hand = Uint8Array.from(step.mvs, (_, h) => (step.hands && step.hands[h] === "L" ? 1 : 0));
        const hits = step.mvs.map((mv, h) => (hand[h] ? arLeft : ar).map((a, i) => (a * mv * multiplier * typeMultiplier[i]) / 100));
        return {
          source: step,
          chain: step.chain,
          exit: step.exit,
          stamina: step.stamina,
          negation: DAMAGE_TYPES.map((t) => boss.negation[t === "physical" ? step.type : t] / 100),
          hits,
          hand,
          cache: new Float64Array(hits.length * stateCount).fill(NaN), // damage per hit and state
          uses: new Float64Array(hits.length * stateCount), // filled by simulate()
        };
      });

      // time[n], value[n] and hitsUpTo[n] describe the string of the family's first n attacks;
      // leftHits[n] counts the left hand's hits among them
      const time = [0];
      const value = [0];
      const hitsUpTo = [0];
      const leftHits = [0];
      const costs = [0];
      const hitTimes = [];
      let start = 0;
      let cost = 0;
      for (let n = 1; n <= MAX_STRING; n++) {
        const step = steps[(n - 1) % steps.length];
        cost += step.stamina;
        if (cost >= stamina) break;
        const total = start + step.exit;
        if (total > MAX_OPENING) break;
        let v = value[n - 1];
        let l = leftHits[n - 1];
        for (let h = 0; h < step.hits.length; h++) {
          v += hitTotal(fighter, step, h, 0);
          l += step.hand[h];
        }
        time.push(total);
        value.push(v);
        hitsUpTo.push(hitsUpTo[n - 1] + step.hits.length);
        leftHits.push(l);
        costs.push(cost);
        hitTimes.push(start + Math.min(step.chain, step.exit));
        start += step.chain;
      }
      const maxPrefix = time.length - 1;
      if (!maxPrefix) continue;

      // fit[frames] = the most attacks that fit an opening of that many frames
      const fit = new Uint8Array(MAX_OPENING * FPS + 1);
      let n = 0;
      for (let frames = 0; frames < fit.length; frames++) {
        while (n < maxPrefix && time[n + 1] * FPS <= frames + 1e-6) n++;
        fit[frames] = n;
      }
      families.push({ id: family.id, label: family.label, kind: family.kind, points: family.points, source: family, steps, time, value, hitsUpTo, leftHits, costs, hitTimes, maxPrefix, fit });
    }

    // Status effects either hand builds up on this boss: perHit[hand] is what one hit of that
    // hand adds to the meter
    const statusDamage = boss.statusDamage ?? 1;
    const building = [];
    const immune = [];
    const twoWeapons = left !== result && families.some((f) => f.leftHits[f.maxPrefix] > 0);
    for (const type of STATUS_TYPES) {
      const buildup = (r) => (r.status[type] && r.status[type].total > 0 ? r.status[type].total : 0);
      const perHit = [buildup(result), twoWeapons ? buildup(left) : buildup(result)];
      if (!(perHit[0] > 0 || perHit[1] > 0)) continue;
      const thresholds = boss.status[type];
      if (!Array.isArray(thresholds)) {
        if (type !== "blight") immune.push(type);
        continue;
      }
      const effect = STATUS_EFFECTS[type];
      let afterMask = 0;
      after.forEach((a, i) => {
        if (a.status.includes(type)) afterMask |= 1 << i;
      });
      // kind: 1 damage at once (bleed), 2 damage at once plus frostbite, 3 damage over time,
      // 0 no damage (sleep, madness). worth: the damage one proc is good for, used to weigh
      // buildup against direct damage when choosing attacks.
      const entry = { type, perHit, thresholds, afterMask, kind: 0, damage: 0, perSecond: 0, seconds: 0, worth: 0 };
      if (type === "bleed" || type === "frost") {
        entry.kind = type === "bleed" ? 1 : 2;
        entry.damage = (effect.hpShare * boss.hp + effect.flat) * statusDamage;
        entry.seconds = effect.seconds || 0;
        entry.worth = entry.damage;
      } else if (effect) {
        entry.kind = 3;
        entry.perSecond = effect.hpSharePerSecond * boss.hp + effect.flatPerSecond;
        entry.seconds = effect.seconds;
        entry.worth = entry.perSecond * effect.seconds;
      }
      building.push(entry);
    }

    // Frostbite is also worth the extra damage of the hits that follow it
    const frost = building.find((b) => b.type === "frost");
    if (frost && options.tempo && options.tempo.opening > 0) {
      const frames = Math.min(MAX_OPENING * FPS, Math.round(options.tempo.opening * FPS));
      const typical = Math.max(0, ...families.map((f) => f.value[f.fit[frames]]));
      frost.worth += ((FROST_AMP - 1) * typical * frost.seconds) / (options.tempo.opening + options.tempo.gap);
    }

    fighter.families = families;
    fighter.building = building;
    fighter.immune = immune;
    // Whether each hand's hits carry fire, which ends frostbite
    fighter.fire = Uint8Array.of(ar[DAMAGE_TYPES.indexOf("fire")] > 0 ? 1 : 0, arLeft[DAMAGE_TYPES.indexOf("fire")] > 0 ? 1 : 0);
    fighter.canHurt = families.some((f) => f.value[1] > 0) || (families.length > 0 && building.some((b) => b.kind > 0));
    return fighter;
  }

  /** Damage of one hit of a prepared attack in a talisman state, after defense and negation. */
  function hitTotal(fighter, step, h, state) {
    const index = h * fighter.stateCount + state;
    let total = step.cache[index];
    if (total === total) return total;
    total = 0;
    const attack = step.hits[h];
    const m = fighter.stateMultiplier[state];
    for (let i = 0; i < attack.length; i++) {
      const a = attack[i] * m;
      if (a > 0) total += a * defenseMultiplier(a, fighter.defense[i]) * (1 - step.negation[i]);
    }
    step.cache[index] = total;
    return total;
  }

  /**
   * Fight every fight in `fights` with a prepared fighter.
   *
   * Each cycle: the boss attacks for the gap, then the opening starts. Of each attack family,
   * the longest string that fits is considered, and the one worth the most is played: its direct
   * damage plus its status buildup, valued at what the next proc deals per point of buildup it
   * still needs. Hits land one by one:
   *
   * - A hit deals hitTotal() in the current talisman state, times 1.2 during frostbite.
   * - Every hit adds its weapon's full status buildup (in powerstance, the weapon in the hand
   *   that lands it). When a meter reaches the boss's resistance the status procs, the meter
   *   empties, and the next proc needs the next (higher) threshold of boss.status[type]; past
   *   the end of that list, its last value.
   *   Bleed: 15% of max HP + 100 at once. Frost: 10% + 30 at once, then frostbite for 30
   *   seconds. Poison and rot: damage every second for 90 seconds. Bosses take statusDamage of
   *   the bleed and frost amounts. Frost, poison and rot can't build up while active, and a hit
   *   with fire damage ends frostbite.
   * - Talismans that answer a proc switch on for their duration; the successive-attack ones
   *   gain points per landed attack and lose them over time (SUCCESSIVE).
   *
   * @returns { times: seconds to kill per fight (Infinity = never), openings: cycles needed per
   *            fight, seconds: mean, p10, median, p90, dps: boss HP / mean seconds,
   *            openingsToKill: median, hits: per fight, sources: mean damage per fight by source,
   *            direct: mean hit damage per fight by damage type, procs: mean per fight,
   *            immune, plan: [{ id, label, attacks, share of openings, seconds the string
   *            needs, its stamina cost, its direct damage before talisman effects that come and
   *            go }], idle: share of openings too short for any attack,
   *            boosts: [{ name, share of hits }] }
   */
  function simulate(fighter, fights) {
    const { boss, families, building, after, tiers, stateCount } = fighter;
    const hp = boss.hp;
    const N = fights.count;
    const B = building.length;
    const A = after.length;
    const F = families.length;
    const successive = tiers > 1;
    const frostIndex = building.findIndex((b) => b.type === "frost");

    const times = new Float64Array(N).fill(Infinity);
    const openings = new Float64Array(N).fill(Infinity);
    const sources = { direct: 0, bleed: 0, frost: 0, poison: 0, rot: 0 };
    const procTotal = new Float64Array(B);
    const fire = fighter.fire;
    const picks = families.map((family) => new Float64Array(family.maxPrefix + 1));
    const stateHits = new Float64Array(stateCount);
    for (const family of families) for (const step of family.steps) step.uses.fill(0);
    let entered = 0;
    let idle = 0;
    let hitCount = 0;

    // The state of the fight in progress
    const meter = new Float64Array(B);
    const procCount = new Int32Array(B);
    const locked = new Float64Array(B); // the time until which a status can't build up
    const price = new Float64Array(B); // what a right-hand hit's buildup is worth
    const priceLeft = new Float64Array(B); // and a left-hand hit's
    const dotRate = new Float64Array(B);
    const dotUntil = new Float64Array(B);
    const dotPart = new Float64Array(B);
    const afterUntil = new Float64Array(A);
    let remaining = 0;
    let t = 0;
    let kill = Infinity;
    let frostUntil = -Infinity;
    let dotEnd = -Infinity;

    /** Let poison and rot tick from t to `to`. Returns true when that kills. */
    function tick(to) {
      if (to <= t) return false;
      if (dotEnd > t) {
        let amount = 0;
        for (let b = 0; b < B; b++) {
          dotPart[b] = 0;
          if (dotUntil[b] <= t) continue;
          const end = dotUntil[b] < to ? dotUntil[b] : to;
          const frozen = frostUntil > t ? (frostUntil < end ? frostUntil : end) - t : 0;
          dotPart[b] = dotRate[b] * (end - t + (FROST_AMP - 1) * frozen);
          amount += dotPart[b];
        }
        const share = amount >= remaining ? remaining / amount : 1;
        for (let b = 0; b < B; b++) if (dotPart[b]) sources[building[b].type] += dotPart[b] * share;
        if (amount >= remaining) {
          kill = t + (to - t) * share;
          remaining = 0;
          t = kill;
          return true;
        }
        remaining -= amount;
      }
      t = to;
      return false;
    }

    for (let f = 0; fighter.canHurt && f < N; f++) {
      remaining = hp;
      t = 0;
      kill = Infinity;
      frostUntil = -Infinity;
      dotEnd = -Infinity;
      meter.fill(0);
      procCount.fill(0);
      locked.fill(-Infinity);
      dotUntil.fill(-Infinity);
      afterUntil.fill(-Infinity);
      let points = 0; // successive-attack points, and the time their drain is counted from
      let clock = 0;
      let gaps = fights.gaps[f];
      let opens = fights.opens[f];
      let j = 0;

      for (; j < MAX_OPENINGS; j++) {
        if (j >= gaps.length) {
          fights.extend(f);
          gaps = fights.gaps[f];
          opens = fights.opens[f];
        }
        // The boss attacks, then the opening starts
        if (tick(t + gaps[j])) break;
        const start = t;
        const frames = opens[j];
        entered++;

        // What one hit's buildup is worth right now, by hand
        for (let b = 0; b < B; b++) {
          const s = building[b];
          const k = procCount[b];
          const each = locked[b] > start ? 0 : s.worth / s.thresholds[k < s.thresholds.length ? k : s.thresholds.length - 1];
          price[b] = each * s.perHit[0];
          priceLeft[b] = each * s.perHit[1];
        }
        let best = -1;
        let bestCount = 0;
        let bestValue = 0;
        for (let i = 0; i < F; i++) {
          const family = families[i];
          const n = family.fit[frames];
          if (!n) continue;
          let v = family.value[n];
          const l = family.leftHits[n];
          const r = family.hitsUpTo[n] - l;
          for (let b = 0; b < B; b++) v += price[b] * r + priceLeft[b] * l;
          if (v > bestValue) {
            bestValue = v;
            best = i;
            bestCount = n;
          }
        }

        if (best < 0) idle++;
        else {
          picks[best][bestCount]++;
          const family = families[best];
          const steps = family.steps;
          for (let i = 0; i < bestCount && remaining > 0; i++) {
            const step = steps[i % steps.length];
            const at = start + family.hitTimes[i];
            if (tick(at)) break;

            let tier = 0;
            if (successive) {
              let elapsed = at - clock;
              while (points > 0) {
                const every = points >= 60 ? 0.4 : points >= 45 ? 0.7 : points >= 30 ? 1 : 0.5;
                if (elapsed < every) break;
                elapsed -= every;
                points--;
              }
              clock = points > 0 ? at - elapsed : at;
              tier = points >= 45 ? 3 : points >= 30 ? 2 : points >= 17 ? 1 : 0;
            }
            let bits = 0;
            for (let a = 0; a < A; a++) if (afterUntil[a] > at) bits |= 1 << a;
            const state = tier + tiers * bits;

            for (let h = 0; h < step.hits.length; h++) {
              const hand = step.hand[h];
              const frozen = at < frostUntil;
              const amp = frozen ? FROST_AMP : 1;
              const dealt = hitTotal(fighter, step, h, state) * amp;
              step.uses[h * stateCount + state] += amp;
              stateHits[state]++;
              hitCount++;
              sources.direct += dealt < remaining ? dealt : remaining;
              remaining -= dealt;
              // Fire thaws frostbite, which also lets frost build up again
              if (frozen && fire[hand]) {
                frostUntil = at;
                if (frostIndex >= 0) locked[frostIndex] = at;
              }

              for (let b = 0; b < B && remaining > 0; b++) {
                if (locked[b] > at) continue;
                const s = building[b];
                const add = s.perHit[hand];
                if (!add) continue;
                const k = procCount[b];
                meter[b] += add;
                if (meter[b] < s.thresholds[k < s.thresholds.length ? k : s.thresholds.length - 1]) continue;
                meter[b] = 0;
                procCount[b] = k + 1;
                procTotal[b]++;
                for (let a = 0; a < A; a++) if ((s.afterMask >> a) & 1) afterUntil[a] = at + after[a].seconds;
                if (s.kind === 1 || s.kind === 2) {
                  const proc = s.kind === 1 && at < frostUntil ? s.damage * FROST_AMP : s.damage;
                  sources[s.type] += proc < remaining ? proc : remaining;
                  remaining -= proc;
                  if (s.kind === 2) {
                    frostUntil = at + s.seconds;
                    locked[b] = frostUntil;
                  }
                } else if (s.kind === 3) {
                  dotRate[b] = s.perSecond;
                  dotUntil[b] = at + s.seconds;
                  locked[b] = dotUntil[b];
                  if (dotUntil[b] > dotEnd) dotEnd = dotUntil[b];
                }
              }
              if (remaining <= 0) {
                kill = at;
                break;
              }
            }
            if (successive && remaining > 0) {
              points = Math.min(SUCCESSIVE.cap, points + family.points);
              clock = at;
            }
          }
          if (remaining <= 0) break;
        }
        // The rest of the opening passes
        if (tick(start + frames / FPS)) break;
      }

      if (remaining <= 0) {
        times[f] = kill;
        openings[f] = j + 1;
      }
    }

    // ---- summary
    const quantile = (values, q) => {
      const sorted = Float64Array.from(values).sort();
      return sorted[Math.round(q * (N - 1))];
    };
    let sum = 0;
    for (let f = 0; f < N; f++) sum += times[f];
    const seconds = sum / N;

    // Hit damage by damage type, from how often each hit landed in each state
    const direct = {};
    let directSum = 0;
    for (const family of families) {
      for (const step of family.steps) {
        for (let index = 0; index < step.uses.length; index++) {
          const weight = step.uses[index];
          if (!weight) continue;
          const attack = step.hits[Math.floor(index / stateCount)];
          const m = fighter.stateMultiplier[index % stateCount];
          for (let i = 0; i < attack.length; i++) {
            const a = attack[i] * m;
            if (!(a > 0)) continue;
            const dealt = a * defenseMultiplier(a, fighter.defense[i]) * (1 - step.negation[i]) * weight;
            direct[DAMAGE_TYPES[i]] = (direct[DAMAGE_TYPES[i]] || 0) + dealt;
            directSum += dealt;
          }
        }
      }
    }
    // The last hit of a fight usually overkills; scale the split to the damage that counted
    for (const type of Object.keys(direct)) direct[type] = directSum > 0 ? (direct[type] / directSum) * (sources.direct / N) : 0;
    for (const key of Object.keys(sources)) sources[key] /= N;

    const procs = {};
    building.forEach((s, b) => {
      if (procTotal[b]) procs[s.type] = procTotal[b] / N;
    });

    const plan = [];
    families.forEach((family, i) => {
      for (let n = 1; n <= family.maxPrefix; n++) {
        if (!picks[i][n]) continue;
        plan.push({
          id: family.id,
          label: family.label,
          attacks: n,
          share: picks[i][n] / entered,
          seconds: family.time[n],
          stamina: family.costs[n],
          damage: family.value[n],
        });
      }
    });
    plan.sort((a, b) => b.share - a.share);

    const boosts = [];
    if (hitCount) {
      if (successive) {
        let any = 0;
        let top = 0;
        for (let state = 0; state < stateCount; state++) {
          if (state % tiers) any += stateHits[state];
          if (state % tiers === 3) top += stateHits[state];
        }
        boosts.push({ name: "Successive attacks", share: any / hitCount, top: top / hitCount });
      }
      after.forEach((a, i) => {
        let on = 0;
        for (let state = 0; state < stateCount; state++) if ((((state - (state % tiers)) / tiers) >> i) & 1) on += stateHits[state];
        boosts.push({ name: a.name, share: on / hitCount });
      });
    }

    return {
      times,
      openings,
      seconds,
      p10: quantile(times, 0.1),
      median: quantile(times, 0.5),
      p90: quantile(times, 0.9),
      dps: Number.isFinite(seconds) && seconds > 0 ? hp / seconds : 0,
      openingsToKill: quantile(openings, 0.5),
      hits: hitCount / N,
      sources,
      direct,
      procs,
      immune: fighter.immune,
      plan,
      idle: entered ? idle / entered : 0,
      boosts,
    };
  }

  /**
   * The attack families a weapon fights with in each way it can be held:
   *   "1h": in the right hand.
   *   "2h": in both hands (bows only this way). A paired weapon held in both hands swings both of
   *         its pair: its two-handed moveset, and its powerstance attacks with the same weapon in
   *         each hand. It gets no two-handing Strength bonus (see getsTwoHandBonus).
   *   "ps": powerstance, when `leftMoveset` (the moveset of a weapon of the same type for the left
   *         hand) is given and the weapon has powerstance data: its one-handed attacks plus L1
   *         with both weapons (see pairedAttacks).
   * A weapon without moveset data gets one basic hit a second in each grip, `generic` is true,
   * and it has no powerstance.
   */
  function weaponFamilies(weapon, moveset, physicalType, leftMoveset) {
    const grips = getsTwoHandBonus(weapon, false) ? ["2h"] : ["1h", "2h"];
    const families = {};
    for (const grip of grips) {
      let list = moveset ? attackFamilies(moveset[grip]) : [];
      if (grip === "2h" && weapon.paired && list.length && moveset.paired) list = list.concat(attackFamilies(moveset.paired));
      if (list.length) families[grip] = list;
    }
    const generic = Object.keys(families).length === 0;
    if (generic) for (const grip of grips) families[grip] = basicFamily(physicalType);
    else if (leftMoveset && moveset.paired && families["1h"]) {
      const paired = attackFamilies(pairedAttacks(moveset.paired, leftMoveset.paired));
      if (paired.length) families.ps = attackFamilies(moveset["1h"]).concat(paired);
    }
    return { families, generic };
  }

  /** Whether a weapon can powerstance: one-handed and powerstance attacks in its moveset. */
  function canPowerstance(weapon, moveset) {
    return !!(moveset && moveset.paired && moveset["1h"] && !getsTwoHandBonus(weapon, false)) && attackFamilies(moveset.paired).length > 0;
  }

  /**
   * The infusion that kills fastest among rankInfusions rows, as the page ranks them: kill time,
   * then attack rating, then the weapon's own order.
   */
  function fastestRow(rows) {
    let best = rows[0];
    for (const row of rows) {
      const a = row.sim.seconds;
      const b = best.sim.seconds;
      if (a < b || (a === b && row.result.total > best.result.total)) best = row;
    }
    return best;
  }

  /**
   * Every infusion of a weapon against a boss, each in the grip that kills faster: one-handed,
   * two-handed or, with a left-hand weapon, powerstanced.
   *
   * @param options {
   *   stats:     { str, dex, int, fai, arc, end } as the status screen shows them
   *   level:     upgrade level
   *   boss:      an entry of the boss database
   *   tempo:     the boss's tempo, { opening, gap, shape, spread } (see createFights)
   *   moveset:   { "1h": attacks, "2h": attacks, paired: attacks } from data/attacks.json, or
   *              null for a weapon without moveset data (it gets one basic hit a second)
   *   physicalType: the damage type of that basic hit
   *   talismans: entries of data/talismans.json
   *   blessing:  Scadutree Blessing level (0-20); it counts only against a DLC boss
   *   greases:   also fight the four physical infusions with their best grease (default true).
   *              In powerstance the grease is on the right-hand weapon only.
   *   left:      { weapon, level, moveset }: a weapon of the same type for the left hand. Each
   *              infusion then also fights in powerstance ("ps"), with the left weapon in the
   *              infusion that kills fastest alongside it: every infusion of it over the first
   *              `leftScreen` fights (default 24), then the closest two over all of them.
   *   count, seed, fights: how many fights to draw and from which seed, or a ready fights object }
   * @returns { effects, stats: with talisman points, stamina, fights, generic, grips, left,
   *            rows: [{ infusion, grip, result, sim, grips: { "1h": { result, sim }, "2h": ...,
   *                     "ps": { result, sim, left } }, left: in powerstance { weapon, infusion,
   *                     result } of the left hand, else null,
   *                     fastest: share of fights in which this infusion kills first (those
   *                     that kill at the same moment share the fight),
   *                     grease: { name, type, attack, sim } or null }] in the weapon's order }
   */
  function rankInfusions(model, weapon, options) {
    const steps = rankInfusionsInSteps(model, weapon, options);
    let step;
    while (!(step = steps.next()).done);
    return step.value;
  }

  /**
   * rankInfusions in steps, for a caller that spreads the work out: a generator that yields
   * between one infusion and the next, and within an infusion before each longer part: its
   * powerstance fights, the closest left infusions over every fight, and its grease fight. It
   * returns what rankInfusions returns, and yields how many infusions are done.
   */
  function* rankInfusionsInSteps(model, weapon, options) {
    const { boss, tempo, blessing } = options;
    const effects = talismanEffects(options.talismans);
    const stats = boostedStats(options.stats, effects);
    const stamina = staminaFor(stats.end, effects.stamina);
    const fights = options.fights || createFights(tempo, { count: options.count, seed: options.seed });
    const left = options.left && options.left.weapon ? options.left : null;
    const { families, generic } = weaponFamilies(weapon, options.moveset, options.physicalType, left && left.moveset);

    // The left weapon in each of its infusions, held in one hand
    const lefts = families.ps
      ? left.weapon.infusions.map((infusion) => ({ infusion, result: calculate(model, left.weapon, infusion, { stats, level: left.level, twoHanded: false }) }))
      : null;
    const leftScreen = { ...fights, count: Math.min(fights.count, Math.max(1, Math.floor(options.leftScreen ?? 24))) };

    const rows = [];
    for (const infusion of weapon.infusions) {
      if (rows.length) yield rows.length;
      const row = { infusion, grips: {}, grip: null, result: null, sim: null, left: null, fastest: 0, grease: null };
      for (const grip of Object.keys(families)) {
        if (grip === "ps") continue;
        const result = calculate(model, weapon, infusion, { stats, level: options.level, twoHanded: grip === "2h" });
        const fighter = prepareFighter({ result, boss, families: families[grip], grip, stamina, effects, tempo, blessing });
        const sim = simulate(fighter, fights);
        row.grips[grip] = { result, sim };
        if (!row.sim || sim.seconds < row.sim.seconds) Object.assign(row, { grip, result, sim });
      }

      if (lefts) {
        // Powerstance takes longer than the rest, so a caller gets a break before it as well
        yield rows.length;
        const result = row.grips["1h"].result;
        const pair = (l, set) =>
          simulate(prepareFighter({ result, left: l.result, boss, families: families.ps, grip: "ps", stamina, effects, tempo, blessing }), set);
        // Every infusion of the left weapon over the first fights, the closest two over all
        let picks = lefts;
        if (lefts.length > 2 && leftScreen.count < fights.count) {
          picks = lefts
            .map((l, i) => ({ l, i, seconds: pair(l, leftScreen).seconds }))
            .sort((a, b) => a.seconds - b.seconds || b.l.result.total - a.l.result.total || a.i - b.i)
            .slice(0, 2)
            .map((x) => x.l);
          yield rows.length;
        }
        let best = null;
        for (const l of picks) {
          const sim = pair(l, fights);
          if (!best || sim.seconds < best.sim.seconds || (sim.seconds === best.sim.seconds && l.result.total > best.l.result.total)) best = { l, sim };
        }
        const leftHand = { weapon: left.weapon, infusion: best.l.infusion, result: best.l.result };
        row.grips.ps = { result, sim: best.sim, left: leftHand };
        if (!row.sim || best.sim.seconds < row.sim.seconds) Object.assign(row, { grip: "ps", result, sim: best.sim, left: leftHand });
      }

      if (options.greases !== false && weapon.infusable && BUFFABLE_AFFINITIES.has(infusion.affinity)) {
        yield rows.length;
        // The grease that adds the most to a plain 100 motion value hit, on the right-hand weapon
        const m = blessingMultiplier(blessing, boss);
        const added = (g) => g.attack * m * defenseMultiplier(g.attack * m, boss.defense[g.type]) * (1 - boss.negation[g.type] / 100);
        const grease = GREASES.reduce((a, b) => (added(b) > added(a) ? b : a));
        const fighter = prepareFighter({
          result: row.result,
          left: row.left ? row.left.result : undefined,
          boss,
          families: families[row.grip],
          grip: row.grip,
          stamina,
          effects,
          tempo,
          bonus: { [grease.type]: grease.attack },
          blessing,
        });
        row.grease = { ...grease, sim: simulate(fighter, fights) };
      }
      rows.push(row);
    }

    // In how many fights is each infusion the first to kill? A kill lands on a hit, so infusions
    // often kill on the same hit of the same opening: those share the fight
    for (let f = 0; f < fights.count; f++) {
      let best = Infinity;
      for (const row of rows) if (row.sim.times[f] < best) best = row.sim.times[f];
      if (!Number.isFinite(best)) continue;
      const tied = rows.filter((row) => row.sim.times[f] === best);
      for (const row of tied) row.fastest += 1 / (tied.length * fights.count);
    }

    return { effects, stats, stamina, fights, generic, grips: Object.keys(families), families, left: lefts ? left : null, rows };
  }

  /**
   * The weapons that kill a boss fastest, each in its best infusion and grip, or powerstanced
   * with the best partner of its type in the left hand.
   *
   * Fighting every infusion of every weapon over all the fights takes tens of seconds, and every
   * pair far longer, so the search goes in stages over the same fights:
   *   1. Screen: each weapon over the first few fights (`screen`, default 24), in every infusion
   *      and grip, without greases. That is enough to tell the contenders from the rest.
   *   2. Pairs, within each weapon type that can powerstance, over the same fights. Every
   *      one-handed infusion of the screen is a hand (weapon and infusion). First the most
   *      promising hands are paired every way round, a weapon with itself too (two of it): the
   *      `hands` (default 5) fastest one-handed, the `hands` whose single hit is worth most
   *      against this boss (damage, plus status buildup valued at what a proc deals), and the
   *      one worth most for each status effect. The `partnerHands` (default 3) that made the
   *      best pairs as the left hand then partner every other hand of the type as the right.
   *   3. Final: the closest (`shortlist`, default 30), each at its best alone or as the right
   *      hand of a pair, are fought over all the fights exactly as rankInfusions fights them:
   *      alone, or with the weapon of each of their `partners` (default 1) best pairs in the left
   *      hand (which fights them alone too, and finds both hands' infusions afresh). So a result
   *      shows what the calculator shows for the same weapons. The fastest `top` (default 10)
   *      are returned, each weapon once, as the right hand.
   * Weapons without moveset data (staffs, seals, bows and the like) are left out: their one
   * basic hit a second is a stand-in, not a moveset that can be compared.
   *
   * A generator, so a page can spread the work over several frames: it yields { stage, done,
   * total } after each weapon of the screen (stage "screen"), after each pair (stage "pairs"),
   * then in the final stage (stage "final") between one infusion and the next as well, since a
   * weapon fought over every fight can take half a second against a boss with a lot of HP.
   * `done` counts finished weapons or pairs.
   *
   * @param candidates [{ weapon, level, moveset, physicalType }], as rankInfusions takes them
   * @param options    { stats, boss, tempo, talismans, blessing, fights (the full set), screen,
   *                     hands (0 for no pairs), partnerHands, partners, shortlist, top }
   * @returns { searched: how many weapons were fought, skipped: the weapons without moveset data,
   *            screen: the fights every weapon met, pairs: how many pairs were fought,
   *            shortlist: how many weapons were fought over all of them,
   *            results: [{ weapon, level, fight: rankInfusions output (with `left` set when it
   *            fought a left hand), best: its fastest row, alone or in powerstance (then best.grip
   *            is "ps" and best.left the left hand's { weapon, infusion, result }) }], fastest
   *            first, only those that can kill the boss }
   */
  function* searchWeapons(model, candidates, options) {
    const { stats, boss, tempo, talismans, blessing } = options;
    const fights = options.fights || createFights(tempo);
    // The first fights of the full set: every fight's cycles come from its own stream, so these
    // are the very fights the shortlist meets again
    const screen = { ...fights, count: Math.min(fights.count, Math.max(1, Math.floor(options.screen ?? 24))) };
    const shortlistSize = Math.max(1, Math.floor(options.shortlist ?? 30));
    const top = Math.max(1, Math.floor(options.top ?? 10));
    const handCount = Math.max(0, Math.floor(options.hands ?? 5));
    const partnerHands = Math.max(1, Math.floor(options.partnerHands ?? 3));
    const partnerCount = Math.max(1, Math.floor(options.partners ?? 1));
    const effects = talismanEffects(talismans);
    const stamina = staminaFor(boostedStats(stats, effects).end, effects.stamina);
    const fight = (c, set, greases, partner) =>
      rankInfusionsInSteps(model, c.weapon, {
        stats,
        level: c.level,
        boss,
        tempo,
        moveset: c.moveset,
        physicalType: c.physicalType,
        talismans,
        blessing,
        fights: set,
        greases,
        left: partner ? { weapon: partner.weapon, level: partner.level, moveset: partner.moveset } : undefined,
      });

    const usable = [];
    const skipped = [];
    for (const c of candidates) (weaponFamilies(c.weapon, c.moveset, c.physicalType).generic ? skipped : usable).push(c);

    // What one point of each status's buildup is worth against this boss, at its first threshold
    const statusWorth = {};
    for (const type of STATUS_TYPES) {
      const thresholds = boss.status[type];
      const effect = STATUS_EFFECTS[type];
      if (!Array.isArray(thresholds) || !effect) continue;
      const proc =
        effect.hpShare !== undefined
          ? (effect.hpShare * boss.hp + effect.flat) * (boss.statusDamage ?? 1)
          : (effect.hpSharePerSecond * boss.hp + effect.flatPerSecond) * effect.seconds;
      statusWorth[type] = proc / thresholds[0];
    }
    const hitWorth = (result) => {
      let v = hitDamage(result, boss, { multiplier: blessingMultiplier(blessing, boss) }).total;
      for (const type of Object.keys(statusWorth)) if (result.status[type]) v += statusWorth[type] * result.status[type].total;
      return v;
    };

    // 1. Every weapon alone; every infusion one-handed is also a hand for stage 2
    const singles = [];
    const hands = [];
    for (let i = 0; i < usable.length; i++) {
      const c = usable[i];
      const steps = fight(c, screen, false);
      let step;
      while (!(step = steps.next()).done);
      const best = fastestRow(step.value.rows);
      singles[i] = Number.isFinite(best.sim.seconds) ? { seconds: best.sim.seconds, ar: best.result.total } : null;
      if (handCount && canPowerstance(c.weapon, c.moveset)) {
        for (const row of step.value.rows) {
          const one = row.grips["1h"];
          if (one) hands.push({ i, c, infusion: row.infusion, result: one.result, seconds: one.sim.seconds, worth: hitWorth(one.result) });
        }
      }
      yield { stage: "screen", done: i + 1, total: usable.length };
    }

    // 2. Pairs, type by type: the most promising hands with each other, which finds the type's
    //    best left hands, then every right hand with those
    const byType = new Map();
    for (const h of hands) {
      const type = h.c.weapon.typeName;
      if (!byType.has(type)) byType.set(type, []);
      byType.get(type).push(h);
    }
    const groups = [];
    for (const all of byType.values()) {
      const picked = new Set();
      const byWorth = all.slice().sort((a, b) => b.worth - a.worth);
      all
        .filter((h) => Number.isFinite(h.seconds))
        .sort((a, b) => a.seconds - b.seconds)
        .slice(0, handCount)
        .forEach((h) => picked.add(h));
      byWorth.slice(0, handCount).forEach((h) => picked.add(h));
      for (const type of Object.keys(statusWorth)) {
        const h = byWorth.find((x) => x.result.status[type] && x.result.status[type].total > 0);
        if (h) picked.add(h);
      }
      const partners = Math.min(partnerHands, picked.size);
      groups.push({ all, picked: [...picked], partners, pairs: picked.size * picked.size + (all.length - picked.size) * partners });
    }
    const pairTotal = groups.reduce((n, g) => n + g.pairs, 0);
    const psFamilies = new Map(); // "right left" (candidate indexes) → powerstance families
    const familiesOf = (right, left) => {
      const key = `${right.i} ${left.i}`;
      if (!psFamilies.has(key)) psFamilies.set(key, weaponFamilies(right.c.weapon, right.c.moveset, right.c.physicalType, left.c.moveset).families.ps || null);
      return psFamilies.get(key);
    };
    const pairFight = (right, left, set) =>
      simulate(prepareFighter({ result: right.result, left: left.result, boss, families: familiesOf(right, left), grip: "ps", stamina, effects, tempo, blessing }), set);
    const pairsByRight = new Map();
    let pairsDone = 0;
    const fightPair = (right, left) => {
      if (!familiesOf(right, left)) return Infinity;
      const sim = pairFight(right, left, screen);
      if (Number.isFinite(sim.seconds)) {
        if (!pairsByRight.has(right.i)) pairsByRight.set(right.i, []);
        pairsByRight.get(right.i).push({ right, left, seconds: sim.seconds, ar: right.result.total });
      }
      return sim.seconds;
    };
    for (const group of groups) {
      // The promising hands every way round; a left hand counts by the best pair it makes
      const asLeft = new Map(group.picked.map((h) => [h, Infinity]));
      for (const right of group.picked) {
        for (const left of group.picked) {
          const seconds = fightPair(right, left);
          if (seconds < asLeft.get(left)) asLeft.set(left, seconds);
          yield { stage: "pairs", done: ++pairsDone, total: pairTotal };
        }
      }
      const partners = group.picked
        .filter((h) => Number.isFinite(asLeft.get(h)))
        .sort((a, b) => asLeft.get(a) - asLeft.get(b))
        .slice(0, group.partners);
      // Every other right hand of the type with the best left hands
      const inPicked = new Set(group.picked);
      for (const right of group.all) {
        if (inPicked.has(right)) continue;
        for (const left of partners) {
          fightPair(right, left);
          yield { stage: "pairs", done: ++pairsDone, total: pairTotal };
        }
        pairsDone += group.partners - partners.length; // left hands that made no pair at all
      }
    }

    // 3. The closest, alone or as a right hand, over every fight
    const estimates = [];
    for (let i = 0; i < usable.length; i++) {
      const pairs = (pairsByRight.get(i) || []).sort((a, b) => a.seconds - b.seconds || b.ar - a.ar);
      const single = singles[i];
      const pair = pairs[0];
      if (!single && !pair) continue;
      const alone = single && (!pair || single.seconds <= pair.seconds);
      estimates.push({ c: usable[i], i, seconds: alone ? single.seconds : pair.seconds, ar: alone ? single.ar : pair.ar, pairs });
    }
    estimates.sort((a, b) => a.seconds - b.seconds || b.ar - a.ar || a.i - b.i);
    const shortlist = estimates.slice(0, shortlistSize);

    const results = [];
    for (let k = 0; k < shortlist.length; k++) {
      const { c, pairs } = shortlist[k];
      // Alone, or with the partner weapon of each of its two best pairs in the left hand, exactly
      // as rankInfusions fights the weapon with that left hand (which fights it alone as well)
      const partners = [];
      for (const p of pairs) if (partners.length < partnerCount && !partners.includes(p.left.c)) partners.push(p.left.c);
      if (!partners.length) partners.push(null);
      let full = null;
      let best = null;
      for (const partner of partners) {
        const steps = fight(c, fights, true, partner);
        let step;
        while (!(step = steps.next()).done) yield { stage: "final", done: k, total: shortlist.length };
        const row = fastestRow(step.value.rows);
        if (!best || row.sim.seconds < best.sim.seconds || (row.sim.seconds === best.sim.seconds && row.result.total > best.result.total)) {
          best = row;
          full = step.value;
        }
      }
      results.push({ weapon: c.weapon, level: c.level, fight: full, best, i: k });
      yield { stage: "final", done: k + 1, total: shortlist.length };
    }
    results.sort((a, b) => a.best.sim.seconds - b.best.sim.seconds || b.best.result.total - a.best.result.total || a.i - b.i);
    return {
      searched: usable.length,
      skipped: skipped.map((c) => c.weapon),
      screen: screen.count,
      pairs: pairTotal,
      shortlist: shortlist.length,
      results: results
        .filter((r) => Number.isFinite(r.best.sim.seconds))
        .slice(0, top)
        .map(({ i, ...r }) => r),
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
    BLESSING_ATTACK,
    MAX_BLESSING,
    blessingMultiplier,
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
    FPS,
    TIMING,
    ATTACK_FAMILIES,
    SITUATIONAL_ATTACKS,
    attackFamilies,
    basicFamily,
    staminaFor,
    SUCCESSIVE,
    talismanEffects,
    attackMultiplier,
    boostedStats,
    GREASES,
    BUFFABLE_AFFINITIES,
    DEFAULT_FIGHTS,
    createFights,
    prepareFighter,
    simulate,
    weaponFamilies,
    pairedAttacks,
    canPowerstance,
    fastestRow,
    rankInfusions,
    rankInfusionsInSteps,
    searchWeapons,
  };
});
