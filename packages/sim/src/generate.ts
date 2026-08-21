/**
 * Seeded player and club generation.
 *
 * The engine does not need this to run a match -- a real season feeds it rows from
 * the database. It exists so the balance harness, the tests and a local `match`
 * run can conjure a plausible league out of nothing but a seed.
 */

import { buildSquad } from './lineup.js';
import { POSITION_WEIGHTS, clamp, weighted } from './ratings.js';
import { DEFAULT_RULES, type RuleSet } from './rules.js';
import type { Rng } from './rng.js';
import type { Attribute, Attributes, Player, Position, Squad, Tactics } from './types.js';

const ALL_ATTRIBUTES: Attribute[] = [
  'flying',
  'handling',
  'aim',
  'strength',
  'vision',
  'reflexes',
  'nerve',
];

const FIRST_NAMES = [
  'Alaric', 'Bertram', 'Cassia', 'Demelza', 'Edric', 'Fenella', 'Gideon', 'Harriet',
  'Isolde', 'Jarvis', 'Katriona', 'Lysander', 'Marigold', 'Nolan', 'Ophelia', 'Perrin',
  'Quilla', 'Rowena', 'Silas', 'Tamsin', 'Ulric', 'Verity', 'Wendell', 'Xanthe',
  'Yorick', 'Zinnia', 'Aldous', 'Briony', 'Corvin', 'Dorcas', 'Emlyn', 'Fitzroy',
  'Greta', 'Hesper', 'Imogen', 'Jocasta', 'Kestrel', 'Linus', 'Maeve', 'Nerissa',
];

const LAST_NAMES = [
  'Ashdown', 'Blackwood', 'Corbray', 'Dunmore', 'Everleigh', 'Fairweather', 'Glimmer',
  'Hollowell', 'Ivory', 'Jessop', 'Kettleburn', 'Larkspur', 'Mudge', 'Nettlefold',
  'Oakhart', 'Prewitt', 'Quaile', 'Ravensworth', 'Stillwater', 'Thistlewood', 'Umbridge',
  'Vance', 'Wickersham', 'Yaxley', 'Ainsworth', 'Bramblewick', 'Crowhurst', 'Dewsbury',
  'Elderflower', 'Frostbourne', 'Gaunt', 'Hawksmoor', 'Inkpen', 'Jorkins', 'Kirkwall',
  'Lamplight', 'Marchbanks', 'Nightingale', 'Ollerton', 'Pyrewood',
  'Quillon', 'Rookwood', 'Sallowby', 'Tarbeck', 'Underhill', 'Voss', 'Weatherby',
  'Ashgrove', 'Barrowfield', 'Cinderby', 'Draycott', 'Emberly', 'Fallowbrook',
  'Grimsdale', 'Harrowgate', 'Idlewood', 'Jarrow', 'Kelmscott', 'Loxley',
  'Merriweather', 'Nunnery', 'Orpington', 'Penhaligon', 'Quintrell', 'Ruddock',
  'Sparrowhawk', 'Tanglewood', 'Ufford', 'Vellacott', 'Wraysbury', 'Yarrow',
  'Alderbrook', 'Bellweather', 'Chalcombe', 'Danesfield',
];

export function generateName(rng: Rng): string {
  return `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
}

function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index--) {
    const swap = rng.int(index + 1);
    const held = copy[index]!;
    copy[index] = copy[swap]!;
    copy[swap] = held;
  }
  return copy;
}

/**
 * Names drawn without replacement.
 *
 * A squad with two Jorkinses makes a match report unreadable -- "set up by
 * Jorkins" has to identify one person. Shuffling both pools and walking them
 * together keeps every name in a club distinct.
 */
export function createNameSource(rng: Rng): () => string {
  const firstNames = shuffled(FIRST_NAMES, rng);
  const lastNames = shuffled(LAST_NAMES, rng);
  let index = 0;
  return () => {
    const name = `${firstNames[index % firstNames.length]} ${lastNames[index % lastNames.length]}`;
    index += 1;
    return name;
  };
}

export interface GeneratePlayerOptions {
  id: string;
  position: Position;
  /** Target rating in that position, 1-99. */
  rating: number;
  age?: number;
  name?: string;
  spread?: number;
}

/**
 * Build attributes that land on a target rating for a position: relevant ones
 * around the target, the rest a little lower, then one correction pass so the
 * weighted rating hits the number asked for.
 */
export function generateAttributes(
  rng: Rng,
  position: Position,
  rating: number,
  spread = 6,
): Attributes {
  const weights = POSITION_WEIGHTS[position];
  const attributes = {} as Attributes;

  for (const attribute of ALL_ATTRIBUTES) {
    const relevant = (weights[attribute] ?? 0) > 0;
    const centre = relevant ? rating : rating - 8;
    attributes[attribute] = clamp(Math.round(rng.normal(centre, spread)), 15, 99);
  }

  // Weights sum to 1, so shifting every weighted attribute by d moves the
  // rating by exactly d.
  const delta = rating - weighted(attributes, weights);
  for (const attribute of ALL_ATTRIBUTES) {
    if ((weights[attribute] ?? 0) > 0) {
      attributes[attribute] = clamp(Math.round(attributes[attribute] + delta), 15, 99);
    }
  }

  return attributes;
}

export function generatePlayer(rng: Rng, options: GeneratePlayerOptions): Player {
  const age = options.age ?? clamp(Math.round(rng.normal(25, 4)), 17, 36);
  const rating = clamp(options.rating, 20, 95);
  const attributes = generateAttributes(rng, options.position, rating, options.spread);

  // Young players have room left; a 33-year-old is what they are.
  const growth = age <= 21 ? rng.range(8, 22) : age <= 26 ? rng.range(2, 10) : rng.range(0, 3);

  return {
    id: options.id,
    name: options.name ?? generateName(rng),
    age,
    position: options.position,
    attributes,
    stamina: Math.round(rng.range(88, 100)),
    form: clamp(Math.round(rng.normal(50, 10)), 20, 80),
    morale: clamp(Math.round(rng.normal(55, 12)), 20, 90),
    // Round after clamping: the floor here is the unrounded target rating, so
    // rounding first lets a fractional rating leak through as the potential.
    potential: Math.round(clamp(rating + growth, rating, 99)),
  };
}

export type Archetype = 'balanced' | 'chaserHeavy' | 'beaterHeavy' | 'keeperHeavy' | 'seekerHeavy';

/** Starters by position, which is what a squad's strength is averaged over. */
const STARTERS: Record<Position, number> = { chaser: 3, beater: 2, keeper: 1, seeker: 1 };
const STARTER_TOTAL = 7;
/** Total rating points an archetype concentrates on its favoured position. */
const CONCENTRATION = 18;

/**
 * Per-position rating offsets that leave the starting seven's mean rating
 * unchanged, so archetypes can be compared without one simply being stronger.
 */
export function archetypeOffsets(archetype: Archetype): Record<Position, number> {
  const offsets: Record<Position, number> = { chaser: 0, beater: 0, keeper: 0, seeker: 0 };
  if (archetype === 'balanced') return offsets;

  const favoured: Position =
    archetype === 'chaserHeavy'
      ? 'chaser'
      : archetype === 'beaterHeavy'
        ? 'beater'
        : archetype === 'keeperHeavy'
          ? 'keeper'
          : 'seeker';

  const boost = CONCENTRATION / STARTERS[favoured];
  const penalty = CONCENTRATION / (STARTER_TOTAL - STARTERS[favoured]);
  for (const position of Object.keys(offsets) as Position[]) {
    offsets[position] = position === favoured ? boost : -penalty;
  }
  return offsets;
}

export const DEFAULT_TACTICS: Tactics = {
  aggression: 'balanced',
  seekerCommitment: 'balanced',
  beaterFocus: 'seeker',
  chaseTheGame: true,
};

export interface GenerateClubOptions {
  clubId: string;
  name: string;
  short: string;
  /** Mean rating of the starting seven. */
  rating: number;
  archetype?: Archetype;
  tactics?: Partial<Tactics>;
  rules?: RuleSet;
}

/** Squad depth: enough that a bench exists and substitutions mean something. */
const ROSTER: Record<Position, number> = { chaser: 6, beater: 4, keeper: 2, seeker: 2 };

export function generateRoster(rng: Rng, options: GenerateClubOptions): Player[] {
  const offsets = archetypeOffsets(options.archetype ?? 'balanced');
  const nextName = createNameSource(rng);
  const players: Player[] = [];

  for (const position of Object.keys(ROSTER) as Position[]) {
    const count = ROSTER[position];
    for (let index = 0; index < count; index++) {
      // Squad players sit below the starters; the drop-off is what makes a
      // deep bench worth paying for.
      const depthPenalty = index < STARTERS[position] ? 0 : 5 + 2 * (index - STARTERS[position]);
      players.push(
        generatePlayer(rng, {
          id: `${options.clubId}-${position[0]}${index + 1}`,
          name: nextName(),
          position,
          rating: options.rating + offsets[position] - depthPenalty + rng.normal(0, 3),
        }),
      );
    }
  }

  return players;
}

export function generateClub(rng: Rng, options: GenerateClubOptions): Squad {
  const roster = generateRoster(rng, options);
  const tactics: Tactics = { ...DEFAULT_TACTICS, ...options.tactics };
  return buildSquad(
    { clubId: options.clubId, name: options.name, short: options.short },
    roster,
    tactics,
    options.rules ?? DEFAULT_RULES,
  );
}
