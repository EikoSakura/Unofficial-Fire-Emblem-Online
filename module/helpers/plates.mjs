/**
 * Plates: pieces of a rules page drawn as pictures.
 *
 * A browser cannot photograph part of its own page, but it can draw an SVG image, and an SVG image can hold
 * HTML. So a plate is made by setting the piece on a stage of its own, with the journal's styles and fonts
 * written into it, wrapping that in an SVG, and painting the SVG on a canvas. The stage is first laid out in a
 * hidden frame that holds nothing but the same styles, which is how the size of the picture is known and how a
 * table too wide or too tall for a picture is found out.
 *
 * An SVG image may not load anything from outside itself, so everything it needs has to be handed in as text:
 * the styles, and the fonts inside them as data.
 */

/**
 * @typedef PlateRequest
 * @property {string} html             What the plate shows: HTML for the page's column of text
 * @property {string} [header]         HTML set above it, where a page's own header stands
 * @property {string} [classes]        Classes for the plate, which the stage's styles answer to
 * @property {number[]} widths         The widths to try, in CSS pixels, narrowest first
 * @property {number} [tallest]        The most height a plate may have for each pixel of its width
 */

/**
 * @typedef Plate
 * @property {Blob} blob       The picture, as a PNG
 * @property {number} width    Its width in CSS pixels; the picture has `scale` times as many
 * @property {number} height
 */

/** What every stage needs that Foundry's own styles give the journal window. */
export const STAGE_STYLES = `
html, body { margin: 0; background: transparent; }
.feo-plate, .feo-plate *, .feo-plate *::before, .feo-plate *::after { box-sizing: border-box; }
.feo-plate.journal-entry {
  margin: 0;
  background: none;
  color: var(--feo-ink);
  font-family: var(--feo-font-ui);
  font-size: 15px;
  line-height: 1.5;
  text-align: left;
  -webkit-font-smoothing: antialiased;
}
.feo-plate.journal-entry .journal-entry-pages { margin: 0; padding: 0; overflow: visible; }
.feo-plate.journal-entry .journal-entry-page { position: relative; max-width: none; margin: 0; padding: 0; }
.feo-plate .feo-rules > * { max-width: none; margin-top: 0; }

/* A table: the card it stands on and nothing around it. Headings may break, so that more tables fit */
.feo-plate .feo-table-wrap { overflow: hidden; box-shadow: none; }
.feo-plate .feo-rules .feo-table th { white-space: normal; }

/* Diagrams: the rings with their names. What is said of each stays as text beside the picture */
.feo-plate.cycles .feo-cycles { flex-wrap: nowrap; }
.feo-plate.cycles .feo-rules .feo-cycle { box-shadow: none; }
.feo-plate.cycles .feo-rules .feo-cycle figcaption { margin-top: 6px; font-size: 0; }
.feo-plate.cycles .feo-rules .feo-cycle figcaption strong { margin: 0; font-size: 19px; }

/* The banner: the chapter line, the pennant and the page's title, on the journal's own ground */
.feo-plate.banner.journal-entry .journal-entry-pages {
  padding: 0 18px 20px;
  border: 1px solid var(--feo-line);
  border-radius: 10px;
  background: var(--feo-page);
  overflow: hidden;
}
.feo-plate.banner.journal-entry .journal-entry-page { padding-top: 56px; }
.feo-plate.banner.plain.journal-entry .journal-entry-page { padding-top: 20px; }
.feo-plate.banner.journal-entry .journal-page-header { margin-bottom: 0; }
.feo-plate.banner .feo-rules > .feo-kicker { max-width: none; }
`;

/**
 * Open the hidden frame that plates are laid out in, and wait for its fonts.
 * @param {string} css    The styles of the stage
 * @returns {Promise<HTMLIFrameElement>}
 */
async function openStage(css) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.cssText = "position: fixed; left: -20000px; top: 0; width: 1200px; height: 800px; border: 0; visibility: hidden;";
  document.body.append(frame);
  const stage = frame.contentDocument;
  stage.open();
  stage.write("<!DOCTYPE html><html><head><meta charset=\"utf-8\"></head><body></body></html>");
  stage.close();
  const style = stage.createElement("style");
  style.textContent = css;
  stage.head.append(style);
  await Promise.allSettled([...stage.fonts].map((face) => face.load()));
  await stage.fonts.ready;
  return frame;
}

/**
 * Lay a plate out at each of its widths in turn and keep the first at which nothing spills over its edge and it
 * is not too tall. A plate that fits at none is not drawn.
 * @param {HTMLElement} plate
 * @param {PlateRequest} request
 * @returns {{width: number, height: number}|null}
 */
function fit(plate, { widths, tallest }) {
  for ( const width of widths ) {
    plate.style.width = `${width}px`;
    const spills = (plate.scrollWidth > plate.clientWidth + 1)
      || [...plate.querySelectorAll(".feo-table-wrap, .feo-cycles")].some((part) => part.scrollWidth > part.clientWidth + 1);
    if ( spills ) continue;
    const height = Math.ceil(plate.getBoundingClientRect().height);
    if ( !height || (tallest && (height > width * tallest)) ) continue;
    return { width, height };
  }
  return null;
}

/**
 * Paint an SVG image on a canvas and hand back the picture.
 * @param {string} svg
 * @param {number} width     The size of the picture, in its own pixels
 * @param {number} height
 * @returns {Promise<Blob>}
 */
async function paint(svg, width, height) {
  const image = new Image();
  image.decoding = "sync";
  const loaded = new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error("The plate could not be read as an image."));
  });
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await loaded;
  await image.decode?.().catch(() => {});

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(image, 0, 0, width, height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if ( !blob ) throw new Error("The plate could not be saved as a picture.");
  return blob;
}

/**
 * Draw one plate.
 * @param {Document} stage    The document of the hidden frame
 * @param {PlateRequest} request
 * @param {string} css
 * @param {number} scale
 * @returns {Promise<Plate|null>}
 */
async function drawPlate(stage, request, css, scale) {
  const plate = stage.createElement("div");
  plate.className = `feo-plate journal-entry ${request.classes ?? ""}`.trim();
  plate.innerHTML = `<div class="journal-entry-pages"><article class="journal-entry-page">${request.header ?? ""}`
    + `<section class="journal-page-content"><div class="feo-rules">${request.html}</div></section></article></div>`;
  for ( const unsafe of plate.querySelectorAll("script, iframe, object, embed, link, img, video, audio") ) unsafe.remove();
  stage.body.replaceChildren(plate);
  const size = fit(plate, request);
  if ( !size ) return null;
  plate.style.width = `${size.width}px`;

  // The styles travel inside the plate, so that the image carries all it needs
  const style = stage.createElement("style");
  style.textContent = css;
  plate.prepend(style);
  const markup = new XMLSerializer().serializeToString(plate);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width * scale}" height="${size.height * scale}" `
    + `viewBox="0 0 ${size.width} ${size.height}"><foreignObject x="0" y="0" width="${size.width}" height="${size.height}">`
    + `${markup}</foreignObject></svg>`;
  const blob = await paint(svg, size.width * scale, size.height * scale);
  return { blob, ...size };
}

/**
 * Draw plates. One that cannot be drawn, for want of room or for any other reason, comes back as null and the
 * others are drawn all the same.
 * @param {(PlateRequest|null)[]} requests
 * @param {object} options
 * @param {string} options.css         The journal's styles, with its fonts written in as data
 * @param {number} [options.scale]     How many pixels of picture each CSS pixel is given
 * @returns {Promise<(Plate|null)[]>}
 */
export async function drawPlates(requests, { css, scale=2 }) {
  if ( !requests.some(Boolean) ) return requests.map(() => null);
  const styles = `${css}\n${STAGE_STYLES}`;
  const frame = await openStage(styles);
  try {
    const plates = [];
    for ( const request of requests ) {
      let plate = null;
      if ( request ) {
        try {
          plate = await drawPlate(frame.contentDocument, request, styles, scale);
        } catch(err) {
          console.warn(err);
        }
      }
      plates.push(plate);
    }
    return plates;
  } finally {
    frame.remove();
  }
}

/**
 * A font file as a `@font-face` rule that holds the font itself.
 * @param {string} family
 * @param {string} url
 * @param {object} [face]
 * @param {string|number} [face.weight]
 * @param {string} [face.style]
 * @returns {Promise<string>}
 */
export async function embedFont(family, url, { weight="400", style="normal" }={}) {
  const response = await fetch(url);
  if ( !response.ok ) throw new Error(`The font at ${url} could not be read.`);
  const blob = await response.blob();
  const data = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  const format = /\.woff2(\?|$)/.test(url) ? "woff2" : /\.woff(\?|$)/.test(url) ? "woff" : "truetype";
  const source = data.replace(/^data:[^;,]*/, `data:font/${format === "truetype" ? "ttf" : format}`);
  return `@font-face { font-family: "${family}"; src: url("${source}") format("${format}"); `
    + `font-weight: ${weight}; font-style: ${style}; }`;
}
