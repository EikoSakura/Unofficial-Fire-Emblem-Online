/**
 * Rules pages as Discord messages.
 *
 * Discord shows no HTML, so a page of the rules journal is rewritten in the Markdown that Discord does show and
 * set on embeds, the cards a webhook can post: one card for the page's title and opening, one for each section,
 * and as many messages as the cards need. A card can also show one picture under its text. Tables of figures
 * and diagrams are marked here as worth a picture; whoever can draw them says which were drawn, and the rest
 * are written out.
 *
 * Nothing here knows Foundry or the browser. A page comes in as a tree of plain nodes, which is what makes this
 * something that can be run and checked on its own.
 */

/**
 * @typedef RulesNode
 * @property {string} tag                       The element's tag, in lower case
 * @property {string[]} classes
 * @property {Record<string, string>} attrs
 * @property {(RulesNode|string)[]} children    Elements, and text as strings
 */

/**
 * One block of Markdown, line by line: a paragraph, a list, a table, a callout. Blocks are set apart by an empty
 * line and are kept whole where a card ends. A block marked as a heading is kept with what follows it, with no
 * empty line between; blocks that share a "joins" mark and follow one another are read as one; blocks that share
 * a "quote" mark are pieces of one quote. A block with a picture can be shown as an image instead of its lines.
 * @typedef {string[] & {heading?: boolean, joins?: string, quote?: number, picture?: BlockPicture}} Block
 */

/**
 * What a block may be drawn as instead of being written out.
 * @typedef BlockPicture
 * @property {RulesNode} node       What would be drawn: a table, or a group of diagrams
 * @property {string} kind          "table" or "cycles"
 * @property {string[]} caption     The lines that stay as text above the picture
 */

/**
 * @typedef RulesSection
 * @property {string} title     The heading it stands under; the page's own title for the first
 * @property {Block[]} blocks
 */

/**
 * @typedef RulesPageContent
 * @property {string} title
 * @property {string} chapter         The chapter line, such as "IV · Making a Character"
 * @property {string} source          Where the text comes from
 * @property {RulesSection[]} sections
 */

/** What Discord allows of one message and of the cards on it. */
export const LIMITS = {
  title: 256, author: 256, description: 4096, footer: 2048, embeds: 10, message: 6000, alt: 1024
};

/** What is asked of them here, which leaves room to spare. */
const DESCRIPTION = 4000;
const MESSAGE = 5900;

/** The brass of the journal, down the side of every card. */
export const COLOR = 0xd9b662;

/** The widest a table may be, in characters, to be set as a grid: what a phone shows on one line. */
const GRID_WIDTH = 36;
const GRID_GAP = 2;

/** The longest a table's values may be to be listed on the line of their row. */
const SHORT_CELL = 30;
const SHORT_ROW = 170;

/** The longest a row's name may be to be set in bold. */
const LABEL = 36;

/** The marks of the journal, as near as Discord has them. */
const CALLOUT_MARKS = { rule: "⭐", gm: "🚩", optional: "🧩", tip: "💡", source: "ℹ️", ruling: "📖", foundry: "🖥️" };
const CHAPTER_MARKS = {
  star: "⭐", shield: "🛡️", sword: "⚔️", spark: "✨", up: "⬆️", peak: "⛰️", coin: "🪙", dice: "🎲", moon: "🌙",
  module: "🧩", tome: "📖"
};
const EXAMPLE_MARK = "🎲";

/** Tags that run within a line of text. */
const INLINE = new Set([
  "a", "abbr", "b", "br", "code", "del", "em", "i", "img", "kbd", "s", "small", "span", "strike", "strong", "sub",
  "sup", "u", "var"
]);

/** Furniture of a page that is not rules text, and drawings that have no words. */
const SKIP = ["feo-kicker", "feo-pager", "feo-source", "feo-hero-arms", "track"];
const SKIP_TAGS = new Set(["hr", "img", "nav", "summary", "script", "style"]);

/** A link to another document as it is written in saved text: only its label is read. */
const LINK = /@\w+\[[^\]]*\]\{([^}]*)\}/g;

/* -------------------------------------------- */
/*  Nodes                                       */
/* -------------------------------------------- */

const isElement = (node) => typeof node !== "string";
const has = (node, name) => isElement(node) && node.classes.includes(name);
const elementsOf = (node) => node.children.filter(isElement);
const isInline = (node) => !isElement(node) || INLINE.has(node.tag);
const isSkipped = (node) => isElement(node) && (SKIP_TAGS.has(node.tag) || SKIP.some((name) => has(node, name))
  || isSecret(node));

/** What a Game Master has marked as secret and not revealed stays in Foundry. */
const isSecret = (node) => has(node, "secret") && !has(node, "revealed");

/* -------------------------------------------- */
/*  Text                                        */
/* -------------------------------------------- */

/**
 * Keep the characters that Discord reads as formatting from being read as such.
 * @param {string} text
 * @returns {string}
 */
function escape(text) {
  return text.replace(/([\\*_~`|])/g, "\\$1");
}

/**
 * Keep the start of a line of text from being read as a heading, a quote or a list.
 * @param {string} line
 * @returns {string}
 */
function guard(line) {
  if ( /^\d+\. /.test(line) ) return line.replace(/^(\d+)\. /, "$1\\. ");
  return /^(#{1,3} |-# |>|[-*+] )/.test(line) ? `\\${line}` : line;
}

/**
 * Put a mark on both sides of a text, leaving the spaces around it outside.
 * @param {string} inner
 * @param {string} mark
 * @returns {string}
 */
function wrap(inner, mark) {
  const text = inner.trim();
  if ( !text ) return inner;
  return `${/^\s/.test(inner) ? " " : ""}${mark}${text}${mark}${/\s$/.test(inner) ? " " : ""}`;
}

/**
 * @typedef InlineContext
 * @property {boolean} [plain]     Leave every mark out: the text is for a grid or a code span
 * @property {boolean} [bold]      The text is already bold
 * @property {boolean} [italic]    The text is already italic
 */

/**
 * The text of a piece of a page, read as it is saved.
 * @param {string} text
 * @param {InlineContext} context
 * @returns {string}
 */
function textOf(text, context) {
  const flat = text.replace(/\s+/g, " ");
  if ( context.plain ) return flat.replace(LINK, "$1").replace(/`/g, "'");
  let out = "";
  let at = 0;
  for ( const match of flat.matchAll(LINK) ) {
    out += escape(flat.slice(at, match.index));
    out += context.italic ? escape(match[1]) : `*${escape(match[1].trim())}*`;
    at = match.index + match[0].length;
  }
  return out + escape(flat.slice(at));
}

/**
 * The text of what runs within a line, with the marks Discord reads.
 * @param {(RulesNode|string)[]} nodes
 * @param {InlineContext} [context]
 * @returns {string}
 */
function inline(nodes, context={}) {
  let out = "";
  for ( const node of nodes ) out += isElement(node) ? inlineElement(node, context) : textOf(node, context);
  return out;
}

/**
 * @param {RulesNode} node
 * @param {InlineContext} context
 * @returns {string}
 */
function inlineElement(node, context) {
  if ( node.tag === "br" ) return "\n";
  if ( isSkipped(node) || has(node, "feo-ico") ) return "";
  const inner = (extra) => inline(node.children, extra ? { ...context, ...extra } : context);
  if ( context.plain ) return isInline(node) ? inner() : ` ${inner()} `;

  const code = () => {
    const text = tidy(inline(node.children, { plain: true }));
    return text ? `\`${text}\`` : "";
  };
  const italic = () => (context.italic ? inner() : wrap(inner({ italic: true }), "*"));
  switch ( node.tag ) {
    case "strong":
    case "b":
      return context.bold ? inner() : wrap(inner({ bold: true }), "**");
    case "em":
    case "i":
    case "small":
      return italic();
    case "u":
      return wrap(inner(), "__");
    case "s":
    case "del":
    case "strike":
      return wrap(inner(), "~~");
    case "var":
    case "code":
    case "kbd":
      return code();
    case "a": {
      const href = node.attrs.href ?? "";
      const label = inner().trim();
      return /^https?:\/\//.test(href) && label ? `[${label}](${href})` : inner();
    }
  }
  if ( has(node, "feo-rank") ) return code();
  if ( has(node, "feo-tag") ) {
    const text = inner({ italic: true }).trim();
    return text ? (context.italic ? ` (${text})` : ` *(${text})*`) : "";
  }
  return isInline(node) ? inner() : ` ${inner()} `;
}

/**
 * Close up the spaces of a text that was put together from pieces.
 * @param {string} text
 * @returns {string}
 */
function tidy(text) {
  return text.replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n").trim();
}

const markdownOf = (node, context) => tidy(inline(node.children, context));
const plainOf = (node) => tidy(inline(node.children, { plain: true })).replace(/\n/g, " ");

/**
 * The parts of an element that are set side by side on the page, read with a mark between them.
 * @param {RulesNode} node
 * @param {string} [between]
 * @returns {string}
 */
function strip(node, between=" · ") {
  const parts = [];
  let run = [];
  const flush = () => {
    const text = tidy(inline(run));
    if ( text ) parts.push(text);
    run = [];
  };
  for ( const child of node.children ) {
    if ( isElement(child) && !isSkipped(child) && !has(child, "feo-ico") ) {
      flush();
      const text = tidy(inlineElement(child, {}));
      if ( text ) parts.push(text);
    }
    else run.push(child);
  }
  flush();
  return parts.join(between);
}

/**
 * A caption that opens with its title in bold: the title, a dash, and what is said of it.
 * @param {RulesNode} node
 * @returns {string}
 */
function captioned(node) {
  const first = node.children.find((child) => isElement(child) || child.trim());
  if ( !isElement(first) || !["strong", "b"].includes(first.tag) ) return markdownOf(node);
  const title = tidy(inlineElement(first, {}));
  const says = tidy(inline(node.children.slice(node.children.indexOf(first) + 1)));
  return [title, says].filter(Boolean).join(" — ");
}

/* -------------------------------------------- */
/*  Blocks                                      */
/* -------------------------------------------- */

/**
 * A paragraph of text.
 * @param {string} text
 * @returns {Block[]}
 */
function paragraph(text) {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean).map(guard);
  return lines.length ? [lines] : [];
}

/**
 * A note in small print.
 * @param {string} text
 * @returns {Block[]}
 */
function note(text) {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  return lines.length ? [lines.map((line) => `-# ${line}`)] : [];
}

/**
 * Blocks set one under another with no empty line between them.
 * @param {Block[]} blocks
 * @returns {Block[]}
 */
function tight(blocks) {
  const lines = blocks.flat();
  return lines.length ? [lines] : [];
}

/**
 * Blocks set as one quote, which Discord draws with a bar down its side.
 * @param {string} head     The line the quote opens with
 * @param {Block[]} body
 * @returns {Block[]}
 */
function quote(head, body) {
  const token = ++quotes;
  const mark = (line) => (line ? `> ${line}` : "> ");
  const blocks = [];
  let lines = head ? [head] : [];
  const flush = () => {
    if ( !lines.length ) return;
    const block = lines.map(mark);
    block.quote = token;
    blocks.push(block);
    lines = [];
  };
  body.forEach((block, index) => {
    // What may be drawn as a picture stays a block of its own, so that the quote can part around the picture
    if ( block.picture ) {
      flush();
      const drawn = block.map(mark);
      drawn.quote = token;
      drawn.picture = { ...block.picture, caption: block.picture.caption.map(mark) };
      blocks.push(drawn);
      return;
    }
    if ( lines.length && (index > 0) && !body[index - 1].heading ) lines.push("");
    lines.push(...block);
  });
  flush();
  return blocks;
}

/** How many quotes have been read, which gives each one a mark of its own. */
let quotes = 0;

/**
 * Read what an element holds as blocks: its elements each in their own way, and the text between them as
 * paragraphs.
 * @param {(RulesNode|string)[]} nodes
 * @returns {Block[]}
 */
function blocksOf(nodes) {
  const blocks = [];
  let run = [];
  const flush = () => {
    blocks.push(...paragraph(tidy(inline(run))));
    run = [];
  };
  for ( const node of nodes ) {
    if ( isSkipped(node) ) continue;
    if ( isInline(node) ) run.push(node);
    else {
      flush();
      blocks.push(...blockOf(node));
    }
  }
  flush();

  // Pieces of one list that were read one by one
  const joined = [];
  for ( const block of blocks ) {
    const before = joined.at(-1);
    if ( block.joins && (before?.joins === block.joins) ) before.push(...block);
    else joined.push(block);
  }
  return joined;
}

/**
 * Read one element as blocks.
 * @param {RulesNode} node
 * @returns {Block[]}
 */
function blockOf(node) {
  // The components of the rules journal
  if ( has(node, "feo-callout") ) return callout(node);
  if ( has(node, "feo-example") ) return example(node);
  if ( has(node, "feo-steps") ) return steps(node);
  if ( has(node, "feo-conds") ) return tight(elementsOf(node).flatMap(blockOf));
  if ( has(node, "feo-cond") ) return condition(node);
  if ( has(node, "feo-formulas") ) return tight(elementsOf(node).flatMap(blockOf));
  if ( has(node, "feo-formula") ) return formula(node);
  if ( has(node, "feo-calc") ) return calculation(node);
  if ( has(node, "feo-glance") || has(node, "feo-path") ) return points(node);
  if ( has(node, "feo-hero") ) return hero(node);
  if ( has(node, "feo-statline") || has(node, "feo-example-head") ) return paragraph(strip(node));
  if ( has(node, "feo-meter") ) return meter(node);
  if ( has(node, "feo-cycles") ) return cycles(node, elementsOf(node).filter((child) => has(child, "feo-cycle")));
  if ( has(node, "feo-cycle") ) return cycles(node, [node]);
  if ( has(node, "feo-cycle-ring") ) return ring(node);
  if ( has(node, "feo-key") ) return note(strip(node));
  if ( ["feo-table-note", "feo-fine", "feo-formula-note"].some((name) => has(node, name)) ) {
    return note(markdownOf(node));
  }
  if ( has(node, "feo-q") ) return lettered(node, "Q.");
  if ( has(node, "feo-a") ) return lettered(node, "A.");

  switch ( node.tag ) {
    case "p":
      return paragraph(markdownOf(node));
    case "h1":
    case "h2":
    case "h3":
      return heading(markdownOf(node, { bold: true }));
    case "h4":
    case "h5":
    case "h6":
      return minorHeading(node);
    case "figure":
      return tight(blocksOf(node.children));
    case "ul":
    case "ol":
      return list(node);
    case "dl":
      return definitions(node);
    case "table":
      return table(node);
    case "figcaption":
      return paragraph(captioned(node));
    case "blockquote":
      return quote("", blocksOf(node.children));
    case "pre":
      return fenced(inline(node.children, { plain: true }).split("\n"));
  }
  return blocksOf(node.children);
}

/**
 * A heading within a section.
 * @param {string} text
 * @returns {Block[]}
 */
function heading(text) {
  const line = text.replace(/\n/g, " ").trim();
  if ( !line ) return [];
  const block = [`### ${line}`];
  block.heading = true;
  return [block];
}

/**
 * A smaller heading: its words in bold, and anything in small print beside them in italics.
 * @param {RulesNode} node
 * @returns {Block[]}
 */
function minorHeading(node) {
  const parts = [];
  let run = [];
  const flush = () => {
    const text = tidy(inline(run, { bold: true }));
    if ( text ) parts.push(`**${text}**`);
    run = [];
  };
  for ( const child of node.children ) {
    if ( isElement(child) && (child.tag === "small") ) {
      flush();
      const text = tidy(inline(child.children, { italic: true }));
      if ( text ) parts.push(`*${text}*`);
    }
    else run.push(child);
  }
  flush();
  const line = parts.join(" ").replace(/\n/g, " ");
  if ( !line ) return [];
  const block = [line];
  block.heading = true;
  return [block];
}

/**
 * A measure with its figure, as a line of a list.
 * @param {RulesNode} node
 * @returns {Block[]}
 */
function meter(node) {
  const line = strip(node, ": ").replace(/\n/g, " ");
  if ( !line ) return [];
  const block = [`- ${line}`];
  block.joins = "meter";
  return [block];
}

/**
 * A ring of things that each beat the next, drawn on the page with arrows: the same in a line, and under it
 * whatever stands in the middle with those it beats.
 * @param {RulesNode} node
 * @returns {Block[]}
 */
function ring(node) {
  const parts = elementsOf(node);
  const names = parts.filter((part) => has(part, "feo-node")).map(plainOf).filter(Boolean);
  if ( names.length < 2 ) return [];
  const lines = [`\`${[...names, names[0]].join(" → ")}\``];
  const hub = parts.find((part) => has(part, "feo-hub"));
  const beaten = parts.filter((part) => has(part, "feo-spoke"))
    .map((part) => names[Number(part.classes.find((name) => /^i\d+$/.test(name))?.slice(1))])
    .filter(Boolean);
  if ( hub && beaten.length ) lines.push(`\`${plainOf(hub)} → ${beaten.join(", ")}\``);
  return [lines];
}

/**
 * Diagrams that stand side by side, each a ring with a few words under it. Written out, each is its ring in a
 * line and then its words; drawn, the rings are one picture and the words stay above it.
 * @param {RulesNode} node          What holds the diagrams
 * @param {RulesNode[]} figures     The diagrams
 * @returns {Block[]}
 */
function cycles(node, figures) {
  /** @type {Block} */
  const lines = [];
  const caption = [];
  let drawable = false;
  for ( const figure of figures ) {
    const parts = elementsOf(figure);
    const circle = parts.find((part) => has(part, "feo-cycle-ring"));
    const words = parts.find((part) => part.tag === "figcaption");
    const drawn = circle ? ring(circle).flat() : [];
    const said = words ? paragraph(captioned(words)).flat() : [];
    if ( !drawn.length && !said.length ) continue;
    drawable ||= drawn.length > 0;
    if ( lines.length ) lines.push("");
    lines.push(...drawn, ...said);
    if ( said.length ) {
      if ( caption.length ) caption.push("");
      caption.push(...said);
    }
  }
  if ( !lines.length ) return [];
  if ( drawable ) lines.picture = { node, kind: "cycles", caption };
  return [lines];
}

/**
 * Lines set in a fixed-width face.
 * @param {string[]} lines
 * @returns {Block[]}
 */
function fenced(lines) {
  const kept = lines.map((line) => line.replace(/\s+$/, ""));
  while ( kept.length && !kept[0] ) kept.shift();
  while ( kept.length && !kept.at(-1) ) kept.pop();
  return kept.length ? [["```", ...kept, "```"]] : [];
}

/**
 * A callout: its mark and label, then what it says, as a quote.
 * @param {RulesNode} node
 * @returns {Block[]}
 */
function callout(node) {
  const label = elementsOf(node).find((child) => has(child, "feo-callout-label"));
  const kind = Object.keys(CALLOUT_MARKS).find((name) => has(node, name));
  const name = label ? plainOf(label) : "";
  const head = [kind ? CALLOUT_MARKS[kind] : "", name ? `**${escape(name)}**` : ""].filter(Boolean).join(" ");
  return quote(head, blocksOf(node.children.filter((child) => child !== label)));
}

/**
 * A worked example: what it is an example of, then its working, as a quote.
 * @param {RulesNode} node
 * @returns {Block[]}
 */
function example(node) {
  const top = elementsOf(node).find((child) => has(child, "feo-example-head"));
  const head = top ? `${EXAMPLE_MARK} ${strip(top)}` : "";
  const body = node.children.filter((child) => child !== top);
  return quote(head, blocksOf(body));
}

/**
 * Numbered steps, each a title with what to do under it.
 * @param {RulesNode} node
 * @returns {Block[]}
 */
function steps(node) {
  const blocks = [];
  let number = Number(node.attrs.start) || 1;
  for ( const item of elementsOf(node) ) {
    const title = elementsOf(item).find((child) => has(child, "feo-step-title"));
    const body = blocksOf(item.children.filter((child) => child !== title));
    if ( title ) {
      const tags = elementsOf(title).filter((child) => has(child, "feo-tag"));
      const name = tidy(inline(title.children.filter((child) => !tags.includes(child)), { bold: true }));
      const extra = tags.map((tag) => ` · *${plainOf(tag)}*`).join("");
      const head = `**${number}. ${name}**${extra}`;
      const first = body.length && !body[0].picture ? body.shift() : [];
      blocks.push([head, ...first], ...body);
    }
    else if ( body.length && !body[0].picture ) {
      const [first, ...rest] = body;
      blocks.push([`**${number}.** ${first[0]}`, ...first.slice(1)], ...rest);
    }
    else if ( body.length ) blocks.push([`**${number}.**`], ...body);
    number++;
  }
  return blocks;
}

/**
 * A condition: its name, how long it lasts and what it does, on one line of a list.
 * @param {RulesNode} node
 * @returns {Block[]}
 */
function condition(node) {
  const top = elementsOf(node).find((child) => has(child, "feo-cond-head"));
  const name = top ? elementsOf(top).find((child) => has(child, "feo-cond-name")) : null;
  const lasts = top ? elementsOf(top).find((child) => has(child, "feo-dur")) : null;
  const parts = [];
  for ( const child of node.children ) {
    if ( (child === top) || isSkipped(child) ) continue;
    const text = isElement(child) ? markdownOf(child) : tidy(textOf(child, {}));
    if ( !text ) continue;
    parts.push(has(child, "feo-fine") ? wrap(markdownOf(child, { italic: true }), "*") : text);
  }
  const title = name ? `**${escape(plainOf(name))}**` : (top ? strip(top) : "");
  const time = lasts ? ` (${escape(plainOf(lasts))})` : "";
  const says = parts.join(" ").replace(/\n/g, " ");
  if ( !title ) return paragraph(says);
  return [[`- ${title}${time}${says ? `: ${says}` : ""}`]];
}

/**
 * A formula: its name and what it works out to, with any note under it.
 * @param {RulesNode} node
 * @returns {Block[]}
 */
function formula(node) {
  const lines = [];
  let name = "";
  const rest = [];
  for ( const child of elementsOf(node) ) {
    if ( has(child, "feo-formula-name") ) name = plainOf(child);
    else if ( has(child, "feo-formula-expr") ) {
      const expression = plainOf(child);
      lines.push(`${name ? `**${escape(name)}** = ` : ""}\`${expression}\``);
      name = "";
    }
    else rest.push(...blockOf(child).flat());
  }
  if ( name ) lines.push(`**${escape(name)}**`);
  return tight([lines, rest]);
}

/**
 * Sums worked through: what is worked out, the working, and the answer.
 * @param {RulesNode} node
 * @returns {Block[]}
 */
function calculation(node) {
  const lines = [];
  for ( const row of rowsOf(node) ) {
    const name = row.terms.map(plainOf).filter(Boolean).join(" ");
    const work = row.values.filter((value) => !has(value, "res")).map((value) => markdownOf(value)).filter(Boolean);
    const answer = row.values.filter((value) => has(value, "res")).map(plainOf).filter(Boolean);
    const sum = [work.join(" "), answer.length ? `**${escape(answer.join(" "))}**` : ""].filter(Boolean).join(" → ");
    const line = [name ? escape(name) : "", sum.replace(/\n/g, " ")].filter(Boolean).join(": ");
    if ( line ) lines.push(`- ${line}`);
  }
  return lines.length ? [lines] : [];
}

/**
 * The rows of a list of terms: each a wrapper around its terms and what they mean, or the terms and meanings
 * one after another.
 * @param {RulesNode} node
 * @returns {{terms: RulesNode[], values: RulesNode[]}[]}
 */
function rowsOf(node) {
  const rows = [];
  let row = null;
  for ( const child of elementsOf(node) ) {
    if ( child.tag === "dt" ) {
      if ( !row || row.values.length ) rows.push(row = { terms: [], values: [] });
      row.terms.push(child);
    }
    else if ( child.tag === "dd" ) {
      if ( !row ) rows.push(row = { terms: [], values: [] });
      row.values.push(child);
    }
    else {
      const inner = elementsOf(child);
      rows.push({
        terms: inner.filter((part) => part.tag === "dt"),
        values: inner.filter((part) => part.tag !== "dt")
      });
      row = null;
    }
  }
  return rows;
}

/**
 * Terms and what they mean, as a list.
 * @param {RulesNode} node
 * @returns {Block[]}
 */
function definitions(node) {
  const lines = [];
  for ( const row of rowsOf(node) ) {
    const name = row.terms.map(plainOf).filter(Boolean).join(", ");
    const means = row.values.map((value) => markdownOf(value)).filter(Boolean).join(" ").replace(/\n/g, " ");
    if ( name && means ) lines.push(`- **${escape(name)}** — ${means}`);
    else if ( name || means ) lines.push(`- ${name ? `**${escape(name)}**` : means}`);
  }
  return lines.length ? [lines] : [];
}

/**
 * A row of short points, each a figure or a name with a line about it.
 * @param {RulesNode} node
 * @returns {Block[]}
 */
function points(node) {
  const between = has(node, "feo-path") ? " — " : " ";
  const lines = elementsOf(node).map((child) => strip(child, between).replace(/\n/g, " ")).filter(Boolean);
  if ( has(node, "feo-path") ) return lines.length ? [lines.map((line, index) => `${index + 1}. ${line}`)] : [];
  return lines.length ? [lines.map((line) => `- ${line}`)] : [];
}

/**
 * The title piece of the first page.
 * @param {RulesNode} node
 * @returns {Block[]}
 */
function hero(node) {
  const lines = [];
  for ( const child of elementsOf(node) ) {
    if ( isSkipped(child) ) continue;
    const text = markdownOf(child, { bold: true }).replace(/\n/g, " ");
    if ( !text ) continue;
    lines.push(has(child, "feo-hero-title") ? `## ${text}` : `-# ${text}`);
  }
  return lines.length ? [lines] : [];
}

/**
 * A question or its answer, set off by a letter.
 * @param {RulesNode} node
 * @param {string} letter
 * @returns {Block[]}
 */
function lettered(node, letter) {
  const blocks = blocksOf(node.children);
  if ( !blocks.length ) return [];
  if ( blocks[0].picture ) return [[`**${letter}**`], ...blocks];
  const [first, ...rest] = blocks;
  return [[`**${letter}** ${first[0]}`, ...first.slice(1)], ...rest];
}

/**
 * A list, with the lists inside its items set in under them.
 * @param {RulesNode} node
 * @returns {Block[]}
 */
function list(node) {
  const lines = [];
  const ordered = node.tag === "ol";
  let number = Number(node.attrs.start) || 1;
  for ( const item of elementsOf(node) ) {
    const inner = blocksOf(item.children).flat();
    if ( !inner.length ) continue;
    const mark = ordered ? `${number++}. ` : "- ";
    const first = inner[0].replace(/^\\(?=[-*+#>] |-# )/, "").replace(/^(\d+)\\\. /, "$1. ");
    lines.push(`${mark}${first}`, ...inner.slice(1).map((line) => `${" ".repeat(mark.length)}${line}`));
  }
  return lines.length ? [lines] : [];
}

/* -------------------------------------------- */
/*  Tables                                      */
/* -------------------------------------------- */

/**
 * @typedef TableCell
 * @property {string} plain       Its text with no marks
 * @property {string} markdown    Its text with the marks Discord reads
 * @property {number} span        How many columns it runs across
 * @property {boolean} number     Whether it is set to the right as a figure
 */

/**
 * A table. Discord has none, so a table narrow enough to stay on one line is set as a grid in a fixed-width
 * face, and a wider one is listed row by row, each value under the name of its column.
 * @param {RulesNode} node
 * @returns {Block[]}
 */
function table(node) {
  const head = [];
  const body = [];
  let caption = "";
  for ( const child of elementsOf(node) ) {
    if ( child.tag === "caption" ) caption = markdownOf(child, { bold: true }).replace(/\n/g, " ");
    else if ( child.tag === "thead" ) head.push(...elementsOf(child).filter((row) => row.tag === "tr"));
    else if ( child.tag === "tr" ) body.push(child);
    else body.push(...elementsOf(child).filter((row) => row.tag === "tr"));
  }
  const cellsOf = (row) => elementsOf(row).filter((cell) => ["td", "th"].includes(cell.tag)).map((cell) => ({
    plain: plainOf(cell),
    markdown: markdownOf(cell).replace(/\n/g, " "),
    span: Math.max(1, Number(cell.attrs.colspan) || 1),
    number: has(cell, "num")
  }));
  if ( !head.length && (body.length > 1) && elementsOf(body[0]).every((cell) => cell.tag === "th") ) {
    head.push(body.shift());
  }

  /** @type {TableCell[]} */
  const headers = [];
  for ( const cell of (head.length ? cellsOf(head.at(-1)) : []) ) {
    headers.push(cell);
    for ( let extra = 1; extra < cell.span; extra++ ) headers.push({ ...cell, plain: "", markdown: "" });
  }
  const rows = body.map(cellsOf).filter((row) => row.some((cell) => cell.plain));
  const columns = Math.max(headers.length, ...rows.map((row) => row.reduce((total, cell) => total + cell.span, 0)));
  const title = caption ? [`**${caption}**`] : [];
  if ( !rows.length || !columns ) return title.length ? [title] : [];

  /** @type {Block} */
  const block = [...title, ...(gridOf(headers, rows, columns) ?? recordsOf(headers, rows, columns))];

  // A table of several columns of short values is worth drawing. One of sentences reads better written out
  const brief = rows.every((row) => row.slice(1).every((cell) => cell.plain.length <= SHORT_CELL));
  if ( (columns >= 3) && (rows.length >= 2) && brief ) block.picture = { node, kind: "table", caption: title };
  return [block];
}

/**
 * A table as a grid of aligned columns, or nothing when it is too wide for one.
 * @param {TableCell[]} headers
 * @param {TableCell[][]} rows
 * @param {number} columns
 * @returns {Block|null}
 */
function gridOf(headers, rows, columns) {
  if ( columns < 2 ) return null;
  const widths = Array(columns).fill(0);
  const figures = Array(columns).fill(true);
  headers.forEach((cell, index) => widths[index] = cell.plain.length);
  for ( const row of rows ) {
    let at = 0;
    for ( const cell of row ) {
      if ( cell.span === 1 ) {
        widths[at] = Math.max(widths[at], cell.plain.length);
        if ( cell.plain && !cell.number && !/^[+\-−±×]?[\d.,/]+%?$/.test(cell.plain) ) figures[at] = false;
      }
      at += cell.span;
    }
  }

  // A cell that runs across columns is given the room it needs by the last of them
  for ( const row of rows ) {
    let at = 0;
    for ( const cell of row ) {
      if ( cell.span > 1 ) {
        const last = Math.min(columns, at + cell.span) - 1;
        const room = widths.slice(at, last + 1).reduce((total, width) => total + width, 0) + (GRID_GAP * (last - at));
        if ( cell.plain.length > room ) widths[last] += cell.plain.length - room;
      }
      at += cell.span;
    }
  }
  const width = widths.reduce((total, size) => total + size, 0) + (GRID_GAP * (columns - 1));
  if ( width > GRID_WIDTH ) return null;

  const gap = " ".repeat(GRID_GAP);
  const set = (cells) => {
    const parts = [];
    let at = 0;
    for ( const cell of cells ) {
      const last = Math.min(columns, at + cell.span) - 1;
      const room = widths.slice(at, last + 1).reduce((total, size) => total + size, 0) + (GRID_GAP * (last - at));
      const right = (cell.span === 1) && figures[at] && (at > 0);
      parts.push(right ? cell.plain.padStart(room) : cell.plain.padEnd(room));
      at += cell.span;
    }
    return parts.join(gap).replace(/\s+$/, "");
  };
  const lines = [];
  if ( headers.some((cell) => cell.plain) ) {
    lines.push(set(headers.map((cell) => ({ ...cell, span: 1 }))), widths.map((size) => "─".repeat(size)).join(gap));
  }
  for ( const row of rows ) lines.push(set(row));
  return ["```", ...lines, "```"];
}

/**
 * A table as a list of its rows. The first cell of a row names it; the others follow under the names of their
 * columns, on the same line when they are short and on lines of their own when they are not.
 * @param {TableCell[]} headers
 * @param {TableCell[][]} rows
 * @param {number} columns
 * @returns {Block}
 */
function recordsOf(headers, rows, columns) {
  const bold = rows.every((row) => (row[0]?.plain.length ?? 0) <= LABEL);
  const named = (cell) => {
    if ( !cell?.plain ) return "";
    return bold ? `**${escape(cell.plain)}**` : cell.markdown;
  };
  if ( columns === 1 ) return rows.map((row) => `- ${row[0].markdown}`);

  // Two columns: a name and what goes with it
  const lines = [];
  if ( columns === 2 ) {
    const titles = headers.map((cell) => cell.markdown).filter(Boolean);
    if ( titles.length ) lines.push(`-# ${titles.join(" · ")}`);
    for ( const row of rows ) {
      const [first, second] = row;
      const parts = [named(first), second?.markdown].filter(Boolean);
      lines.push(`- ${parts.join(" — ")}`);
    }
    return lines;
  }

  // More: each value with the name of its column
  const valuesOf = (row) => {
    const values = [];
    let at = row[0]?.span ?? 1;
    for ( const cell of row.slice(1) ) {
      const title = cell.span === 1 ? (headers[at]?.markdown ?? "") : "";
      if ( cell.plain ) values.push({ title, cell });
      at += cell.span;
    }
    return values;
  };
  const short = rows.every((row) => {
    const values = valuesOf(row);
    const length = values.reduce((total, { title, cell }) => total + title.length + cell.plain.length + 5, 0);
    return values.every(({ cell }) => cell.plain.length <= SHORT_CELL) && (length + (row[0]?.plain.length ?? 0) <= SHORT_ROW);
  });

  // Values are set apart by a dot, unless the table uses a dot of its own to mean something
  const between = rows.some((row) => row.some((cell) => cell.plain === "·")) ? ", " : " · ";
  for ( const row of rows ) {
    const name = named(row[0]);
    const values = valuesOf(row);
    if ( short ) {
      const said = values.map(({ title, cell }) => (title ? `${title}: ${cell.markdown}` : cell.markdown)).join(between);
      lines.push(`- ${[name, said].filter(Boolean).join(" — ")}`);
      continue;
    }
    if ( name ) lines.push(`- ${name}`);
    const indent = name ? "  " : "";
    for ( const { title, cell } of values ) {
      lines.push(`${indent}- ${title ? `*${title.replace(/\*/g, "")}:* ` : ""}${cell.markdown}`);
    }
  }
  return lines;
}

/* -------------------------------------------- */
/*  Pages                                       */
/* -------------------------------------------- */

/**
 * Find the first element with a class, however deep.
 * @param {RulesNode} node
 * @param {string} name
 * @returns {RulesNode|null}
 */
function find(node, name) {
  for ( const child of elementsOf(node) ) {
    if ( has(child, name) ) return child;
    const found = find(child, name);
    if ( found ) return found;
  }
  return null;
}

/**
 * Read a page of the rules journal.
 * @param {RulesNode} root              The page's content: its "feo-rules" wrapper, or whatever holds the text
 * @param {object} [options]
 * @param {string} [options.title]      The page's name
 * @returns {RulesPageContent}
 */
export function readPage(root, { title="" }={}) {
  // The chapter line, without the count of pages and with the mark of its pennant
  let chapter = "";
  const kicker = find(root, "feo-kicker");
  if ( kicker ) {
    const words = kicker.children.filter((child) => !has(child, "pg") && !has(child, "feo-pennant"));
    const line = tidy(inline(words, { plain: true })).replace(/[\s·]+$/, "");
    const icon = find(kicker, "feo-ico")?.classes.find((name) => name in CHAPTER_MARKS);
    chapter = [icon ? CHAPTER_MARKS[icon] : "", line].filter(Boolean).join(" ");
  }
  const sourceNode = find(root, "feo-source");
  const source = sourceNode ? plainOf(sourceNode) : "";

  // A second-level heading opens a section; what stands before the first belongs to the page's title
  /** @type {RulesSection[]} */
  const sections = [{ title, blocks: [] }];
  let run = [];
  const flush = () => {
    sections.at(-1).blocks.push(...blocksOf(run));
    run = [];
  };
  for ( const child of root.children ) {
    if ( isElement(child) && ["h1", "h2"].includes(child.tag) ) {
      flush();
      sections.push({ title: plainOf(child), blocks: [] });
    }
    else run.push(child);
  }
  flush();
  return { title, chapter, source, sections };
}

/* -------------------------------------------- */
/*  Cards and messages                          */
/* -------------------------------------------- */

/** A line that opens or closes a stretch of fixed-width text, whether or not it stands in a quote. */
const FENCE = /^((?:> )*)```/;

/**
 * Cut a text down to a length.
 * @param {string} text
 * @param {number} length
 * @returns {string}
 */
function clip(text, length) {
  return text.length > length ? `${text.slice(0, length - 1).trimEnd()}…` : text;
}

/**
 * Break a block that is too long for one card into pieces that are not, between its lines. A stretch of
 * fixed-width text that is broken is closed on one card and opened again on the next.
 * @param {Block} block
 * @param {number} length
 * @returns {Block[]}
 */
function breakBlock(block, length) {
  const lines = [];
  for ( const line of block ) {
    // A line longer than a card is broken between its words
    let rest = line;
    while ( rest.length > length - 16 ) {
      let at = rest.lastIndexOf(" ", length - 16);
      if ( at < 1 ) at = length - 16;
      lines.push(rest.slice(0, at));
      rest = rest.slice(at).trimStart();
    }
    lines.push(rest);
  }

  const pieces = [];
  let piece = [];
  let size = 0;
  let fence = null;
  for ( const line of lines ) {
    const mark = line.match(FENCE);
    const closes = !!mark && (fence !== null);
    const closing = fence === null ? 0 : fence.length + 4;
    if ( !closes && piece.length && (size + line.length + 1 + closing > length) ) {
      // A stretch that has only just been opened moves to the next piece whole
      const opened = (fence !== null) && FENCE.test(piece.at(-1));
      if ( opened ) piece.pop();
      else if ( fence !== null ) piece.push(`${fence}\`\`\``);
      if ( piece.length ) pieces.push(piece);
      piece = fence !== null ? [`${fence}\`\`\``] : [];
      size = piece.reduce((total, text) => total + text.length + 1, 0);
    }
    piece.push(line);
    size += line.length + 1;
    if ( mark ) fence = fence === null ? mark[1] : null;
  }
  if ( piece.length ) pieces.push(piece);
  return pieces;
}

/**
 * Whether a block is a heading, which is kept with what follows it.
 * @param {Block} block
 * @returns {boolean}
 */
function isHeading(block) {
  return block.heading === true;
}

/**
 * The text of blocks one after another.
 * @param {Block[]} blocks
 * @returns {string}
 */
function join(blocks) {
  return blocks.reduce((text, block, index) => {
    const before = blocks[index - 1];
    let gap = "\n\n";
    if ( index === 0 ) gap = "";
    else if ( isHeading(before) ) gap = "\n";
    else if ( before.quote && (before.quote === block.quote) ) gap = "\n> \n";
    return `${text}${gap}${block.join("\n")}`;
  }, "");
}

/**
 * Gather blocks into as few cards as will hold them. A card shows its picture under its text, so a block that
 * is drawn as a picture ends the card it is on, and what follows starts another.
 * @param {Block[]} blocks
 * @param {number} length
 * @param {Map<RulesNode, string>} [pictures]    The pictures that were drawn, each by what it shows
 * @returns {{text: string, picture: string|null}[]}
 */
function gather(blocks, length, pictures) {
  const cards = [];
  let current = [];
  let size = 0;
  const measure = (block) => block.reduce((total, line) => total + line.length + 1, 0) - 1;
  const close = (picture=null) => {
    if ( !current.length && !picture ) return;
    cards.push({ text: join(current), picture });
    current = [];
    size = 0;
  };

  // A card that is full is closed, but a heading at its foot goes on to the next with what it heads
  const turn = () => {
    const kept = isHeading(current.at(-1)) && (current.length > 1) ? current.pop() : null;
    close();
    if ( kept ) {
      current = [kept];
      size = measure(kept);
    }
  };
  const add = (block) => {
    for ( const piece of (measure(block) > length ? breakBlock(block, length) : [block]) ) {
      const lengthOf = measure(piece);
      if ( current.length && (size + 2 + lengthOf > length) ) turn();
      if ( current.length && (size + 2 + lengthOf > length) ) close();
      current.push(piece);
      size += (current.length > 1 ? 2 : 0) + lengthOf;
    }
  };

  for ( const block of blocks ) {
    const picture = block.picture ? pictures?.get(block.picture.node) : null;
    if ( !picture ) {
      add(block);
      continue;
    }
    if ( block.picture.caption.length ) {
      const caption = [...block.picture.caption];
      if ( block.quote ) caption.quote = block.quote;
      add(caption);
    }
    close(picture);
  }
  close();
  return cards;
}

/**
 * Set a page on cards: one for its title and opening, then one for each section, and more where a section is
 * too long for one or has pictures in it.
 * @param {RulesPageContent} page
 * @param {object} [options]
 * @param {Map<RulesNode, string>} [options.pictures]    The address of each picture that was drawn, by the table
 *                                                       or diagrams it shows. The rest are written out
 * @param {string} [options.banner]                      The address of a picture of the page's title, which then
 *                                                       stands in place of the title in words
 * @returns {object[]}    Discord embeds
 */
export function embedsOf(page, { pictures, banner }={}) {
  const embeds = [];
  if ( banner ) embeds.push({ color: COLOR, image: { url: banner } });
  page.sections.forEach((section, index) => {
    const cards = gather(section.blocks, DESCRIPTION, pictures);
    if ( !cards.length ) cards.push({ text: "", picture: null });
    const named = !banner || (index > 0);
    cards.forEach((card, part) => {
      const embed = { color: COLOR };
      if ( named && (index === 0) && (part === 0) && page.chapter ) {
        embed.author = { name: clip(page.chapter, LIMITS.author) };
      }
      if ( named && (part === 0) && section.title ) embed.title = clip(escape(section.title), LIMITS.title);
      if ( card.text ) embed.description = card.text;
      if ( card.picture ) embed.image = { url: card.picture };
      if ( embed.title || embed.description || embed.image ) embeds.push(embed);
    });
  });
  if ( embeds.length && page.source ) embeds.at(-1).footer = { text: clip(page.source, LIMITS.footer) };
  return embeds;
}

/**
 * What on a page may be drawn as a picture, in the order it appears, each with the words that describe it to
 * someone who cannot see the picture.
 * @param {RulesPageContent} page
 * @returns {{node: RulesNode, kind: string, alt: string}[]}
 */
export function picturesOf(page) {
  const plain = (line) => line.replace(/^(> ?)+/, "").replace(/^-# /, "").replace(/\\([\\*_~`|])|[*`]/g, "$1");
  return page.sections.flatMap((section) => section.blocks).filter((block) => block.picture).map((block) => ({
    node: block.picture.node,
    kind: block.picture.kind,
    alt: clip(block.map(plain).filter((line) => line && !/^[─ ]+$/.test(line)).join("\n"), LIMITS.alt)
  }));
}

/**
 * How much of a message's allowance a card takes up.
 * @param {object} embed
 * @returns {number}
 */
export function sizeOf(embed) {
  return (embed.title?.length ?? 0) + (embed.description?.length ?? 0) + (embed.author?.name?.length ?? 0)
    + (embed.footer?.text?.length ?? 0);
}

/**
 * Share cards out over as few messages as Discord will take them in, in order.
 * @param {object[]} embeds
 * @returns {object[][]}    The cards of each message
 */
export function messagesOf(embeds) {
  const messages = [];
  let current = [];
  let size = 0;
  for ( const embed of embeds ) {
    const length = sizeOf(embed);
    if ( current.length && ((current.length >= LIMITS.embeds) || (size + length > MESSAGE)) ) {
      messages.push(current);
      current = [];
      size = 0;
    }
    current.push(embed);
    size += length;
  }
  if ( current.length ) messages.push(current);
  return messages;
}

/**
 * A page of the rules journal as the messages that show it on Discord.
 * @param {RulesNode} root              The page's content
 * @param {object} [options]
 * @param {string} [options.title]      The page's name
 * @returns {object[][]}                The embeds of each message
 */
export function pageToMessages(root, options) {
  return messagesOf(embedsOf(readPage(root, options)));
}

/* -------------------------------------------- */
/*  Webhooks                                    */
/* -------------------------------------------- */

/**
 * @typedef DiscordWebhook
 * @property {string} id        The webhook's id
 * @property {string} url       Where its messages are posted
 * @property {string} thread    The thread or forum post it posts in, if any
 */

/**
 * Read the address of a Discord webhook. Anything that is not one is turned away, so that nothing is ever sent
 * anywhere but Discord.
 * @param {string} address
 * @returns {DiscordWebhook|null}
 */
export function parseWebhook(address) {
  const match = String(address ?? "").trim()
    .match(/^https:\/\/(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/api(?:\/v\d+)?\/webhooks\/(\d+)\/([\w-]+)\/?(?:\?(.*))?$/);
  if ( !match ) return null;
  const [, id, token, query=""] = match;
  const thread = query.split("&").map((pair) => pair.split("=")).find(([key]) => key === "thread_id")?.[1] ?? "";
  return {
    id,
    url: `https://discord.com/api/webhooks/${id}/${token}`,
    thread: /^\d+$/.test(thread) ? thread : ""
  };
}
