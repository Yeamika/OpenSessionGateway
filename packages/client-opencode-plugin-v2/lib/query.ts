export function createQuery(ctx: any) {
  return () => ({
    directory: ctx.directory,
    displayID: typeof ctx?.displayID === "string" && ctx.displayID.trim() ? ctx.displayID.trim() : undefined,
  });
}
