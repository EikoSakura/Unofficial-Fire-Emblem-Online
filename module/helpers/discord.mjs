import DiscordConfig from "../apps/discord-config.mjs";
import { FEO } from "../config.mjs";
import { embedsOf, messagesOf as shareOut, picturesOf, readPage } from "../rules/discord.mjs";
import { drawPlates, embedFont } from "./plates.mjs";
import { isRulesJournal } from "./rules-search.mjs";

/**
 * Sending pages of the rules journal to Discord.
 *
 * A Game Master finds a button at the end of the chapter line of every page of the rules journal. It posts the
 * page to the channel of the webhook set up in the system's settings, as the cards that `rules/discord.mjs`
 * makes of it. The page's title, its tables of figures and its diagrams go along as pictures drawn in the
 * journal's own style, unless the settings say to write everything out. The messages a page was posted as are
 * remembered in the same browser, so that sending the page again can change that post where it stands instead
 * of adding another.
 */

/** Discord's mark for a message that pings nobody's phone, used for every message of a page after the first. */
const SILENT = 1 << 12;

/** The answer Discord gives when a webhook that belongs to a forum is not told which post to write in. */
const NEEDS_THREAD = 220001;

/** The most times a message is tried again after Discord asks for a pause, and the longest pause, in seconds. */
const RETRIES = 3;
const LONGEST_WAIT = 15;

/**
 * How pictures are sized. Discord shows a card's picture no more than 400 pixels wide and 300 high, so a
 * picture is laid out a little wider than that and never much taller than it is wide; one that would be is
 * tried wider, and written out when that does not help. Each is drawn at twice its size, to stay sharp.
 */
const BANNER_WIDTHS = [440];
const TABLE_WIDTHS = [440, 520, 600];
const TABLE_TALLEST = 0.95;
const CYCLE_WIDTHS = [260, 440, 640, 720];
const CYCLE_TALLEST = 1;

/** The fonts the journal is set in, by the names Foundry knows them under, and the weights it uses. */
const FONTS = { Amiri: ["400", "700"], Signika: ["400", "600", "700"] };

/** A link to another document as it is written in saved text. */
const LINK = /@\w+\[[^\]]*\]\{([^}]*)\}/g;

/**
 * @typedef DiscordPost
 * @property {string} hook          The id of the webhook the page was sent with
 * @property {string} thread        The thread or forum post it was sent to, if any
 * @property {string[]} messages    The ids of its messages, in order
 * @property {number} at            When it was sent
 */

/**
 * @typedef DiscordFile
 * @property {string} name    The file's name, which the card that shows it knows it by
 * @property {Blob} blob
 * @property {string} alt     What it shows, in words
 */

/**
 * @typedef DiscordMessage
 * @property {object[]} embeds        Its cards
 * @property {DiscordFile[]} files    The pictures its cards show
 */

/* -------------------------------------------- */
/*  Reading a page                              */
/* -------------------------------------------- */

/**
 * A piece of a document as the plain tree that pages are read from. Each element of the tree remembers the
 * element it was read from, which is what is drawn when it is wanted as a picture.
 * @param {Node} node
 * @returns {import("../rules/discord.mjs").RulesNode|string|null}
 */
function treeOf(node) {
  if ( node.nodeType === Node.TEXT_NODE ) return node.data;
  if ( node.nodeType !== Node.ELEMENT_NODE ) return null;
  return {
    tag: node.tagName.toLowerCase(),
    classes: [...node.classList],
    attrs: Object.fromEntries([...node.attributes].map((attribute) => [attribute.name, attribute.value])),
    children: [...node.childNodes].map(treeOf).filter((child) => child !== null),
    element: node
  };
}

/**
 * The name a page's post is remembered under: its name in the rules journal, which a copy of the journal
 * shares, or failing that its own address.
 * @param {JournalEntryPage} page
 * @returns {string}
 */
function keyOf(page) {
  return page.getFlag(FEO.id, "key") ?? page.uuid;
}

/* -------------------------------------------- */
/*  Pictures                                    */
/* -------------------------------------------- */

/** @type {Promise<string>|null} */
let stage = null;

/**
 * The journal's styles with its fonts written into them, which is everything a picture needs to look like the
 * journal. Read once and kept.
 * @returns {Promise<string>}
 */
function stageStyles() {
  stage ??= (async () => {
    const response = await fetch(`systems/${FEO.id}/styles/journal.css`);
    if ( !response.ok ) throw new Error("The styles of the rules journal could not be read.");
    const sheet = await response.text();
    const faces = [];
    for ( const [family, weights] of Object.entries(FONTS) ) {
      for ( const font of CONFIG.fontDefinitions?.[family]?.fonts ?? [] ) {
        const weight = String(font.weight ?? "400");
        if ( !weights.includes(weight) || ((font.style ?? "normal") !== "normal") || !font.urls?.length ) continue;

        // A font that cannot be read is done without: the picture falls back on the fonts of the computer
        faces.push(embedFont(family, font.urls[0], { weight }).catch(() => ""));
      }
    }
    return `${(await Promise.all(faces)).filter(Boolean).join("\n")}\n${sheet}`;
  })();
  stage.catch(() => stage = null);
  return stage;
}

/**
 * Saved text with its links to other pages as the journal shows them.
 * @param {string} html
 * @returns {string}
 */
function linked(html) {
  return html.replace(LINK, "<a class=\"content-link\">$1</a>");
}

/**
 * What to draw for the picture of a page's title: its chapter line with the pennant, and its name.
 * @param {JournalEntryPage} page
 * @param {HTMLElement} root    The page's content
 * @returns {import("./plates.mjs").PlateRequest}
 */
function bannerRequest(page, root) {
  const kicker = root.querySelector(".feo-kicker");
  return {
    classes: kicker ? "banner" : "banner plain",
    widths: BANNER_WIDTHS,
    header: `<header class="journal-page-header"><h1>${foundry.utils.escapeHTML(page.name)}</h1></header>`,
    html: kicker ? kicker.outerHTML : ""
  };
}

/**
 * What to draw for a table or a group of diagrams, or nothing where it is not one the journal's styles dress.
 * @param {{node: object, kind: string}} picture
 * @returns {import("./plates.mjs").PlateRequest|null}
 */
function plateRequest({ node, kind }) {
  const element = node.element;
  if ( !element ) return null;
  if ( kind === "table" ) {
    if ( !element.classList.contains("feo-table") ) return null;
    const wrap = element.closest(".feo-table-wrap");
    const alone = wrap && (wrap.querySelectorAll("table").length === 1);
    const html = alone ? wrap.outerHTML : `<div class="feo-table-wrap">${element.outerHTML}</div>`;
    return { classes: "table", widths: TABLE_WIDTHS, tallest: TABLE_TALLEST, html: linked(html) };
  }
  if ( kind === "cycles" ) {
    const group = element.classList.contains("feo-cycles");
    const count = group ? element.querySelectorAll(".feo-cycle").length : 1;
    const html = group ? element.outerHTML : `<div class="feo-cycles">${element.outerHTML}</div>`;
    return {
      classes: "cycles",
      widths: CYCLE_WIDTHS.slice(Math.min(count, CYCLE_WIDTHS.length) - 1),
      tallest: CYCLE_TALLEST,
      html: linked(html)
    };
  }
  return null;
}

/**
 * Draw the pictures of a page: its title, and whichever of its tables and diagrams fit in one.
 * @param {JournalEntryPage} page
 * @param {HTMLElement} root                                           The page's content
 * @param {import("../rules/discord.mjs").RulesPageContent} content    The page as it was read
 * @returns {Promise<{banner: string|undefined, pictures: Map<object, string>, files: Map<string, DiscordFile>}>}
 */
async function drawPictures(page, root, content) {
  const wanted = picturesOf(content);
  const plates = await drawPlates([bannerRequest(page, root), ...wanted.map(plateRequest)], {
    css: await stageStyles()
  });
  const stem = String(page.getFlag(FEO.id, "key") ?? page.name).toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "page";
  const files = new Map();
  const keep = (plate, name, alt) => {
    const address = `attachment://${name}`;
    files.set(address, { name, blob: plate.blob, alt });
    return address;
  };

  const chapter = content.chapter.replace(/^[^\p{L}\p{N}]+/u, "");
  const banner = plates[0] ? keep(plates[0], `${stem}-title.png`, [page.name, chapter].filter(Boolean).join(" · ")) : undefined;
  const pictures = new Map();
  wanted.forEach((picture, index) => {
    const plate = plates[index + 1];
    if ( plate ) pictures.set(picture.node, keep(plate, `${stem}-${index + 1}.png`, picture.alt));
  });
  return { banner, pictures, files };
}

/**
 * The messages that show a page on Discord.
 * @param {JournalEntryPage} page
 * @param {object} [options]
 * @param {boolean} [options.pictures]    Whether to draw the title, the tables and the diagrams as pictures
 * @returns {Promise<DiscordMessage[]>}
 */
async function messagesOf(page, { pictures=true }={}) {
  if ( (page.type !== "text") || !page.text.content ) return [];
  const body = new DOMParser().parseFromString(page.text.content, "text/html").body;
  const root = body.querySelector(".feo-rules") ?? body;
  const content = readPage(treeOf(root), { title: page.name });

  // A page whose pictures cannot be drawn is sent all the same, written out
  let drawn = { banner: undefined, pictures: new Map(), files: new Map() };
  if ( pictures ) {
    try {
      drawn = await drawPictures(page, root, content);
    } catch(err) {
      console.warn(err);
    }
  }
  return shareOut(embedsOf(content, drawn)).map((embeds) => ({
    embeds,
    files: embeds.map((embed) => drawn.files.get(embed.image?.url)).filter(Boolean)
  }));
}

/* -------------------------------------------- */
/*  Talking to Discord                          */
/* -------------------------------------------- */

/**
 * Ask something of Discord, waiting and asking again when it says to slow down.
 * @param {string} method
 * @param {string} url
 * @param {Record<string, string|boolean>} [query]    Left out where empty
 * @param {object} [body]
 * @param {DiscordFile[]} [files]                     Pictures to send along
 * @returns {Promise<object|null>}    What Discord answered, if it answered with anything
 */
async function request(method, url, query={}, body, files=[]) {
  const params = new URLSearchParams();
  for ( const [key, value] of Object.entries(query) ) {
    if ( (value !== "") && (value !== null) && (value !== undefined) ) params.set(key, String(value));
  }
  const address = params.toString() ? `${url}?${params}` : url;
  const options = { method };
  if ( files.length ) {
    // Pictures travel as the parts of a form, with the message itself as one more part
    const form = new FormData();
    form.set("payload_json", JSON.stringify({
      ...body,
      attachments: files.map((file, id) => ({ id, filename: file.name, description: file.alt }))
    }));
    files.forEach((file, id) => form.set(`files[${id}]`, file.blob, file.name));
    options.body = form;
  }
  else if ( body ) {
    options.headers = { "Content-Type": "application/json" };
    options.body = JSON.stringify(body);
  }

  for ( let attempt = 0; ; attempt++ ) {
    const response = await fetch(address, options);
    if ( response.ok ) return response.status === 204 ? null : response.json();
    const answer = await response.json().catch(() => ({}));
    if ( (response.status === 429) && (attempt < RETRIES) ) {
      const seconds = Math.min(Number(answer.retry_after) || 1, LONGEST_WAIT);
      await new Promise((resolve) => setTimeout(resolve, (seconds * 1000) + 100));
      continue;
    }
    const error = new Error(answer.message || response.statusText || String(response.status));
    error.status = response.status;
    error.code = answer.code;
    throw error;
  }
}

/**
 * Take a post down, as far as it is still there.
 * @param {import("../rules/discord.mjs").DiscordWebhook} hook
 * @param {string[]} messages
 * @param {string} thread
 * @returns {Promise<void>}
 */
async function remove(hook, messages, thread) {
  for ( const id of messages ) {
    await request("DELETE", `${hook.url}/messages/${id}`, { thread_id: thread }).catch(() => {});
  }
}

/**
 * Post a page, or change the post it was sent as before.
 *
 * An earlier post is changed where it stands when the page still fits in its messages; any it no longer needs
 * are removed. A page that has outgrown its post cannot be fitted in between what has been said since, so the
 * old post is taken down and a new one made.
 * @param {import("../rules/discord.mjs").DiscordWebhook} hook
 * @param {DiscordMessage[]} messages
 * @param {object} [options]
 * @param {DiscordPost} [options.earlier]   The post to change
 * @param {string} [options.title]          The name given to a forum post made for the page
 * @returns {Promise<DiscordPost>}
 */
async function deliver(hook, messages, { earlier=null, title="" }={}) {
  let thread = hook.thread || earlier?.thread || "";
  const mentions = { parse: [] };

  if ( earlier && (messages.length <= earlier.messages.length) ) {
    try {
      for ( const [index, { embeds, files }] of messages.entries() ) {
        // Naming the pictures a message now has, even when it has none, takes away the ones it had before
        await request("PATCH", `${hook.url}/messages/${earlier.messages[index]}`, { thread_id: thread },
          { embeds, allowed_mentions: mentions, attachments: [] }, files);
      }
      await remove(hook, earlier.messages.slice(messages.length), thread);
      return { hook: hook.id, thread, messages: earlier.messages.slice(0, messages.length), at: Date.now() };
    } catch(err) {
      // A post that has been deleted on Discord since is made anew
      if ( err.status !== 404 ) throw err;
    }
  }
  if ( earlier ) await remove(hook, earlier.messages, thread);

  const sent = [];
  try {
    for ( const [index, { embeds, files }] of messages.entries() ) {
      const body = { embeds, allowed_mentions: mentions };
      if ( index > 0 ) body.flags = SILENT;
      let message;
      try {
        message = await request("POST", hook.url, { wait: true, thread_id: thread }, body, files);
      } catch(err) {
        // A webhook of a forum channel: the page becomes a post of its own there
        if ( (index > 0) || thread || (err.code !== NEEDS_THREAD) ) throw err;
        message = await request("POST", hook.url, { wait: true }, { ...body, thread_name: title.slice(0, 100) }, files);
        thread = message.channel_id;
      }
      sent.push(message.id);
    }
  } catch(err) {
    // What did arrive is remembered, so that sending the page again can clear it away
    if ( sent.length ) err.post = { hook: hook.id, thread, messages: sent, at: Date.now() };
    throw err;
  }
  return { hook: hook.id, thread, messages: sent, at: Date.now() };
}

/* -------------------------------------------- */
/*  Sending a page                              */
/* -------------------------------------------- */

/**
 * Ask the Game Master whether to send a page, and how when it has been sent before.
 * @param {JournalEntryPage} page
 * @param {number} count                How many messages it takes
 * @param {DiscordPost|null} earlier    The post it was sent as before
 * @returns {Promise<"send"|"update"|null>}
 */
async function confirm(page, count, earlier) {
  const name = foundry.utils.escapeHTML(page.name);
  const lines = [
    `<p>${game.i18n.format(`FEO.Discord.confirm.${count === 1 ? "one" : "many"}`, { page: name, count })}</p>`
  ];
  const buttons = [];
  if ( earlier ) {
    const date = new Date(earlier.at).toLocaleDateString(game.i18n.lang, { dateStyle: "long" });
    const fits = count <= earlier.messages.length;
    lines.push(`<p class="hint">${game.i18n.format("FEO.Discord.confirm.earlier", { date })} `
      + `${game.i18n.localize(`FEO.Discord.confirm.${fits ? "inPlace" : "outgrown"}`)}</p>`);
    buttons.push(
      { action: "update", label: "FEO.Discord.confirm.update", icon: "fa-solid fa-rotate", default: true },
      { action: "send", label: "FEO.Discord.confirm.again", icon: "fa-solid fa-paper-plane" }
    );
  }
  else buttons.push({ action: "send", label: "FEO.Discord.confirm.send", icon: "fa-solid fa-paper-plane", default: true });
  buttons.push({ action: "cancel", label: "COMMON.Cancel" });

  const answer = await foundry.applications.api.DialogV2.wait({
    window: { title: "FEO.Discord.confirm.title", icon: "fa-brands fa-discord" },
    position: { width: 440 },
    content: lines.join(""),
    buttons,
    rejectClose: false
  });
  return (answer === "send") || (answer === "update") ? answer : null;
}

/**
 * Say what went wrong in words a Game Master can act on.
 * @param {Error & {status?: number}} err
 */
function report(err) {
  console.error(err);
  if ( err.status === undefined ) ui.notifications.error("FEO.Discord.error.unreachable", { localize: true });
  else if ( [401, 403, 404].includes(err.status) ) ui.notifications.error("FEO.Discord.error.gone", { localize: true });
  else ui.notifications.error(game.i18n.format("FEO.Discord.error.refused", { message: err.message }));
}

/**
 * Send a page of the rules journal to Discord.
 * @param {JournalEntryPage} page
 * @param {HTMLButtonElement} [button]    The button that was pressed, kept busy while the page is made ready
 *                                        and while it is on its way
 * @returns {Promise<void>}
 */
export async function sendPage(page, button) {
  const hook = DiscordConfig.webhook;
  if ( !hook ) {
    ui.notifications.warn("FEO.Discord.noWebhook", { localize: true });
    await new DiscordConfig().render({ force: true });
    return;
  }

  const icon = button?.querySelector("i");
  const resting = icon?.className;
  const busy = (working) => {
    if ( button ) button.disabled = working;
    if ( icon ) icon.className = working ? "fa-solid fa-spinner fa-spin" : resting;
  };

  // Drawing the pictures takes a moment, and how many messages the page takes is not known until it is done
  let messages;
  busy(true);
  try {
    messages = await messagesOf(page, { pictures: game.settings.get(FEO.id, DiscordConfig.PICTURES) !== false });
  } finally {
    busy(false);
  }
  if ( !messages.length ) {
    ui.notifications.warn("FEO.Discord.empty", { localize: true });
    return;
  }

  const key = keyOf(page);
  const posts = game.settings.get(FEO.id, DiscordConfig.POSTS) ?? {};
  const known = posts[key];
  const earlier = (known?.hook === hook.id) && Array.isArray(known.messages) && known.messages.length ? known : null;
  const answer = await confirm(page, messages.length, earlier);
  if ( !answer ) return;

  const remember = (post) => game.settings.set(FEO.id, DiscordConfig.POSTS, {
    ...(game.settings.get(FEO.id, DiscordConfig.POSTS) ?? {}),
    [key]: post
  });
  busy(true);
  try {
    const post = await deliver(hook, messages, { earlier: answer === "update" ? earlier : null, title: page.name });
    await remember(post);
    const said = answer === "update" ? "updated" : "sent";
    ui.notifications.info(game.i18n.format(`FEO.Discord.${said}`, { page: page.name }));
  } catch(err) {
    if ( err.post ) await remember(err.post);
    report(err);
  } finally {
    busy(false);
  }
}

/* -------------------------------------------- */
/*  The button                                  */
/* -------------------------------------------- */

/**
 * Give every page of the rules journal its button, each time the journal draws itself.
 * @param {object} app             The journal's sheet
 * @param {HTMLElement} element    Its window
 */
function onRender(app, element) {
  if ( !game.user.isGM || !isRulesJournal(app.document) ) return;
  const label = game.i18n.localize("FEO.Discord.send");
  for ( const article of element.querySelectorAll(".journal-entry-page[data-page-id]") ) {
    const header = article.querySelector(".journal-page-header");
    if ( !header || header.querySelector(".feo-discord-send") ) continue;
    const page = app.document.pages.get(article.dataset.pageId);
    if ( page?.type !== "text" ) continue;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "feo-discord-send";
    button.dataset.tooltip = label;
    button.ariaLabel = label;
    const icon = document.createElement("i");
    icon.className = "fa-brands fa-discord";
    icon.inert = true;
    button.append(icon);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      sendPage(page, button).catch((err) => console.error(err));
    });
    header.append(button);
  }
}

/**
 * Let a Game Master send pages of the rules journal to Discord.
 */
export function registerDiscord() {
  DiscordConfig.register();
  Hooks.on("renderJournalEntrySheet", onRender);
}
