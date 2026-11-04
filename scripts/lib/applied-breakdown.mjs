/**
 * Breakdown lines built from what the actor's preparation really applied (applied-changes service, #91): the
 * helper's modifiedFields copy, the Defesa item lines, the muted lines of the contributions a feature cut and the
 * residual line that makes the total match the sheet.
 */

/** modifiedFields keys the system's fieldBonuses helper reads as an ArrayField(StringField) of the actor. */
const ARRAY_KEY =
  /^system\.(?:attributes\.(?:pv|pm)\.bonus\.(?:nivel|nivelPar|nivelImpar|total)|attributes\.defesa\.bonus|pericias\.[^.*]+\.bonus|modificadores\.pericias\.(?:geral|ataque|resistencia|semataque|atr\.[^.*]+))$/;
export const OUTROS_KEY = "system.attributes.defesa.outros";
export const CONDI_KEY = "system.attributes.defesa.condi";
export const DEFENSE_BONUS_KEY = "system.attributes.defesa.bonus";
const ARMOR = new Set(["leve", "pesada"]);
const TOTAL = /(<label>Total:<\/label><span>)([+-]?\d+(?:\.\d+)?)(<\/span>)/;
const signed = (n) => (n >= 0 ? `+${n}` : String(n));
const tidy = (n) => Math.round(n * 1e6) / 1e6;
const escapeHTML = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/**
 * Whether the helper reads this modifiedFields key as an ArrayField(StringField) of the actor.
 * @param {string} key
 */
export function isArrayKey(key) {
  return typeof key === "string" && ARRAY_KEY.test(key);
}

/**
 * Whether the breakdown uses the changes applied to this key: the helper's array keys and the Defesa "Outros" and
 * condition fields.
 * @param {string} key
 */
export function isTrackedKey(key) {
  return isArrayKey(key) || key === OUTROS_KEY || key === CONDI_KEY;
}

/**
 * Whether a change key reaches a field: equal, or a `.*.` wildcard of it (ActiveEffectT20._prepareProxyChange).
 * @param {string} pattern  The change key, possibly with a wildcard.
 * @param {string} key      A concrete field path.
 */
export function keyReaches(pattern, key) {
  if (typeof pattern !== "string" || typeof key !== "string") return false;
  if (pattern === key) return true;
  if (!pattern.includes(".*.") && !pattern.endsWith(".*")) return false;
  const parts = pattern.split(".");
  const fields = key.split(".");
  return parts.length === fields.length && parts.every((p, i) => p === "*" || p === fields[i]);
}

/**
 * modifiedFields with only what was applied, in the shape the system builds ({label, value, type} per key).
 * @param {{key: string, label: string, value: unknown, type: string}[]} changes
 */
export function fieldsFromChanges(changes) {
  const acc = {};
  for (const ch of changes ?? []) (acc[ch.key] ??= []).push({ label: ch.label, value: ch.value, type: ch.type });
  return acc;
}

/**
 * Item lines of the Defesa, in the helper's order: prepareDefense (T20:18733-18736) adds the first equipped armor,
 * the first shield and every accessory; the other armors and shields are muted ("not-counted"), and so are the
 * accessories a feature reported as cut.
 * @param {{id: string, name: string, tipo: string, value: number}[]} equipped  Equipped items, in itemTypes order.
 * @param {{item?: {id: string, accessory?: boolean}, reason: string}[]} [suppressed]
 * @returns {{label: string, value: number, muted: boolean, reason?: string}[]}
 */
export function defenseItemLines(equipped, suppressed = []) {
  const lost = new Map((suppressed ?? []).filter((s) => s?.item?.accessory).map((s) => [s.item.id, s.reason]));
  const items = equipped ?? [];
  const armor = items.find((i) => ARMOR.has(i.tipo));
  const shield = items.find((i) => i.tipo === "escudo");
  return items
    .filter((item) => item.value)
    .map((item) => {
      if (ARMOR.has(item.tipo) || item.tipo === "escudo") {
        const counted = item === armor || item === shield;
        return counted ? { label: item.name, value: item.value, muted: false } : { label: item.name, value: item.value, muted: true, reason: "not-counted" };
      }
      const reason = lost.get(item.id);
      return reason ? { label: item.name, value: item.value, muted: true, reason } : { label: item.name, value: item.value, muted: false };
    });
}

/**
 * Muted lines of the contributions cut from some fields (the accessories are in defenseItemLines).
 * @param {{key: string, label: string, value: unknown, reason: string, item?: {accessory?: boolean}}[]} suppressed
 * @param {string|string[]} keys  Concrete field paths; wildcard reports reach them too.
 */
export function suppressedLines(suppressed, keys) {
  const list = Array.isArray(keys) ? keys : [keys];
  return (suppressed ?? [])
    .filter((s) => !s?.item?.accessory && list.some((key) => keyReaches(s?.key, key)))
    .map((s) => ({ label: s.label, value: Number.isFinite(Number(s.value)) ? Number(s.value) : 0, muted: true, reason: s.reason }));
}

/**
 * The modifiedFields keys the helper lists for a skill (T20:3175-3209), besides its own `system.pericias.<key>.bonus`.
 * @param {string} key       Skill id.
 * @param {string} atributo  The skill's attribute.
 */
export function skillModifierKeys(key, atributo) {
  const attack = ["luta", "pont"].includes(key);
  return [
    "system.modificadores.pericias.geral",
    ...(attack ? ["system.modificadores.pericias.ataque"] : []),
    ...(["fort", "refl", "vont"].includes(key) ? ["system.modificadores.pericias.resistencia"] : []),
    ...(!attack ? ["system.modificadores.pericias.semataque"] : []),
    ...(atributo ? [`system.modificadores.pericias.atr.${atributo}`] : [])
  ];
}

/**
 * The total a breakdown shows, or NaN when the format is not recognized.
 * @param {string} html
 */
export function tooltipTotal(html) {
  if (typeof html !== "string") return NaN;
  const hr = html.lastIndexOf("<hr>");
  return hr < 0 ? NaN : Number(TOTAL.exec(html.slice(hr))?.[2]);
}

/**
 * What the breakdown misses to reach the prepared value; 0 when it matches or either number is unknown.
 * @param {number} total     The breakdown's total.
 * @param {number} prepared  The prepared value on the sheet.
 */
export function residual(total, prepared) {
  if (!Number.isFinite(total) || !Number.isFinite(prepared)) return 0;
  const diff = tidy(prepared - total);
  return diff === 0 ? 0 : diff;
}

/**
 * A line of a breakdown; a muted line shows its value in parentheses with the reason and does not count.
 * @param {{label: string, value: number, muted?: boolean}} line
 * @param {string} [note]  Text after a muted value.
 * @param {string} [attr]  Extra attributes of the <li>.
 */
export function lineHTML(line, note = "", attr = "") {
  const cls = line.muted ? "flexrow t20cp-muted" : "flexrow";
  const value = line.muted ? `(${signed(line.value)})${note ? ` ${escapeHTML(note)}` : ""}` : signed(tidy(line.value));
  return `<li class="${cls}"${attr}><label>${escapeHTML(line.label)}:</label><span>${value}</span></li>`;
}

/**
 * Adds lines before the total; the lines that are not muted correct the total.
 * Returns the HTML unchanged when there is nothing to add or the total is not found.
 * @param {string} html
 * @param {{label: string, value: number, muted?: boolean, reason?: string}[]} lines
 * @param {(reason?: string) => string} [noteOf]  Text of a muted line's reason.
 */
export function appendLines(html, lines, noteOf = () => "") {
  const list = (lines ?? []).filter((l) => l.muted || (Number.isFinite(l.value) && l.value));
  if (!list.length || !Number.isFinite(tooltipTotal(html))) return html;
  const hr = html.lastIndexOf("<hr>");
  const delta = list.reduce((s, l) => s + (l.muted ? 0 : l.value), 0);
  const added = list.map((l) => lineHTML(l, l.muted ? noteOf(l.reason) : "")).join("");
  const tail = html.slice(hr).replace(TOTAL, (_, open, total, close) => `${open}${signed(tidy(Number(total) + delta))}${close}`);
  return `${html.slice(0, hr)}${added}\n\t\t\t${tail}`;
}

/**
 * Mutes the helper's item lines that do not count, in order, and takes them out of the total. The helper writes
 * each item as `<label>name:</label><span>+value</span>` with the name unescaped (T20:3216-3222).
 * Returns the HTML unchanged when no line is muted or any item line is not found.
 * @param {string} html
 * @param {{label: string, value: number, muted: boolean, reason?: string}[]} lines  Output of defenseItemLines.
 * @param {(reason?: string) => string} [noteOf]
 */
export function muteItemLines(html, lines, noteOf = () => "") {
  if (!(lines ?? []).some((l) => l.muted) || !Number.isFinite(tooltipTotal(html))) return html;
  const hr = html.lastIndexOf("<hr>");
  let head = html.slice(0, hr);
  let cursor = 0;
  let delta = 0;
  for (const line of lines) {
    const text = `<li class="flexrow"><label>${line.label}:</label><span>${signed(Number(line.value))}</span></li>`;
    const at = head.indexOf(text, cursor);
    if (at < 0) return html;
    if (!line.muted) {
      cursor = at + text.length;
      continue;
    }
    const muted = lineHTML(line, noteOf(line.reason));
    head = head.slice(0, at) + muted + head.slice(at + text.length);
    cursor = at + muted.length;
    delta -= Number(line.value);
  }
  const tail = html.slice(hr).replace(TOTAL, (_, open, total, close) => `${open}${signed(tidy(Number(total) + delta))}${close}`);
  return head + tail;
}
