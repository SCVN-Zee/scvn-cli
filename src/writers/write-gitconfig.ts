/**
 * writers/write-gitconfig.ts — Write global git config for Unity smart merge driver.
 *
 * Sets merge.unityyamlmerge and mergetool.unityyamlmerge sections globally.
 * Inserts --nomappinginoneline for Unity 6+ (changed CLI interface).
 *
 * Ported from fork-unity-setup/src/writers/write-gitconfig.ts.
 * Import path updated to scvn lib/unity-version.
 */

import { execa } from "execa";
import { isUnity6OrNewer, parseUnityVersion } from "../lib/unity-version.js";

export interface GitConfigInput {
  yamlMergePath: string;
  unityVersion: string;
}

export interface GitConfigResult {
  driverSet: boolean;
  mergetoolSet: boolean;
  driverCommand: string;
  mergetoolCommand: string;
}

export function buildDriverArgs(unityVersion: string): string[] {
  const parsed = parseUnityVersion(unityVersion);
  const headFlags = ["merge", "-p"];
  const noMappingFlag = isUnity6OrNewer(parsed) ? ["--nomappinginoneline"] : [];
  const tailFlags = ["--force", "--fallback", "none", "%O", "%B", "%A", "%P"];
  return [...headFlags, ...noMappingFlag, ...tailFlags];
}

// Git runs `driver` / `cmd` via `/bin/sh -c` — single-quote the path so any
// `$`, `"`, or space in the Unity install path survives unparsed.
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export async function writeGitConfig(
  input: GitConfigInput,
): Promise<GitConfigResult> {
  const driverArgs = buildDriverArgs(input.unityVersion);
  const quotedPath = shellQuote(input.yamlMergePath);
  const driverCommand = `${quotedPath} ${driverArgs.join(" ")}`;
  const mergetoolCommand = `${quotedPath} merge -p "$BASE" "$REMOTE" "$LOCAL" "$MERGED"`;

  const set = async (key: string, value: string) => {
    await execa("git", ["config", "--global", key, value]);
  };

  await set("merge.unityyamlmerge.name", "Unity Smart Merge");
  await set("merge.unityyamlmerge.driver", driverCommand);
  await set("merge.unityyamlmerge.recursive", "binary");
  await set("mergetool.unityyamlmerge.trustExitCode", "false");
  await set("mergetool.unityyamlmerge.cmd", mergetoolCommand);

  return {
    driverSet: true,
    mergetoolSet: true,
    driverCommand,
    mergetoolCommand,
  };
}
