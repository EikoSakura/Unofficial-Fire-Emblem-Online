/**
 * The class tree of the Compendium: which classes make a line, where each class stands on the map, and how the
 * roads between them run. The tree grows upward: the lowest tier stands along the foot and each tier above it
 * is a promotion.
 *
 * Nothing here touches Foundry or the page. A class is described by the few things the tree needs to know of
 * it, and what comes back is plain numbers and SVG path data for whatever draws it.
 */

/**
 * @typedef {object} TreeClass
 * @property {string} id
 * @property {string} name
 * @property {number} order           The order of its tier, lowest first
 * @property {number} sort            Its place among the classes
 * @property {string[]} targets       The ids of the classes it promotes to
 */

/**
 * @typedef {object} TreeNode
 * @property {string} id
 * @property {number} x               The centre of the class
 * @property {number} y               The top of the class
 * @property {number} row             Its tier's row, 0 at the foot
 * @property {number} line            The index of its line in `lines`
 */

/**
 * @typedef {object} TreeRoad
 * @property {string} from
 * @property {string} to
 * @property {boolean} outside        Does it come from outside the line of the class it reaches?
 * @property {string} d               The road
 * @property {string} head            Its arrowhead
 */

/**
 * @typedef {object} TreeLine
 * @property {string} lead            The id of the class it is named after: the first of its lowest tier
 * @property {number} size            How many classes it holds
 * @property {number} tiers           How many tiers it spans
 * @property {number} x               Its left edge
 * @property {number} width
 * @property {number} top             The top of its highest class
 * @property {number} bottom          The foot of its lowest class
 * @property {boolean} loose          A class that stands by itself, outside the run of lines
 */

/**
 * @typedef {object} ClassTree
 * @property {number} width
 * @property {number} height
 * @property {TreeNode[]} nodes
 * @property {TreeRoad[]} roads
 * @property {TreeLine[]} lines
 * @property {{order: number, row: number, y: number, divider: number|null}[]} tiers
 *   For each tier, top first: where its classes stand, and the rule between it and the tier above
 */

/** The measures of the map, in pixels. */
export const TREE = {
  column: 88,       // the width a class takes
  gap: 24,          // between two lines
  left: 26,
  right: 30,
  node: 110,        // the height of a class: crest, pedestal and nameplate
  stem: 12,         // how far below the top of a class its road starts
  top: 50,          // above the highest tier, where the lines hang their names
  foot: 22,         // below the lowest tier
  lane: 12,         // between two roads that run side by side
  port: 11          // between two roads that arrive at the same class
};

/* -------------------------------------------- */
/*  Names                                       */
/* -------------------------------------------- */

const fold = (name) => String(name ?? "").trim().toLowerCase();

/**
 * Do two names speak of the same class? The Class Sheet heads some classes with two names, as
 * "Barbarian/Buccaneer", and speaks of them elsewhere by either one. It also lists some in several forms, as
 * "Flier Lord (Pegasus)", and speaks of all of them at once as "Flier Lord".
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function sameClassName(a, b) {
  const [left, right] = [fold(a), fold(b)];
  if ( !left || !right ) return false;
  if ( left === right ) return true;
  const parts = (name) => [...name.split("/").map((part) => part.trim()), name.replace(/s*(.*)s*$/, "")];
  return parts(left).includes(right) || parts(right).includes(left);
}

/* -------------------------------------------- */
/*  Lines                                       */
/* -------------------------------------------- */

/**
 * Gather classes into lines, the lowest tier first. A class starts a line and takes its promotions with it,
 * and theirs in turn. A later class whose promotions all belong to one line joins that line, as a Crossbowman
 * joins the Archer's; one whose promotions belong to several lines stands by itself. A class of a tier below
 * `floor`, as a Trainee is, always stands by itself: it leads to lines and is part of none.
 * @param {TreeClass[]} classes
 * @param {Map<string, TreeClass>} byId
 * @param {number} floor
 * @returns {{classes: TreeClass[]}[]}
 */
function gatherLines(classes, byId, floor) {
  const lines = [];
  const lineOf = new Map();
  const join = (line, cls) => {
    line.classes.push(cls);
    lineOf.set(cls.id, line);
  };
  const open = () => {
    const line = { classes: [] };
    lines.push(line);
    return line;
  };
  const targets = (cls) => cls.targets.map((id) => byId.get(id)).filter((target) => target && (target.order > cls.order));
  const adopt = (line, cls) => {
    join(line, cls);
    for ( const target of targets(cls) ) {
      if ( !lineOf.has(target.id) ) adopt(line, target);
    }
  };
  const sorted = [...classes].sort((a, b) => (a.order - b.order) || (a.sort - b.sort));
  for ( const cls of sorted.filter((entry) => entry.order >= floor) ) {
    if ( lineOf.has(cls.id) ) continue;
    const homes = new Set(targets(cls).map((target) => lineOf.get(target.id)).filter(Boolean));
    if ( homes.size === 1 ) adopt([...homes][0], cls);
    else if ( homes.size > 1 ) join(open(), cls);
    else adopt(open(), cls);
  }
  for ( const cls of sorted.filter((entry) => entry.order < floor) ) join(open(), cls);
  return lines;
}

/* -------------------------------------------- */
/*  Layout                                      */
/* -------------------------------------------- */

/**
 * Lay the classes of one people out as a tree.
 *
 * Lines stand side by side, each as wide as its widest tier. A class that stands alone and promotes into other
 * lines is put beside the first line it promotes into. A class of a tier below every line, as a Trainee is,
 * stands under the classes it promotes into, and the lines it leads to are brought together above it.
 *
 * Classes of one line share a trunk into their promotions. Any other road runs on a lane of its own, so that
 * two of them never lie on top of each other, and arrives beside the trunk's arrow.
 * @param {TreeClass[]} classes
 * @param {object} [options]
 * @param {number} [options.floor]            The lowest tier order whose classes make lines
 * @param {typeof TREE} [options.metrics]
 * @returns {ClassTree}
 */
export function layoutClassTree(classes, { floor = 0, metrics = TREE } = {}) {
  const M = metrics;
  const byId = new Map(classes.map((cls) => [cls.id, cls]));
  const orders = [...new Set(classes.map((cls) => cls.order))].sort((a, b) => a - b);
  const rowOf = (cls) => orders.indexOf(cls.order);
  const targets = (cls) => cls.targets.map((id) => byId.get(id)).filter(Boolean);
  const rows = orders.length;

  // The lines, each with its classes tier by tier
  const lines = gatherLines(classes, byId, floor).map((line) => {
    const tiers = new Map();
    for ( const cls of line.classes ) {
      const row = rowOf(cls);
      if ( !tiers.has(row) ) tiers.set(row, []);
      tiers.get(row).push(cls);
    }
    for ( const tier of tiers.values() ) tier.sort((a, b) => a.sort - b.sort);
    const lowest = Math.min(...tiers.keys());
    return {
      classes: line.classes,
      tiers,
      lowest,
      highest: Math.max(...tiers.keys()),
      lead: tiers.get(lowest)[0],
      columns: Math.max(...[...tiers.values()].map((tier) => tier.length)),
      sort: Math.min(...line.classes.map((cls) => cls.sort))
    };
  });
  const lineOf = new Map();
  for ( const line of lines ) for ( const cls of line.classes ) lineOf.set(cls.id, line);

  // A class by itself is under the lines when its tier is below them, and beside one when it promotes into
  // lines that are not its own
  const alone = (line) => line.classes.length === 1;
  const leads = (line) => targets(line.lead).filter((target) => lineOf.get(target.id) !== line);
  const under = lines.filter((line) => line.lead.order < floor).sort((a, b) => a.sort - b.sort);
  const beside = lines.filter((line) => alone(line) && !under.includes(line) && leads(line).length);
  const run = lines.filter((line) => !under.includes(line) && !beside.includes(line));

  // The run of lines: those a class underneath leads to are brought together, in the order of those classes
  const family = (line) => {
    const index = under.findIndex((below) => leads(below).some((target) => lineOf.get(target.id) === line));
    return index < 0 ? under.length : index;
  };
  const families = new Map(run.map((line) => [line, family(line)]));
  run.sort((a, b) => (families.get(a) - families.get(b)) || (a.sort - b.sort));
  for ( const line of [...beside].sort((a, b) => a.sort - b.sort) ) {
    const home = lineOf.get(leads(line)[0].id);
    let at = run.indexOf(home);
    if ( at < 0 ) at = run.length - 1;
    while ( beside.includes(run[at + 1]) ) at++;
    run.splice(at + 1, 0, line);
  }

  // Across: each line as wide as its widest tier, each tier centred in it
  const x = new Map();
  let cursor = M.left;
  for ( const line of run ) {
    line.x = cursor;
    line.width = line.columns * M.column;
    for ( const tier of line.tiers.values() ) {
      const offset = (line.columns - tier.length) / 2;
      tier.forEach((cls, index) => x.set(cls.id, cursor + ((offset + index + .5) * M.column)));
    }
    cursor += line.width + M.gap;
  }
  let width = (run.length ? cursor - M.gap : M.left) + M.right;

  // A class underneath stands under the middle of what it leads to; one that leads nowhere takes the first
  // free place of its tier
  const taken = new Map();
  const free = (row, at) => !(taken.get(row) ?? []).some((other) => Math.abs(other - at) < M.column);
  const stand = (line, at) => {
    const row = line.lowest;
    while ( !free(row, at) ) at += M.column / 2;
    if ( !taken.has(row) ) taken.set(row, []);
    taken.get(row).push(at);
    line.x = at - (M.column / 2);
    line.width = M.column;
    x.set(line.lead.id, at);
    width = Math.max(width, at + (M.column / 2) + M.right);
  };
  const middle = (line) => {
    const spots = leads(line).map((target) => x.get(target.id)).filter((spot) => spot !== undefined);
    return spots.length ? (Math.min(...spots) + Math.max(...spots)) / 2 : null;
  };
  const placed = under.map((line) => ({ line, at: middle(line) }));
  for ( const { line, at } of placed.filter((entry) => entry.at !== null).sort((a, b) => a.at - b.at) ) {
    stand(line, Math.max(at, M.left + (M.column / 2)));
  }
  for ( const { line } of placed.filter((entry) => entry.at === null) ) stand(line, M.left + (M.column / 2));

  // The roads. Those of one class into one tier travel together: along the trunk of its line when they stay
  // within it and climb a single tier, and on a lane of their own otherwise
  const trunkInto = new Set();
  const bundles = [];
  for ( const cls of [...classes].sort((a, b) => a.sort - b.sort) ) {
    if ( !x.has(cls.id) ) continue;
    const line = lineOf.get(cls.id);
    const groups = new Map();
    for ( const target of targets(cls) ) {
      if ( !x.has(target.id) || (rowOf(target) <= rowOf(cls)) ) continue;
      const trunk = (lineOf.get(target.id) === line) && (rowOf(target) === rowOf(cls) + 1);
      const key = `${rowOf(target)}:${trunk}`;
      if ( !groups.has(key) ) groups.set(key, { from: cls, row: rowOf(target), trunk, to: [] });
      groups.get(key).to.push(target);
      if ( trunk ) trunkInto.add(target.id);
    }
    bundles.push(...groups.values());
  }

  // Where each road arrives: the trunk at the middle of the class, the others beside it on the side they
  // come from
  const arrivals = new Map();
  for ( const bundle of bundles ) {
    const from = x.get(bundle.from.id);
    bundle.outside = !bundle.trunk && !under.includes(lineOf.get(bundle.from.id));
    bundle.ports = bundle.to.map((target) => {
      const at = x.get(target.id);
      if ( bundle.trunk ) return at;
      const slot = (arrivals.get(target.id) ?? 0) + (trunkInto.has(target.id) ? 1 : 0);
      arrivals.set(target.id, (arrivals.get(target.id) ?? 0) + 1);
      return at + ((from > at ? 1 : -1) * M.port * slot);
    });
    bundle.span = [Math.min(from, ...bundle.ports), Math.max(from, ...bundle.ports)];
  }

  // Lanes: in the space under each tier, roads whose runs overlap are given lanes of their own
  const lanes = Array.from({ length: rows }, () => []);
  for ( const bundle of bundles.filter((entry) => !entry.trunk).sort((a, b) => a.span[0] - b.span[0]) ) {
    const ends = lanes[bundle.row];
    let lane = ends.findIndex((end) => end + (M.lane * 1.5) < bundle.span[0]);
    if ( lane < 0 ) lane = ends.length;
    ends[lane] = bundle.span[1];
    bundle.lane = lane + 1;
  }
  const laneCount = (row) => Math.max(1, lanes[row].length);

  // Down: the highest tier first. Under each tier there is room for its arrows, a rule, the lanes of the roads
  // that arrive from elsewhere, the trunks, and the level at which the class below promotes
  const top = new Array(rows);
  let y = M.top;
  for ( let row = rows - 1; row >= 0; row-- ) {
    top[row] = y;
    y += M.node + (row > 0 ? 64 + (M.lane * laneCount(row)) : M.foot);
  }
  const height = rows ? y : M.top + M.foot;
  const foot = (row) => top[row] + M.node;
  const level = (bundle) => {
    const first = foot(bundle.row) + 30;
    return bundle.trunk ? first + (M.lane * laneCount(bundle.row)) + 4 : first + (M.lane * (bundle.lane - 1));
  };

  const roads = [];
  for ( const bundle of bundles ) {
    const x1 = x.get(bundle.from.id);
    const y1 = top[rowOf(bundle.from)] + M.stem;
    const arrive = foot(bundle.row);
    const turn = level(bundle);
    bundle.to.forEach((target, index) => {
      const x2 = bundle.ports[index];
      let d;
      if ( x1 === x2 ) d = `M${x1} ${y1}V${arrive + 9}`;
      else {
        const way = x2 > x1 ? 1 : -1;
        const r = Math.min(8, Math.abs(x2 - x1) / 2);
        d = `M${x1} ${y1}V${turn + r}Q${x1} ${turn} ${x1 + (way * r)} ${turn}H${x2 - (way * r)}`
          + `Q${x2} ${turn} ${x2} ${turn - r}V${arrive + 9}`;
      }
      roads.push({
        from: bundle.from.id,
        to: target.id,
        outside: bundle.outside,
        d,
        head: `M${x2} ${arrive + 2}l-5 8.5h10z`
      });
    });
  }

  const order = [...run, ...under];
  return {
    width,
    height,
    nodes: classes.filter((cls) => x.has(cls.id)).map((cls) => ({
      id: cls.id,
      x: x.get(cls.id),
      y: top[rowOf(cls)],
      row: rowOf(cls),
      line: order.indexOf(lineOf.get(cls.id))
    })),
    roads,
    lines: order.map((line) => ({
      lead: line.lead.id,
      size: line.classes.length,
      tiers: line.tiers.size,
      x: line.x,
      width: line.width,
      top: top[line.highest],
      bottom: foot(line.lowest),
      loose: under.includes(line) || beside.includes(line)
    })),
    tiers: orders.map((tier, row) => ({
      order: tier,
      row,
      y: top[row],
      divider: row < rows - 1 ? foot(row + 1) + 18 : null
    })).reverse()
  };
}

/* -------------------------------------------- */
/*  Lighting                                    */
/* -------------------------------------------- */

/**
 * Light the roads of a class. The classes it promotes into are "to" and those beyond them "to2"; the classes
 * that promote into it are "from" and those before them "from2". A road takes the light of what it leads to
 * or from, and every class a lit road leaves is given a tag for the level at which that promotion is taken.
 * @param {ClassTree} tree
 * @param {string} id       The chosen class
 * @returns {{nodes: Map<string, string>, roads: string[], tags: Map<string, string>}}
 */
export function lightClassTree(tree, id) {
  const leaving = new Map();
  const reaching = new Map();
  const add = (map, key, value) => {
    if ( !map.has(key) ) map.set(key, []);
    map.get(key).push(value);
  };
  for ( const road of tree.roads ) {
    add(leaving, road.from, road.to);
    add(reaching, road.to, road.from);
  }
  const to = new Set(leaving.get(id) ?? []);
  const from = new Set(reaching.get(id) ?? []);
  const to2 = new Set([...to].flatMap((cls) => leaving.get(cls) ?? []));
  const from2 = new Set([...from].flatMap((cls) => reaching.get(cls) ?? []));

  const nodes = new Map();
  for ( const cls of from2 ) nodes.set(cls, "from2");
  for ( const cls of to2 ) nodes.set(cls, "to2");
  for ( const cls of from ) nodes.set(cls, "from");
  for ( const cls of to ) nodes.set(cls, "to");
  nodes.set(id, "sel");

  const light = (road) => {
    if ( road.from === id ) return "to";
    if ( road.to === id ) return "from";
    if ( to.has(road.from) ) return "to2";
    if ( from.has(road.to) ) return "from2";
    return "";
  };
  const roads = tree.roads.map(light);
  const strength = ["", "from2", "to2", "from", "to"];
  const tags = new Map();
  tree.roads.forEach((road, index) => {
    const mode = roads[index];
    if ( mode && (strength.indexOf(mode) > strength.indexOf(tags.get(road.from) ?? "")) ) tags.set(road.from, mode);
  });
  return { nodes, roads, tags };
}
