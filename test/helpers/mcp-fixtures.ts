/**
 * test/helpers/mcp-fixtures.ts — Fixture trees for the MCP transform + install specs.
 *
 * `makeCoreFixture` reproduces the bash original's `make_core_fixture`
 * (unity-mcp-localize.sh:1069) verbatim, because the transform assertions are
 * only meaningful against the exact upstream source shapes — in particular the
 * commented-out `//AssetsPathPrefix + relativePath` line, whose uncommented form
 * is a substring of itself.
 */

import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

/** Upstream `EditorAssetLoader.cs`, pre-relocation-shim. */
export const EDITOR_ASSET_LOADER_CS = `    public static class EditorAssetLoader
    {
        private const string PackagePathPrefix = "Packages/com.ivanmurzak.unity.mcp/";
        private const string AssetsPathPrefix = "Packages/com.ivanmurzak.unity.mcp/";
        public static string[] GetEditorAssetPaths(string relativePath)
        {
            return new[]
            {
                PackagePathPrefix + relativePath//,
                //AssetsPathPrefix + relativePath
            };
        }
    }
`;

/** Upstream `RecompileGate.cs`, pre-WebGL-shim (carries the Unknown-guard anchor). */
export const RECOMPILE_GATE_CS = `        static List<string> ForEachTarget(Func<NamedBuildTarget, bool> modify)
        {
            var changed = new List<string>();
            foreach (BuildTargetGroup group in Enum.GetValues(typeof(BuildTargetGroup)))
            {
                if (group == BuildTargetGroup.Unknown)
                    continue;
                if (modify(NamedBuildTarget.FromBuildTargetGroup(group)))
                    changed.Add(group.ToString());
            }
            return changed;
        }
`;

export const EDITOR_ASSET_LOADER_REL = "Editor/Scripts/Utils/EditorAssetLoader.cs";
export const RECOMPILE_GATE_REL = "Editor/DependencyResolver/RecompileGate.cs";

async function writeAt(dir: string, rel: string, content: string): Promise<void> {
  const abs = path.join(dir, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content, "utf8");
}

/**
 * A core-package tree: both shim targets, the two test dirs prune removes, and a
 * Runtime file it must keep.
 */
export async function makeCoreFixture(pkgDir: string): Promise<void> {
  await writeAt(pkgDir, EDITOR_ASSET_LOADER_REL, EDITOR_ASSET_LOADER_CS);
  await writeAt(pkgDir, RECOMPILE_GATE_REL, RECOMPILE_GATE_CS);
  await writeAt(pkgDir, "Tests/Foo.cs", "// tests\n");
  await writeAt(pkgDir, "Tests.meta", "meta\n");
  await writeAt(pkgDir, "TestFiles/Bar.cs", "// testfiles\n");
  await writeAt(pkgDir, "TestFiles.meta", "meta\n");
  await writeAt(pkgDir, "Runtime/Keep.cs", "// runtime\n");
  await writeAt(pkgDir, "package.json", '{"name":"com.ivanmurzak.unity.mcp","version":"1.0.0"}\n');
}

/** An addon-package tree: prunable dirs, no shim targets. */
export async function makeAddonFixture(pkgDir: string): Promise<void> {
  await writeAt(pkgDir, "Editor/Addon.cs", "// addon\n");
  await writeAt(pkgDir, "Tests/Foo.cs", "// tests\n");
  await writeAt(pkgDir, "Tests.meta", "meta\n");
  await writeAt(pkgDir, "Runtime/Keep.cs", "// runtime\n");
}
