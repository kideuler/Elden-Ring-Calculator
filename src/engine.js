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
 *   attack  = AR(type) x motion value x attack multipliers (talismans)
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
    { id: "r1", label: "R1", kind: "light", points: 8, pattern: /^R1 \d$/ },
    { id: "r2", label: "R2", kind: "heavy", points: 10, pattern: /^R2 \d$/, windup: true },
    { id: "charged-r2", label: "Charged R2", kind: "charged", points: 14, pattern: /^Charged R2 \d$/ },
    { id: "jump-r1", label: "Jump R1", kind: "jump", points: 8, pattern: /^Jumping R1$/, airtime: true },
    { id: "jump-r2", label: "Jump R2", kind: "jump", points: 10, pattern: /^Jumping R2$/, airtime: true },
  ];

  /** Attacks that need a sprint, roll, backstep or block first, so the model doesn't plan them. */
  const SITUATIONAL_ATTACKS = ["Running R1", "Running R2", "Rolling R1", "Backstep R1", "Guard Counter"];

  /**
   * The attack families in one grip of a moveset, with their timing in seconds.
   * @param attacks  [[name, [motion value per hit], physical type, frames until the next attack
   *                 can start, frames until a dodge can start, stamina cost], ...] as in
   *                 data/attacks.json (the last three may be null)
   * @returns [{ id, label, kind, points, estimated, steps: [{ name, mvs, type, chain, exit,
   *            stamina, finisher, frames, exitFrames }] }]. A family with an attack the animation
   *            data doesn't cover is left out, since it can't be timed.
   */
  function attackFamilies(attacks) {
    const families = [];
    for (const def of ATTACK_FAMILIES) {
      const list = (attacks || []).filter((a) => def.pattern.test(a[0]));
      if (!list.length || list.some((a) => a[3] == null || a[4] == null)) continue;
      const extra = (def.windup ? TIMING.windup : 0) + (def.airtime ? TIMING.airtime : 0);
      const steps = list.map(([name, mvs, type, next, exit, stamina], i) => ({
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
        finisher: def.id === "r1" && list.length > 1 && i === list.length - 1,
        frames: next,
        exitFrames: exit,
      }));
      families.push({ id: def.id, label: def.label, kind: def.kind, points: def.points, estimated: extra > 0, steps });
    }
    return families;
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
   * @param options { result: calculate() output, boss, families: attackFamilies() output,
   *                  grip: "1h" | "2h", stamina (default: unlimited), effects: talismanEffects()
   *                  output, bonus: flat attack added per damage type (a grease), tempo: the
   *                  boss's tempo (used to value frostbite when choosing attacks) }
   */
  function prepareFighter(options) {
    const { result, boss } = options;
    const effects = options.effects || talismanEffects([]);
    const twoHanded = options.grip === "2h";
    const stamina = options.stamina ?? Infinity;
    const bonus = options.bonus || {};

    const ar = DAMAGE_TYPES.map((t) => ((result.damage[t] && result.damage[t].total) || 0) + (bonus[t] || 0));
    const typeMultiplier = DAMAGE_TYPES.map((t) => effects.damage[t] || 1);
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

    const fighter = { boss, result, grip: twoHanded ? "2h" : "1h", stamina, effects, tiers, after, stateCount, stateMultiplier, defense };

    const families = [];
    for (const family of options.families || []) {
      const steps = family.steps.map((step) => {
        const multiplier = attackMultiplier(effects, fighter.grip, family, step);
        const hits = step.mvs.map((mv) => ar.map((a, i) => (a * mv * multiplier * typeMultiplier[i]) / 100));
        return {
          source: step,
          chain: step.chain,
          exit: step.exit,
          stamina: step.stamina,
          negation: DAMAGE_TYPES.map((t) => boss.negation[t === "physical" ? step.type : t] / 100),
          hits,
          cache: new Float64Array(hits.length * stateCount).fill(NaN), // damage per hit and state
          uses: new Float64Array(hits.length * stateCount), // filled by simulate()
        };
      });

      // time[n], value[n] and hitsUpTo[n] describe the string of the family's first n attacks
      const time = [0];
      const value = [0];
      const hitsUpTo = [0];
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
        for (let h = 0; h < step.hits.length; h++) v += hitTotal(fighter, step, h, 0);
        time.push(total);
        value.push(v);
        hitsUpTo.push(hitsUpTo[n - 1] + step.hits.length);
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
      families.push({ id: family.id, label: family.label, kind: family.kind, points: family.points, source: family, steps, time, value, hitsUpTo, costs, hitTimes, maxPrefix, fit });
    }

    // Status effects the weapon builds up on this boss
    const statusDamage = boss.statusDamage ?? 1;
    const building = [];
    const immune = [];
    for (const type of STATUS_TYPES) {
      const s = result.status[type];
      if (!s || !(s.total > 0)) continue;
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
      const entry = { type, perHit: s.total, thresholds, afterMask, kind: 0, damage: 0, perSecond: 0, seconds: 0, worth: 0 };
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
    fighter.fire = ar[DAMAGE_TYPES.indexOf("fire")] > 0;
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
   * - Every hit adds the weapon's full status buildup. When a meter reaches the boss's
   *   resistance the status procs, the meter empties, and the next proc needs the next (higher)
   *   threshold of boss.status[type]; past the end of that list, its last value.
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
    const price = new Float64Array(B);
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

        // What one hit's buildup is worth right now
        for (let b = 0; b < B; b++) {
          const s = building[b];
          const k = procCount[b];
          price[b] = locked[b] > start ? 0 : (s.worth * s.perHit) / s.thresholds[k < s.thresholds.length ? k : s.thresholds.length - 1];
        }
        let best = -1;
        let bestCount = 0;
        let bestValue = 0;
        for (let i = 0; i < F; i++) {
          const family = families[i];
          const n = family.fit[frames];
          if (!n) continue;
          let v = family.value[n];
          for (let b = 0; b < B; b++) v += price[b] * family.hitsUpTo[n];
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
              const frozen = at < frostUntil;
              const amp = frozen ? FROST_AMP : 1;
              const dealt = hitTotal(fighter, step, h, state) * amp;
              step.uses[h * stateCount + state] += amp;
              stateHits[state]++;
              hitCount++;
              sources.direct += dealt < remaining ? dealt : remaining;
              remaining -= dealt;
              // Fire thaws frostbite, which also lets frost build up again
              if (frozen && fighter.fire) {
                frostUntil = at;
                if (frostIndex >= 0) locked[frostIndex] = at;
              }

              for (let b = 0; b < B && remaining > 0; b++) {
                if (locked[b] > at) continue;
                const s = building[b];
                const k = procCount[b];
                meter[b] += s.perHit;
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
   * Every infusion of a weapon against a boss, each in the grip that kills faster.
   *
   * @param options {
   *   stats:     { str, dex, int, fai, arc, end } as the status screen shows them
   *   level:     upgrade level
   *   boss:      an entry of the boss database
   *   tempo:     the boss's tempo, { opening, gap, shape, spread } (see createFights)
   *   moveset:   { "1h": attacks, "2h": attacks } from data/attacks.json, or null for a weapon
   *              without moveset data (it gets one basic hit a second)
   *   physicalType: the damage type of that basic hit
   *   talismans: entries of data/talismans.json
   *   greases:   also fight the four physical infusions with their best grease (default true)
   *   count, seed, fights: how many fights to draw and from which seed, or a ready fights object }
   * @returns { effects, stats: with talisman points, stamina, fights, generic, grips,
   *            rows: [{ infusion, grip, result, sim, grips: { "1h": { result, sim }, "2h": ... },
   *                     fastest: share of fights in which this infusion kills first,
   *                     grease: { name, type, attack, sim } or null }] in the weapon's order }
   */
  function rankInfusions(model, weapon, options) {
    const { boss, tempo } = options;
    const effects = talismanEffects(options.talismans);
    const stats = boostedStats(options.stats, effects);
    const stamina = staminaFor(stats.end, effects.stamina);
    const fights = options.fights || createFights(tempo, { count: options.count, seed: options.seed });

    // Paired weapons have no two-handed stance; bows are always held in two hands
    const grips = weapon.paired ? ["1h"] : getsTwoHandBonus(weapon, false) ? ["2h"] : ["1h", "2h"];
    const families = {};
    const moveset = options.moveset || null;
    for (const grip of grips) {
      const list = moveset ? attackFamilies(moveset[grip]) : [];
      if (list.length) families[grip] = list;
    }
    const generic = Object.keys(families).length === 0;
    if (generic) for (const grip of grips) families[grip] = basicFamily(options.physicalType);

    const rows = weapon.infusions.map((infusion) => {
      const row = { infusion, grips: {}, grip: null, result: null, sim: null, fastest: 0, grease: null };
      for (const grip of Object.keys(families)) {
        const result = calculate(model, weapon, infusion, { stats, level: options.level, twoHanded: grip === "2h" });
        const fighter = prepareFighter({ result, boss, families: families[grip], grip, stamina, effects, tempo });
        const sim = simulate(fighter, fights);
        row.grips[grip] = { result, sim };
        if (!row.sim || sim.seconds < row.sim.seconds) Object.assign(row, { grip, result, sim });
      }

      if (options.greases !== false && weapon.infusable && BUFFABLE_AFFINITIES.has(infusion.affinity)) {
        // The grease that adds the most to a plain 100 motion value hit
        const added = (g) => g.attack * defenseMultiplier(g.attack, boss.defense[g.type]) * (1 - boss.negation[g.type] / 100);
        const grease = GREASES.reduce((a, b) => (added(b) > added(a) ? b : a));
        const fighter = prepareFighter({
          result: row.result,
          boss,
          families: families[row.grip],
          grip: row.grip,
          stamina,
          effects,
          tempo,
          bonus: { [grease.type]: grease.attack },
        });
        row.grease = { ...grease, sim: simulate(fighter, fights) };
      }
      return row;
    });

    // In how many fights is each infusion the first to kill?
    for (let f = 0; f < fights.count; f++) {
      let best = -1;
      for (let i = 0; i < rows.length; i++) {
        if (rows[i].sim.times[f] < (best < 0 ? Infinity : rows[best].sim.times[f])) best = i;
      }
      if (best >= 0) rows[best].fastest += 1 / fights.count;
    }

    return { effects, stats, stamina, fights, generic, grips: Object.keys(families), families, rows };
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
    rankInfusions,
  };
});
