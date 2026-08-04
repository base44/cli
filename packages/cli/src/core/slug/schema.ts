import { z } from "zod";

/**
 * App document returned by GET api/apps/{id} and PATCH metadata/slug.
 * Only the slug is consumed; every other field is dropped.
 */
export const AppSlugResponseSchema = z
  .object({ slug: z.string().nullable().optional() })
  .transform((data) => ({ slug: data.slug ?? null }));

export type AppSlug = z.infer<typeof AppSlugResponseSchema>;

// ─── REQUESTS ────────────────────────────────────────────────

/** Request payload for PATCH metadata/slug. Null resets to auto-generated. */
export interface UpdateSlugRequest {
  slug: string | null;
}

// ─── ERRORS ──────────────────────────────────────────────────

/** 400 "slug already in use" bodies carry alternative slug suggestions. */
export const SlugSuggestionsSchema = z.object({
  suggestions: z.array(z.string()),
});
