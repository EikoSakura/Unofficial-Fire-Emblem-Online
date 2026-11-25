import { FEO } from "../config.mjs";
import { routeBow } from "../rules/worldmap.mjs";

/**
 * How a World Map is drawn: the ground painted on a canvas, peaks and woods inked over it on another, and the
 * routes, places, names and the company's banner as SVG laid over both. Everything here draws from what it is
 * given and knows nothing of Foundry.
 *
 * @import {Land, Nation, Place, Route} from "../rules/worldmap.mjs"
 */

/** The picture of each kind of place, drawn standing on a line through 0, of the Base, and of bare ground. */
export const PLACE_GLYPHS = {
  capital: '<path d="M-8 0V-8h2v1.500h2V-8h1v-4h1.500v1.500h3V-12H3v4h1v1.500h2V-8h2V0z"/><path d="M-1.500 0v-3.500a1.500 1.500 0 0 1 3 0V0"/>',
  fort: '<path d="M-5 0V-9h1.800v1.600h2V-9h2.400v1.600h2V-9H5V0z"/><path d="M-1.300 0v-3h2.600v3"/>',
  town: '<path d="M-8 0v-5l3.500-3.500L-1-5v5z"/><path d="M0 0v-7l4-4 4 4v7z"/>',
  village: '<path d="M-4.500 0v-4.500L0-8.500l4.500 4V0z"/>',
  port: '<circle cx="0" cy="-11" r="1.700"/><path class="wm-open" d="M0-9.300V-1M-3-6.500h6M-5.500-5c0 5.500 11 5.500 11 0"/>',
  ruins: '<path d="M-7 0v-8h2.600V0z"/><path d="M-1.500 0v-4.500l2.600-1.200V0z"/><path d="M4.400 0v-9.500H7V0z"/><path class="wm-open" d="M-9 0H9"/>',
  base: '<path d="M-7.500 0L0-10l7.500 10z"/><path class="wm-open" d="M0-10V0M0-10v-3.500l4 1.500-4 1.500"/>',
  ground: '<circle class="wm-open" cx="0" cy="-6" r="5.500"/><circle cx="0" cy="-6" r="1.600"/>'
};

const escape = (text) => String(text ?? "").replace(/[&<>"]/g, (sign) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[sign]));

/**
 * The picture of a kind of place as an SVG element of its own, for a button or a crest.
 * @param {string} kind       A key of PLACE_GLYPHS
 * @returns {string}
 */
export function glyphSvg(kind) {
  return `<svg class="wm-glyph" viewBox="-10 -14 20 16" aria-hidden="true" focusable="false">${PLACE_GLYPHS[kind] ?? PLACE_GLYPHS.village}</svg>`;
}

/* -------------------------------------------- */
/*  The Ground                                  */
/* -------------------------------------------- */

/** The points around a point, at a distance, that tell whether a border is near. */
const around = (reach) => {
  const slant = Math.round(reach * 0.7071);
  return [reach, 0, -reach, 0, 0, reach, 0, -reach, slant, slant, -slant, slant, slant, -slant, -slant, -slant];
};
const NEAR = around(2);
const BAND = around(6);
const WASH = around(12);

/**
 * Paint the ground of a map on a canvas: the land as it was made, tinted by the nation that holds it, with a
 * band of deeper colour along each border.
 * @param {CanvasRenderingContext2D} pen
 * @param {Land} land
 * @param {Uint8Array} claims
 * @param {Nation[]} nations
 * @param {object} [options]
 * @param {number} [options.spotlight]    A nation to pick out: the others are faded
 * @param {{x0: number, y0: number, x1: number, y1: number}} [options.box]    The part to paint; all of it if not given
 */
export function paintGround(pen, land, claims, nations, { spotlight = 0, box } = {}) {
  const { width: W, height: H, paint, picture } = land;
  const x0 = Math.max(Math.floor(box?.x0 ?? 0), 0);
  const y0 = Math.max(Math.floor(box?.y0 ?? 0), 0);
  const x1 = Math.min(Math.ceil(box?.x1 ?? W), W);
  const y1 = Math.min(Math.ceil(box?.y1 ?? H), H);
  const w = x1 - x0;
  const h = y1 - y0;
  if ( (w <= 0) || (h <= 0) ) return;
  const colors = [];
  for ( const nation of nations ) colors[nation.id] = FEO.worldMap.colors[nation.color] ?? FEO.worldMap.colors[0];

  // Is ground held by someone else within reach of a point?
  const borders = (x, y, holder, reach) => {
    for ( let n = 0; n < 16; n += 2 ) {
      const px = x + reach[n];
      const py = y + reach[n + 1];
      if ( (px < 0) || (py < 0) || (px >= W) || (py >= H) ) continue;
      const i = (py * W) + px;
      if ( land.land[i] && (claims[i] !== holder) ) return true;
    }
    return false;
  };

  const image = pen.createImageData(w, h);
  const data = image.data;
  for ( let y = y0; y < y1; y++ ) {
    for ( let x = x0; x < x1; x++ ) {
      const i = (y * W) + x;
      const at = (((y - y0) * w) + (x - x0)) * 4;
      let r = paint[i * 3];
      let g = paint[(i * 3) + 1];
      let b = paint[(i * 3) + 2];
      if ( land.land[i] ) {
        const holder = claims[i];
        const color = colors[holder];
        if ( color ) {
          if ( borders(x, y, holder, NEAR) ) {
            r += ((color[0] * 0.5) - r) * 0.85;
            g += ((color[1] * 0.5) - g) * 0.85;
            b += ((color[2] * 0.5) - b) * 0.85;
          } else {
            const share = borders(x, y, holder, BAND) ? 0.56 : borders(x, y, holder, WASH) ? 0.36 : 0.17;
            r += (color[0] - r) * share;
            g += (color[1] - g) * share;
            b += (color[2] - b) * share;
          }
        } else if ( !picture ) {
          // Land nobody holds is greyed a little
          const grey = (r + g + b) / 3;
          r += (grey + 8 - r) * 0.45;
          g += (grey + 4 - g) * 0.45;
          b += (grey - 6 - b) * 0.45;
        }
        if ( spotlight && (holder !== spotlight) ) {
          r += (216 - r) * 0.62;
          g += (206 - g) * 0.62;
          b += (180 - b) * 0.62;
        }
      }
      data[at] = r;
      data[at + 1] = g;
      data[at + 2] = b;
      data[at + 3] = 255;
    }
  }
  pen.putImageData(image, x0, y0);
}

/* -------------------------------------------- */

/**
 * Ink the peaks, hills and woods of a land on a canvas of their own.
 * @param {CanvasRenderingContext2D} pen
 * @param {Land} land
 */
export function paintMarks(pen, land) {
  pen.clearRect(0, 0, land.width, land.height);
  pen.lineJoin = "round";
  pen.lineCap = "round";
  for ( const { kind, x, y, size } of land.marks ) {
    if ( kind === "peak" ) {
      const w = 7.5 * size;
      const h = 11 * size;

      // A lit face, a face in shade, and snow on the tall ones
      pen.beginPath();
      pen.moveTo(x - w, y + 3);
      pen.lineTo(x, y - h);
      pen.lineTo(x + (w * 0.22), y + 3);
      pen.closePath();
      pen.fillStyle = "rgba(226, 212, 182, .95)";
      pen.fill();
      pen.beginPath();
      pen.moveTo(x, y - h);
      pen.lineTo(x + w, y + 3);
      pen.lineTo(x + (w * 0.22), y + 3);
      pen.closePath();
      pen.fillStyle = "rgba(112, 90, 68, .95)";
      pen.fill();
      pen.beginPath();
      pen.moveTo(x - w, y + 3);
      pen.lineTo(x, y - h);
      pen.lineTo(x + w, y + 3);
      pen.strokeStyle = "rgba(52, 38, 22, .85)";
      pen.lineWidth = 1.1;
      pen.stroke();
      if ( size > 1.15 ) {
        pen.beginPath();
        pen.moveTo(x - (w * 0.3), y - (h * 0.62));
        pen.lineTo(x, y - h);
        pen.lineTo(x + (w * 0.26), y - (h * 0.66));
        pen.lineTo(x, y - (h * 0.5));
        pen.closePath();
        pen.fillStyle = "rgba(250, 248, 240, .9)";
        pen.fill();
      }
    } else if ( kind === "hill" ) {
      pen.beginPath();
      pen.arc(x, y + 2, 5 * size, Math.PI * 1.05, Math.PI * 1.95);
      pen.strokeStyle = "rgba(70, 52, 30, .55)";
      pen.lineWidth = 1.1;
      pen.stroke();
    } else {
      const r = 3.1 * size;
      pen.beginPath();
      pen.arc(x, y, r, 0, Math.PI * 2);
      pen.fillStyle = "rgba(86, 120, 70, .9)";
      pen.fill();
      pen.strokeStyle = "rgba(40, 54, 26, .55)";
      pen.lineWidth = 0.9;
      pen.stroke();
      pen.beginPath();
      pen.arc(x - (r * 0.3), y - (r * 0.3), r * 0.45, 0, Math.PI * 2);
      pen.fillStyle = "rgba(142, 170, 104, .8)";
      pen.fill();
    }
  }
}

/* -------------------------------------------- */
/*  What Lies Over It                           */
/* -------------------------------------------- */

/**
 * The line of a route as the path of an SVG element.
 * @param {Route} route
 * @param {Map<string, Place>} at     The places by their ids
 * @param {string} [from]             The end it is followed from; its `a` if not given
 * @returns {string}
 */
export function routeLine(route, at, from = route.a) {
  const a = at.get(from);
  const b = at.get(from === route.a ? route.b : route.a);
  const bow = routeBow(a, b, from === route.a ? route.bend : -route.bend);
  return `M${a.x} ${a.y}Q${bow.x.toFixed(1)} ${bow.y.toFixed(1)} ${b.x} ${b.y}`;
}

/* -------------------------------------------- */

/**
 * The banner of the company, standing at a point.
 * @param {number} x
 * @param {number} y
 * @returns {string}
 */
export function bannerMarkup(x, y) {
  return `<g class="wm-party" transform="translate(${(x + 11).toFixed(1)} ${(y + 3).toFixed(1)})">
    <ellipse cx="0" cy="1" rx="7" ry="2.600" fill="rgba(20, 12, 4, .4)"/>
    <g class="wm-bob"><path d="M0 0V-31" stroke="#2a1c0d" stroke-width="2.600" stroke-linecap="round"/>
    <path d="M1.200-31l20 6-20 6z" fill="#4a86e4" stroke="#0f2146" stroke-width="1.700" stroke-linejoin="round"/>
    <path d="M1.200-28.500l11 3.500" stroke="#bcd6ff" stroke-width="1.300" stroke-linecap="round"/>
    <circle cy="-32" r="2.200" fill="#f0d48a" stroke="#2a1c0d" stroke-width="1.200"/></g></g>`;
}

/* -------------------------------------------- */

/**
 * The frame of ground a battle map is being made from (see rules/mapgen-land.mjs), with a pin on the point it
 * is made of where that is no place.
 * @param {import("../rules/mapgen-land.mjs").Lens} lens
 * @param {{x: number, y: number}|null} [pin]
 * @returns {string}
 */
export function lensMarkup(lens, pin = null) {
  const box = `x="${lens.x0}" y="${lens.y0}" width="${lens.w}" height="${lens.h}"`;
  return `<g class="wm-lens"><rect class="wm-lens-shade" ${box}/><rect class="wm-lens-under" ${box}/><rect class="wm-lens-over" ${box}/>${
    pin ? `<circle class="wm-lens-pin" cx="${pin.x.toFixed(1)}" cy="${pin.y.toFixed(1)}" r="3.400"/>` : ""}</g>`;
}

/* -------------------------------------------- */

/**
 * Everything that lies over the ground, as the markup of each layer of the SVG.
 * @param {object} view
 * @param {Place[]} view.places
 * @param {Route[]} view.routes
 * @param {Nation[]} view.nations
 * @param {Map<number, {area: number, x: number, y: number}>} view.facts      See `nationFacts`
 * @param {string} view.base                              The place the Base is at
 * @param {string} view.party                             The place the company is at
 * @param {(place: Place) => boolean} view.shown          Is a place drawn at all?
 * @param {(place: Place) => boolean} view.veiled         Is it drawn faded, as one the players do not see?
 * @param {(place: Place) => boolean} view.named          Does its name always show?
 * @param {string} [view.selected]                        The place that is picked out
 * @param {string} [view.linking]                         The place a route is being drawn from
 * @param {{route: Route, from: string}[]} [view.lit]     The way that is lit
 * @param {number} [view.spotlight]                       The nation that is picked out
 * @returns {{names: string, routes: string, lit: string, places: string, party: string}}
 */
export function overlayMarkup({ places, routes, nations, facts, base, party, shown, veiled, named, selected = "", linking = "", lit = [], spotlight = 0 }) {
  const at = new Map(places.map((place) => [place.id, place]));

  const names = nations.map((nation) => {
    const fact = facts.get(nation.id);
    if ( !fact || (fact.area < 640) || !nation.name ) return "";
    const size = Math.min(Math.max(Math.sqrt(fact.area) / 8.2, 14), 34);
    const ink = (FEO.worldMap.colors[nation.color] ?? [90, 70, 40]).map((part) => Math.round(part * 0.38));
    const faded = spotlight && (spotlight !== nation.id) ? ' opacity=".25"' : "";
    return `<text class="wm-nation" x="${fact.x.toFixed(1)}" y="${(fact.y + (size * 0.35)).toFixed(1)}" font-size="${size.toFixed(1)}" letter-spacing="${(size * 0.3).toFixed(1)}" fill="rgb(${ink})"${faded}>${escape(nation.name)}</text>`;
  }).join("");

  const lines = routes.map((route) => {
    const a = at.get(route.a);
    const b = at.get(route.b);
    if ( !a || !b || !shown(a) || !shown(b) ) return "";
    const line = routeLine(route, at);
    const cls = `wm-route wm-${route.kind}${veiled(a) || veiled(b) ? " wm-veiled" : ""}`;
    return `<g class="${cls}"><path class="wm-under" d="${line}"/><path class="wm-over" d="${line}"/></g>`;
  }).join("");

  const dots = places.filter(shown).map((place) => {
    const capital = place.kind === "capital";
    const home = place.id === base;
    const r = capital ? 8.6 : 6.6;
    const cls = ["wm-node", capital && "wm-capital", (place.id === selected) && "wm-sel", (place.id === linking) && "wm-linking",
      veiled(place) && "wm-veiled", named(place) && "wm-named"].filter(Boolean).join(" ");
    const state = place.battle ? "battle" : place.visited ? "visited" : "open";
    return `<g class="${cls}" data-place="${escape(place.id)}" data-state="${state}" transform="translate(${place.x} ${place.y})">
      <circle class="wm-hit" r="17"/>${place.battle ? `<circle class="wm-pulse" r="${r + 2}"/>` : ""}
      <g class="wm-kind${home ? " wm-home" : ""}" transform="translate(0 ${-r - 3.5}) scale(${capital ? 1.25 : 1.05})">${PLACE_GLYPHS[home ? "base" : place.kind] ?? PLACE_GLYPHS.village}</g>
      <circle class="wm-halo" r="${r + 4.5}"/><circle class="wm-dot" r="${r}"/>${capital ? '<circle class="wm-core" r="3.300"/>' : ""}
      <path class="wm-shine" d="M${(-r * 0.55).toFixed(1)} ${(-r * 0.2).toFixed(1)}A${(r * 0.6).toFixed(1)} ${(r * 0.6).toFixed(1)} 0 0 1 ${(-r * 0.1).toFixed(1)} ${(-r * 0.58).toFixed(1)}"/>
      <text y="${r + 15}">${escape(place.name)}</text></g>`;
  }).join("");

  const company = at.get(party);
  return {
    names,
    routes: lines,
    lit: lit.map((leg) => `<path d="${routeLine(leg.route, at, leg.from)}"/>`).join(""),
    places: dots,
    party: company ? bannerMarkup(company.x, company.y) : ""
  };
}
