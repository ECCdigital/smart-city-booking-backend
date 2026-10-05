const { rowOf, rowOfParts } = require("./findings");

/**
 * The rows of one check as the steps answer them, shared by the steps in
 * the order they run: a step writes its rows here and reads what the steps
 * before it found. A row is either one finding (`set`) or made of parts
 * that one or more steps add (`addParts`: row 2's `token` part comes before
 * row 4, its `authorize` part after); its status and reason follow from the
 * parts so far.
 */
class CheckResults {
  constructor() {
    /** @type {Map<number, Object>} */
    this._rows = new Map();
  }

  /**
   * Answers a row with one finding, replacing what it held.
   *
   * @param {number} id The row id
   * @param {Object} found The finding (`findings.js`)
   */
  set(id, found) {
    this._rows.set(id, rowOf(id, found));
  }

  /**
   * Adds parts to a row made of parts, opening it with its first parts.
   *
   * @param {number} id The row id
   * @param {Object[]} parts The parts (`partOf`), in the order to show
   */
  addParts(id, parts) {
    const before = this._rows.get(id)?.parts || [];
    this._rows.set(id, rowOfParts(id, [...before, ...parts]));
  }

  /**
   * The row as answered so far.
   *
   * @param {number} id The row id
   * @returns {Object|undefined} The row, `undefined` before any step
   *   answered it
   */
  get(id) {
    return this._rows.get(id);
  }

  /**
   * One part of a row, by its label.
   *
   * @param {number} id The row id
   * @param {string} label The part's label, e.g. `token`
   * @returns {Object|undefined} The part
   */
  part(id, label) {
    return this._rows.get(id)?.parts?.find((part) => part.label === label);
  }

  /**
   * The rows of the answer, ascending by id.
   *
   * @returns {Object[]} The rows
   */
  rows() {
    return [...this._rows.values()].sort((a, b) => a.id - b.id);
  }
}

module.exports = { CheckResults };
