/** Formats zod issues into a small, client-friendly list. */
export const formatIssues = (error) =>
  error.issues.map((issue) => ({
    field: issue.path.join('.') || undefined,
    message: issue.message,
  }));

/** Validates raw data against a schema: { data } on success, { response } on failure. */
export function parseWith(c, schema, raw) {
  const result = schema.safeParse(raw);
  if (result.success) return { data: result.data };
  return {
    response: c.json({ error: 'Validation failed', details: formatIssues(result.error) }, 400),
  };
}

/** Reads the JSON body, validates it, and exposes the clean result as c.get('body'). */
export const validateJson = (schema) => async (c, next) => {
  let raw;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: 'Request body must be valid JSON' }, 400);
  }

  const { data, response } = parseWith(c, schema, raw);
  if (response) return response;

  c.set('body', data);
  await next();
};
