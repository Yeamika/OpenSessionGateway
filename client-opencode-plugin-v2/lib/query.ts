export function createQuery(ctx: any) {
  return () => ({
    directory: ctx.directory,
  });
}
