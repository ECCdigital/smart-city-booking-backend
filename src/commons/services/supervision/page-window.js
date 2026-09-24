/**
 * The page of a paginated supervision list (history, active review queue,
 * tenant approval queue):
 * 1-based, 50 rows by default, at most 200. Whatever is no positive whole
 * number - absent, text, a fraction's rest, infinity - falls back, so a
 * query string never reaches a query or a response unchecked.
 */

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

const positiveInteger = (value, fallback) => {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number >= 1 ? number : fallback;
};

/**
 * @param {Object} params
 * @param {number|string} [params.page]
 * @param {number|string} [params.pageSize]
 * @returns {{page: number, pageSize: number, skip: number}}
 */
function pageWindow({ page, pageSize } = {}) {
  const safePage = positiveInteger(page, 1);
  const safePageSize = Math.min(
    MAX_PAGE_SIZE,
    positiveInteger(pageSize, DEFAULT_PAGE_SIZE),
  );
  return {
    page: safePage,
    pageSize: safePageSize,
    skip: (safePage - 1) * safePageSize,
  };
}

module.exports = { pageWindow, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE };
