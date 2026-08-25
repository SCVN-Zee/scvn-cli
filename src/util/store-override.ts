/**
 * util/store-override.ts — Resolve the effective snapshot-store override.
 *
 * Precedence: the `--store` flag wins over the `SCVN_STORE_DIR` env var, which
 * wins over "no override" (callers then fall back to ~/.scvn/store for export
 * and the user→bundled resolution for import). An empty-string env counts as
 * unset so a stray `SCVN_STORE_DIR=` never redirects the store.
 */

export function resolveStoreOverride(
  flag?: string,
  env: string | undefined = process.env["SCVN_STORE_DIR"],
): string | undefined {
  if (flag) return flag;
  return env && env.length > 0 ? env : undefined;
}
