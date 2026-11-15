/**
 * Chooses an image for every compendium entry.
 *
 * An image dropped into assets/icons/<pack>/ and named after the entry always wins. Otherwise an icon is picked
 * from the library that ships with Foundry: each kind of entry has a pool of fitting icons, words in the entry's
 * name narrow the pool ("Silver", "Killer", "Hand", "Vulnerary", "Key"), and the choice within the pool depends
 * only on the name, so a rebuild picks the same icon again and entries that share a pool still differ.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { ROOT, manifest, slugify } from "./pack.mjs";

const IMAGE_TYPES = [".webp", ".png", ".jpg", ".jpeg", ".svg", ".gif", ".avif"];

/* -------------------------------------------- */
/*  The Library                                 */
/* -------------------------------------------- */

/**
 * Foundry's bundled icons, read from its install.
 */
export class IconLibrary {

  /**
   * @param {string} app      Foundry's "resources/app" folder
   */
  constructor(app) {
    this.root = join(app, "public");
    this.folders = new Map();
  }

  /**
   * The icons of a folder, as paths Foundry can load.
   * @param {string} folder           For example "weapons/swords"
   * @param {RegExp} [pattern]        Keeps the icons whose file name matches
   * @param {RegExp} [except]         Drops the icons whose file name matches
   * @returns {string[]}
   */
  select(folder, pattern, except) {
    if ( !this.folders.has(folder) ) {
      const path = join(this.root, "icons", folder);
      const files = existsSync(path) ? readdirSync(path).filter((file) => file.endsWith(".webp")).sort() : [];
      this.folders.set(folder, files);
    }
    return this.folders.get(folder).filter((file) => {
      const name = file.slice(0, -5);
      return (!pattern || pattern.test(name)) && (!except || !except.test(name));
    }).map((file) => `icons/${folder}/${file}`);
  }

  /**
   * Does an image exist? Checks Foundry's own files and the system's.
   * @param {string} path
   * @returns {boolean}
   */
  exists(path) {
    if ( path.startsWith(`systems/${manifest.id}/`) ) return existsSync(join(ROOT, path.slice(`systems/${manifest.id}/`.length)));
    return existsSync(join(this.root, path));
  }
}

/* -------------------------------------------- */
/*  Words That Narrow a Pool                    */
/* -------------------------------------------- */

/**
 * Words in an entry's name, and the words in an icon's file name that suit them, best first. File names are
 * words joined by dashes and are matched a whole word at a time. The first line that matches the entry's name
 * and leaves at least one icon of the pool is used.
 * @type {[RegExp, string[]][]}
 */
const MATERIALS = [
  [/\b(rusted|broken|drained)\b/i, ["worn|chipped|cracked|notched|mended|damaged"]],
  [/\b(training|backup|compact|wooden)\b/i, ["wood|wooden", "simple"]],
  [/\b(bronze|brass)\b/i, ["bronze|brass|copper", "brown"]],
  [/\b(devil|evil|fiend\w*|demon\w*|cursed|wicked|sinister|deathly|shadow|dark|necro|reaper)\b/i,
    ["evil|skull|eye|eyes", "black|blackened|obsidian", "purple"]],
  [/\b(glass|crystal|sapphire|frost|ice|chill)\b/i, ["crystal|ice", "glow|glowing", "blue"]],
  [/\b(iron)\b/i, ["iron", "simple", "grey|gray"]],
  [/\b(steel)\b/i, ["steel", "grey|gray"]],
  [/\b(silver)\b/i, ["silver", "steel", "white"]],
  [/\b(killer|killing|lethal|assassin'?s?)\b/i, ["serrated|jagged|hooked|barbed|katana|crooked", "curved", "red"]],
  [/\b(brave|golden|gold|emblem|king\w*|royal|superior|meister\w*|hero)\b/i,
    ["gold|golden", "ornate|jewel|jeweled|embossed", "engraved"]],
  [/\b(blessed|holy|light|bright|radiant|miracle|aura|sacred|angel|goddess|divine)\b/i,
    ["holy", "winged|glowing", "gold|white"]],
  [/\b(venin|poison|toxin|plague|rotten|fetid|blighted)\b/i, ["poison|poisoned", "green"]],
  [/\b(flame|fire|searing|inferno|burning|flaming|ruby|red)\b/i, ["fire|lava", "red", "orange"]],
  [/\b(thunder|levin|bolt|shock\w*|spark)\b/i, ["lightning", "energy", "yellow"]],
  [/\b(wind|gale|storm|zephyr|tempest|sonic|wing\w*|volant)\b/i, ["winged", "teal", "white"]],
  [/\b(water|blue|coral)\b/i, ["water", "blue", "teal"]],
  [/\b(earth|emerald|green)\b/i, ["stone", "green", "brown"]],
  [/\b(slim|quick)\b/i, ["thin", "simple", "short"]],
  [/\b(serrated|barbed|ripper|rending|spiked)\b/i, ["serrated|jagged|barbed|spiked"]],
  [/\b(hunting|beast\w*|wolf|tiger|horn|bone)\b/i, ["bone|tribal|animal|skull", "leather"]],
  [/\b(jewel|rune\w*|magic|mystic|arcane|spell\w*|mage\w*|enchanted)\b/i,
    ["runed|runes|rune|glowing|magical", "jewel|jeweled|gem|crystal", "engraved"]],
  [/\b(purple|pink|black|white|yellow)\b/i, []]
];

/**
 * Does an icon's file name have one of a set of words in it?
 * @param {string} path       The icon
 * @param {string} words      The words, separated by "|"
 * @returns {boolean}
 */
function hasWord(path, words) {
  return new RegExp(`(^|-)(${words})(-|$)`).test(basename(path, ".webp"));
}

/* -------------------------------------------- */
/*  The Picker                                  */
/* -------------------------------------------- */

/**
 * Picks the image of each entry of one compendium and keeps count of what it picked.
 */
export class IconPicker {

  /**
   * @param {IconLibrary} library
   * @param {string} pack           The compendium's name, which is also its folder under assets/icons
   */
  constructor(library, pack) {
    this.library = library;
    this.pack = pack;
    this.folder = join(ROOT, "assets", "icons", pack);
    this.used = new Map();
    this.sources = { own: 0, keyword: 0, pool: 0, fallback: 0 };
    this.listing = [];

    /** The user's own images, by the slug of their file name. */
    this.own = new Map();
    if ( existsSync(this.folder) ) {
      for ( const file of readdirSync(this.folder).sort() ) {
        if ( !IMAGE_TYPES.includes(extname(file).toLowerCase()) ) continue;
        const slug = slugify(basename(file, extname(file)));
        if ( !this.own.has(slug) ) this.own.set(slug, `systems/${manifest.id}/assets/icons/${pack}/${file}`);
      }
    }
    this.ownUsed = new Set();
  }

  /**
   * The icons of a folder of the library.
   * @param {string} folder
   * @param {RegExp} [pattern]
   * @param {RegExp} [except]
   * @returns {string[]}
   */
  from(folder, pattern, except) {
    return this.library.select(folder, pattern, except);
  }

  /**
   * Choose an entry's image.
   * @param {object} entry
   * @param {string} entry.name             The entry's name
   * @param {string[]} entry.slugs          File names the user may give their own image, most specific first
   * @param {string} [entry.group]          Where the entry sits, for the list of names
   * @param {[RegExp, string[]][]} [entry.shapes]   Pools for names that say what the thing looks like; the first
   *                                                whose expression matches and whose pool is not empty is used
   * @param {string[]} entry.pool           The pool for every other name
   * @param {string} entry.fallback         The image when every pool is empty
   * @param {boolean} [entry.materials]     Whether words such as "Silver" narrow the pool. Defaults to true.
   * @returns {string}
   */
  pick({ name, slugs, group = "", shapes = [], pool, fallback, materials = true }) {
    const image = this.#choose({ name, slugs, shapes, pool, fallback, materials });
    this.used.set(image, (this.used.get(image) ?? 0) + 1);
    this.listing.push({ slug: slugs.at(-1), specific: slugs.length > 1 ? slugs[0] : "", name, group, image });
    return image;
  }

  #choose({ name, slugs, shapes, pool, fallback, materials }) {
    for ( const slug of slugs ) {
      if ( this.own.has(slug) ) {
        this.sources.own++;
        this.ownUsed.add(slug);
        return this.own.get(slug);
      }
    }
    let source = "pool";
    let candidates = pool;
    for ( const [expression, shaped] of shapes ) {
      if ( expression.test(name) && shaped.length ) {
        candidates = shaped;
        source = "keyword";
        break;
      }
    }
    if ( !candidates.length ) {
      this.sources.fallback++;
      return fallback;
    }
    if ( materials ) {
      narrowing: for ( const [expression, suits] of MATERIALS ) {
        const match = expression.exec(name);
        if ( !match ) continue;
        for ( const words of suits.length ? suits : [match[1].toLowerCase()] ) {
          const narrowed = candidates.filter((path) => hasWord(path, words));
          if ( !narrowed.length ) continue;
          candidates = narrowed;
          source = "keyword";
          break narrowing;
        }
      }
    }
    this.sources[source]++;
    return rendezvous(name, candidates);
  }

  /**
   * Write the list of file names the user's own images can take, beside those images.
   */
  writeNames() {
    mkdirSync(this.folder, { recursive: true });
    const seen = new Set();
    const rows = [];
    for ( const { slug, specific, name, group, image } of this.listing ) {
      const key = `${specific || slug}`;
      if ( seen.has(key) ) continue;
      seen.add(key);
      rows.push([slug, specific, name, group, image]);
    }
    const header = [
      `File names for your own ${this.pack} images. Put an image in this folder, named as in the first column`,
      "(for example iron-axe.webp or iron-axe.png; \"Iron Axe.png\" works too), and build the compendium again.",
      "Where two entries share a name, the second column is the name that picks out just one of them.",
      "This list is rewritten by every build.",
      "",
      ["file name", "more specific file name", "entry", "folder", "image used now"].join("\t")
    ];
    writeFileSync(join(this.folder, "names.txt"), [...header, ...rows.map((row) => row.join("\t"))].join("\n") + "\n");
  }

  /**
   * Lines for the build report.
   * @returns {string[]}
   */
  summary() {
    const { own, keyword, pool, fallback } = this.sources;
    const lines = [
      `${String(own).padStart(5)}  your own images from assets/icons/${this.pack}`,
      `${String(keyword).padStart(5)}  picked by a word in the name`,
      `${String(pool).padStart(5)}  picked from the pool for their kind`
    ];
    if ( fallback ) lines.push(`${String(fallback).padStart(5)}  given the fallback image because their pool was empty`);
    lines.push(`${String(this.used.size).padStart(5)}  different images in all`);
    const unused = [...this.own.keys()].filter((slug) => !this.ownUsed.has(slug));
    if ( unused.length ) lines.push(`Images in assets/icons/${this.pack} that match no entry: ${unused.join(", ")}`);
    return lines;
  }
}

/**
 * Choose one of a pool for a name, so that the same name always gets the same icon and adding icons to the pool
 * changes few choices.
 * @param {string} name
 * @param {string[]} pool
 * @returns {string}
 */
function rendezvous(name, pool) {
  let best = pool[0];
  let bestScore = "";
  for ( const path of pool ) {
    const score = createHash("sha1").update(`${name}|${path}`).digest("hex");
    if ( score > bestScore ) {
      best = path;
      bestScore = score;
    }
  }
  return best;
}
