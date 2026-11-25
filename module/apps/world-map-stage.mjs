import { FEO } from "../config.mjs";
import { bannerMarkup, paintGround, paintMarks } from "./world-map-draw.mjs";

/**
 * The part of a window a World Map is shown in: it paints the map, lets it be moved and looked at closely, and
 * tells the window what was clicked, dragged or painted on it. Both the World Map and its Creator show their
 * map in one of these.
 *
 * The map is always as large as FEO.worldMap says, and is scaled to cover the space it is given, so a point of
 * the map is the same wherever and however large it is shown.
 *
 * @import {Land, Nation} from "../rules/worldmap.mjs"
 *
 * @typedef StageHandlers
 * What the window does when something happens on the map. Points are points of the map.
 * @property {(place: string|null) => "pan"|"paint"|"drag"|"none"} [mode]   What a press does, on a place or off one
 * @property {(place: string) => void} [place]                    A place was clicked
 * @property {(point: {x: number, y: number}) => void} [ground]   The map was clicked where no place is
 * @property {(point: {x: number, y: number}, from: {x: number, y: number}) => void} [paint]   The brush moved
 * @property {() => void} [painted]                               The brush was lifted
 * @property {(place: string, point: {x: number, y: number}) => void} [drag]     A place is being dragged
 * @property {(place: string) => void} [dragged]                  A place was let go
 * @property {(point: {x: number, y: number}|null) => void} [hover]   The pointer moved over the map, or left it
 */
export default class MapStage {

  /**
   * @param {HTMLElement} viewport      The element of class `wm-viewport` in the window
   * @param {StageHandlers} [handlers]
   */
  constructor(viewport, handlers = {}) {
    this.#viewport = viewport;
    this.#world = viewport.querySelector(".wm-world");
    this.#ground = viewport.querySelector("canvas.wm-ground").getContext("2d");
    this.#marks = viewport.querySelector("canvas.wm-marks").getContext("2d");
    this.#handlers = handlers;
    const { width, height } = FEO.worldMap;
    for ( const sheet of viewport.querySelectorAll("canvas") ) Object.assign(sheet, { width, height });
    viewport.querySelector("svg.wm-over").setAttribute("viewBox", `0 0 ${width} ${height}`);
    Object.assign(this.#world.style, { width: `${width}px`, height: `${height}px` });
    viewport.addEventListener("contextmenu", (event) => event.preventDefault());
    viewport.addEventListener("wheel", (event) => this.#onWheel(event), { passive: false });
    viewport.addEventListener("pointerdown", (event) => this.#onDown(event));
    viewport.addEventListener("pointermove", (event) => this.#onMove(event));
    viewport.addEventListener("pointerup", (event) => this.#onUp(event));
    viewport.addEventListener("pointercancel", () => this.#release());
    viewport.addEventListener("pointerleave", () => {
      if ( !this.#press ) this.#handlers.hover?.(null);
    });
    this.#watch = new ResizeObserver(() => this.#fit());
    this.#watch.observe(viewport);
    this.#fit();
  }

  /* -------------------------------------------- */

  #viewport;

  #world;

  #ground;

  #marks;

  /** @type {StageHandlers} */
  #handlers;

  #watch;

  /** How closely the map is looked at: 1 covers the space it is given. */
  #zoom = 1;

  /** Where the map's corner lies in the viewport, or null until it has been placed. */
  #at = null;

  /** The scale the map is shown at. */
  #scale = 1;

  /** The press that is under way. */
  #press = null;

  /** What the ground was last painted from. */
  #painted = { land: null, claims: null, nations: [], spotlight: 0 };

  /* -------------------------------------------- */
  /*  Moving the Map                              */
  /* -------------------------------------------- */

  /**
   * Scale the map to cover the viewport, and keep it from being moved off it.
   */
  #fit() {
    const { width: W, height: H } = FEO.worldMap;
    const vw = this.#viewport.clientWidth;
    const vh = this.#viewport.clientHeight;
    if ( !vw || !vh ) return;
    this.#scale = Math.max(vw / W, vh / H) * this.#zoom;
    this.#at ??= { x: (vw - (W * this.#scale)) / 2, y: (vh - (H * this.#scale)) / 2 };
    this.#at.x = Math.min(Math.max(this.#at.x, vw - (W * this.#scale)), 0);
    this.#at.y = Math.min(Math.max(this.#at.y, vh - (H * this.#scale)), 0);
    this.#world.style.transform = `translate(${this.#at.x}px, ${this.#at.y}px) scale(${this.#scale})`;
  }

  /* -------------------------------------------- */

  /**
   * Look closer or from further off, keeping one point of the viewport where it is.
   * @param {number} factor     More than 1 to look closer
   * @param {number} [x]        The point to keep, in the viewport; its middle if not given
   * @param {number} [y]
   */
  zoomBy(factor, x = this.#viewport.clientWidth / 2, y = this.#viewport.clientHeight / 2) {
    const zoom = Math.min(Math.max(this.#zoom * factor, 1), FEO.worldMap.zoom);
    if ( !this.#at || (zoom === this.#zoom) ) return;
    const by = zoom / this.#zoom;
    this.#at.x = x - ((x - this.#at.x) * by);
    this.#at.y = y - ((y - this.#at.y) * by);
    this.#zoom = zoom;
    this.#fit();
  }

  /* -------------------------------------------- */

  /**
   * The point of the map under a pointer.
   * @param {PointerEvent|MouseEvent} event
   * @returns {{x: number, y: number}}
   */
  point(event) {
    const box = this.#world.getBoundingClientRect();
    return {
      x: ((event.clientX - box.left) / box.width) * FEO.worldMap.width,
      y: ((event.clientY - box.top) / box.height) * FEO.worldMap.height
    };
  }

  /* -------------------------------------------- */
  /*  Drawing                                     */
  /* -------------------------------------------- */

  /**
   * Paint the ground of the map. The peaks and woods are inked again only when the land is another.
   * @param {Land} land
   * @param {Uint8Array} claims
   * @param {Nation[]} nations
   * @param {number} [spotlight]      A nation to pick out
   */
  ground(land, claims, nations, spotlight = 0) {
    if ( this.#painted.land !== land ) paintMarks(this.#marks, land);
    this.#painted = { land, claims, nations, spotlight };
    paintGround(this.#ground, land, claims, nations, { spotlight });
  }

  /* -------------------------------------------- */

  /**
   * Paint part of the ground again, from what it was last painted from.
   * @param {{x0: number, y0: number, x1: number, y1: number}} box
   */
  groundBox(box) {
    const { land, claims, nations, spotlight } = this.#painted;
    if ( !land ) return;
    paintGround(this.#ground, land, claims, nations, {
      spotlight, box: { x0: box.x0 - 14, y0: box.y0 - 14, x1: box.x1 + 14, y1: box.y1 + 14 }
    });
  }

  /* -------------------------------------------- */

  /**
   * Draw what lies over the ground.
   * @param {{names: string, routes: string, lit: string, places: string, party: string}} markup   See `overlayMarkup`
   */
  overlay(markup) {
    for ( const [layer, html] of Object.entries(markup) ) {
      const group = this.#viewport.querySelector(`svg.wm-over [data-layer="${layer}"]`);
      if ( group ) group.innerHTML = html;
    }
  }

  /* -------------------------------------------- */

  /**
   * Stand the company's banner at a point of the map.
   * @param {number} x
   * @param {number} y
   */
  banner(x, y) {
    this.overlay({ party: bannerMarkup(x, y) });
  }

  /* -------------------------------------------- */

  /**
   * Flash a point of the map.
   * @param {number} x
   * @param {number} y
   */
  ping(x, y) {
    this.overlay({ fx: `<circle class="wm-ping" cx="${x}" cy="${y}" r="12"/>` });
    clearTimeout(this.#pinged);
    this.#pinged = setTimeout(() => this.overlay({ fx: "" }), 1900);
  }

  #pinged = 0;

  /* -------------------------------------------- */

  /**
   * Show the brush at a point of the map, or take it away.
   * @param {{x: number, y: number}|null} point
   * @param {number} [reach]
   */
  brush(point, reach = 0) {
    this.overlay({ fx: point ? `<circle class="wm-brush" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="${reach}"/>` : "" });
  }

  /* -------------------------------------------- */

  /**
   * Stop watching the viewport.
   */
  destroy() {
    this.#watch.disconnect();
    clearTimeout(this.#pinged);
  }

  /* -------------------------------------------- */
  /*  The Pointer                                 */
  /* -------------------------------------------- */

  #onWheel(event) {
    event.preventDefault();
    const box = this.#viewport.getBoundingClientRect();
    this.zoomBy(event.deltaY < 0 ? 1.18 : 0.85, event.clientX - box.left, event.clientY - box.top);
  }

  /* -------------------------------------------- */

  #onDown(event) {
    if ( (event.button > 2) || event.target.closest(".wm-chrome") ) return;
    const place = event.target.closest("[data-place]")?.dataset.place ?? null;
    const point = this.point(event);

    // The right and the middle button always move the map, whatever tool is in hand
    const mode = event.button ? "move" : (this.#handlers.mode?.(place) ?? "pan");
    this.#press = { x: event.clientX, y: event.clientY, at: { ...this.#at }, place, point, mode, moved: false };
    try {
      this.#viewport.setPointerCapture(event.pointerId);
    } catch(err) {
      // A pointer that cannot be held is followed for as long as it stays over the map
    }
    if ( mode === "paint" ) this.#handlers.paint?.(point, point);
  }

  /* -------------------------------------------- */

  #onMove(event) {
    const point = this.point(event);
    const press = this.#press;
    if ( !press ) return this.#handlers.hover?.(point);
    if ( Math.hypot(event.clientX - press.x, event.clientY - press.y) > 4 ) press.moved = true;
    if ( press.mode === "paint" ) {
      this.#handlers.hover?.(point);
      this.#handlers.paint?.(point, press.point);
      press.point = point;
    }
    else if ( !press.moved ) return;
    else if ( (press.mode === "pan") || (press.mode === "move") ) {
      this.#viewport.classList.add("wm-panning");
      this.#at.x = press.at.x + (event.clientX - press.x);
      this.#at.y = press.at.y + (event.clientY - press.y);
      this.#fit();
    }
    else if ( press.mode === "drag" ) this.#handlers.drag?.(press.place, point);
  }

  /* -------------------------------------------- */

  #onUp(event) {
    const press = this.#release();
    if ( !press ) return;
    if ( press.mode === "paint" ) return this.#handlers.painted?.();
    if ( press.moved || (press.mode === "move") ) {
      if ( press.mode === "drag" ) this.#handlers.dragged?.(press.place);
      return;
    }
    if ( press.place ) this.#handlers.place?.(press.place);
    else this.#handlers.ground?.(this.point(event));
  }

  /* -------------------------------------------- */

  /**
   * End the press that is under way.
   * @returns {object|null}     The press
   */
  #release() {
    const press = this.#press;
    this.#press = null;
    this.#viewport.classList.remove("wm-panning");
    return press;
  }
}
