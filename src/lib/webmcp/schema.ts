import type { JsonSchema } from './types.ts';

export type ValidationResult =
  | { ok: true; value: Record<string, string> }
  | { ok: false; error: string };

/**
 * Validates tool input against the small JSON Schema subset the tools use
 * (an object of strings with `required`, `enum`, `minLength`, `maxLength`).
 * Agents send whatever they like, so every tool validates before it acts.
 */
export function validateInput(
  schema: JsonSchema,
  input: unknown
): ValidationResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    return { ok: false, error: 'Input must be an object.' };
  const record = input as Record<string, unknown>;
  const value: Record<string, string> = {};
  for (const key of Object.keys(record)) {
    if (!(key in schema.properties))
      return { ok: false, error: `Unknown property "${key}".` };
  }
  for (const key of schema.required ?? []) {
    if (record[key] === undefined)
      return { ok: false, error: `"${key}" is required.` };
  }
  for (const [key, rule] of Object.entries(schema.properties)) {
    const field = record[key];
    if (field === undefined) continue;
    if (typeof field !== 'string')
      return { ok: false, error: `"${key}" must be a string.` };
    if (rule.minLength !== undefined && field.length < rule.minLength)
      return { ok: false, error: `"${key}" is too short.` };
    if (rule.maxLength !== undefined && field.length > rule.maxLength)
      return {
        ok: false,
        error: `"${key}" is too long (at most ${rule.maxLength} characters).`,
      };
    if (rule.enum && !rule.enum.includes(field))
      return {
        ok: false,
        error: `"${key}" must be one of: ${rule.enum.join(', ')}.`,
      };
    value[key] = field;
  }
  return { ok: true, value };
}
