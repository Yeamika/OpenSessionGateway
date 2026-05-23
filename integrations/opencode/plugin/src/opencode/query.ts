/**
 * Query factory — creates query function for opencode context.
 *
 * Migrated from client-opencode-plugin-v2/lib/query.ts
 */

export type QueryFactory = () => Record<string, unknown>

export function createQuery(ctx: any): QueryFactory {
  return () => ({
    directory: ctx.directory,
    displayID: typeof ctx?.displayID === "string" && ctx.displayID.trim() ? ctx.displayID.trim() : undefined,
  })
}
