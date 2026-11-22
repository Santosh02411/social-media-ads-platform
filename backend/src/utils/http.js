/** Parses ?limit=&offset= safely (NaN, negatives and huge values are clamped). */
export function getPagination(c, { defaultLimit = 50, maxLimit = 100 } = {}) {
  const rawLimit = parseInt(c.req.query('limit') ?? '', 10);
  const rawOffset = parseInt(c.req.query('offset') ?? '', 10);

  const limit = Number.isNaN(rawLimit) ? defaultLimit : Math.min(Math.max(rawLimit, 1), maxLimit);
  const offset = Number.isNaN(rawOffset) ? 0 : Math.max(rawOffset, 0);
  return { limit, offset };
}

/** Parses an integer query param within [min, max]. */
export function getBoundedInt(c, name, { fallback, min, max }) {
  const raw = parseInt(c.req.query(name) ?? '', 10);
  if (Number.isNaN(raw)) return fallback;
  return Math.min(Math.max(raw, min), max);
}
