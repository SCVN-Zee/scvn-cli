/**
 * features/init/index.ts — Safe Assets-relative directory scaffolding shared by CLI and desktop.
 */

import path from "node:path";
import { mkdir } from "node:fs/promises";
import { exists as realExists, isDir as realIsDir, isFile as realIsFile } from "../../util/fs-predicates.js";
import { isSafeRelPath } from "../../lib/rel-path-safety.js";

export interface InitLayout {
  readonly directories: readonly string[];
}

const DEFAULT_PROJECT_DIRECTORIES = [
  "Animation/AnimationClips",
  "Animation/AnimatorControllers",
  "Audio/SFXs",
  "Audio/BGMs",
  "Configs",
  "Models",
  "Fonts",
  "Materials",
  "Prefabs",
  "Scenes",
  "Scripts",
  "Shaders",
  "Sprites",
  "Textures",
] as const;

export interface InitRequest {
  targetAssets: string;
  layout?: InitLayout;
}

export interface InitPlanEntry {
  path: string;
  status: "create" | "existing";
}

export interface InitPlan {
  targetAssets: string;
  hierarchyRoot: string;
  entries: InitPlanEntry[];
}

export interface InitResultEntry {
  path: string;
  status: "created" | "existing" | "planned";
}

export interface InitResult {
  dryRun: boolean;
  targetAssets: string;
  hierarchyRoot: string;
  entries: InitResultEntry[];
}

export interface InitFsDeps {
  exists?: (value: string) => Promise<boolean>;
  isDir?: (value: string) => Promise<boolean>;
  isFile?: (value: string) => Promise<boolean>;
  mkdir?: (value: string) => Promise<void>;
}

const realFs: Required<InitFsDeps> = {
  exists: realExists,
  isDir: realIsDir,
  isFile: realIsFile,
  mkdir: async (value) => {
    await mkdir(value, { recursive: true });
  },
};

export class InitValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InitValidationError";
  }
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new InitValidationError("Layout must be an object");
  }
  return value as Record<string, unknown>;
}

function hasControlCharacter(value: string): boolean {
  return /[\u0000-\u001f\u007f]/u.test(value);
}

function normalizeRelative(value: string, label: string): string {
  if (!value || hasControlCharacter(value) || path.isAbsolute(value) || /^[A-Za-z]:[\\/]/u.test(value)) {
    throw new InitValidationError(`${label} must be a relative path`);
  }
  if (!isSafeRelPath(value)) {
    throw new InitValidationError(`${label} must not contain '..' path segments`);
  }
  const segments = value.split(/[\\/]/u);
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new InitValidationError(`${label} contains an empty or unsafe path segment`);
  }
  return segments.join("/");
}

function validateProjectName(value: string): string {
  const name = value.trim();
  if (!name || hasControlCharacter(name) || name === "." || name === ".." || /[\\/]/u.test(name)) {
    throw new InitValidationError("Project name must be one safe path segment");
  }
  return name;
}

export function createDefaultInitLayout(projectName: string): InitLayout {
  const name = validateProjectName(projectName);
  const projectPath = `Supercent/${name}`;
  return {
    directories: [
      "Supercent",
      projectPath,
      ...DEFAULT_PROJECT_DIRECTORIES.map((directory) => `${projectPath}/${directory}`),
    ],
  };
}

export const DEFAULT_INIT_LAYOUT: Readonly<InitLayout> = Object.freeze({
  directories: Object.freeze([...createDefaultInitLayout("ProjectName").directories]),
});

export function parseInitLayout(value: unknown): InitLayout {
  const input = record(value);
  if ("root" in input) {
    throw new InitValidationError("Layout root is no longer supported; directories must be Assets-relative paths");
  }
  if (!Array.isArray(input.directories) || input.directories.some((item) => typeof item !== "string")) {
    throw new InitValidationError("Layout directories must be an array of strings");
  }
  const directories = input.directories.map((item, index) => normalizeRelative(item, `Layout directory ${index + 1}`));
  const seen = new Set<string>();
  for (const directory of directories) {
    if (seen.has(directory)) throw new InitValidationError(`Duplicate layout directory: ${directory}`);
    seen.add(directory);
  }
  return { directories };
}

function mergeDeps(deps: InitFsDeps): Required<InitFsDeps> {
  return { ...realFs, ...deps };
}

function ancestors(base: string, directory: string): string[] {
  const result: string[] = [];
  const segments = directory.split("/");
  for (let index = 1; index <= segments.length; index++) {
    result.push(path.join(base, ...segments.slice(0, index)));
  }
  return result;
}

async function resolveAssetsTarget(target: string, fs: Required<InitFsDeps>): Promise<string> {
  const candidate = target.trim();
  if (!candidate || !(await fs.isDir(candidate))) {
    throw new InitValidationError(`${candidate || "Target"} is not an existing Unity project or Assets directory`);
  }
  if (
    path.basename(candidate) === "Assets" &&
    await fs.isFile(path.join(path.dirname(candidate), "ProjectSettings", "ProjectVersion.txt"))
  ) {
    return candidate;
  }
  const assets = path.join(candidate, "Assets");
  if (
    await fs.isFile(path.join(candidate, "ProjectSettings", "ProjectVersion.txt")) &&
    await fs.isDir(assets)
  ) {
    return assets;
  }
  throw new InitValidationError(`${candidate} is not a Unity project or its Assets directory`);
}

/** Build and validate the complete operation plan without mutating the filesystem. */
export async function prepareInit(request: InitRequest, deps: InitFsDeps = {}): Promise<InitPlan> {
  const fs = mergeDeps(deps);
  const targetAssets = await resolveAssetsTarget(request.targetAssets, fs);

  const layout = parseInitLayout(request.layout ?? DEFAULT_INIT_LAYOUT);
  const pathsToCheck = new Set<string>();
  for (const directory of layout.directories) {
    for (const candidate of ancestors(targetAssets, directory)) pathsToCheck.add(candidate);
  }
  for (const candidate of pathsToCheck) {
    if (await fs.isFile(candidate)) {
      throw new InitValidationError(`Cannot create directory because a file exists at ${candidate}`);
    }
    if (await fs.exists(candidate) && !(await fs.isDir(candidate))) {
      throw new InitValidationError(`Cannot create directory because a non-directory exists at ${candidate}`);
    }
  }

  return {
    targetAssets,
    hierarchyRoot: targetAssets,
    entries: layout.directories.map((directory) => ({
      path: path.join(targetAssets, ...directory.split("/")),
      status: "existing" as const,
    })),
  };
}

/** Create the validated layout, or return the same plan as a non-mutating dry-run. */
export async function initializeProject(
  request: InitRequest,
  options: { dryRun?: boolean; fs?: InitFsDeps } = {},
): Promise<InitResult> {
  const plan = await prepareInit(request, options.fs);
  if (options.dryRun) {
    return {
      dryRun: true,
      targetAssets: plan.targetAssets,
      hierarchyRoot: plan.hierarchyRoot,
      entries: plan.entries.map((entry) => ({ ...entry, status: "planned" as const })),
    };
  }

  const fs = mergeDeps(options.fs ?? {});
  const entries: InitResultEntry[] = [];
  for (const entry of plan.entries) {
    const wasDirectory = await fs.isDir(entry.path);
    await fs.mkdir(entry.path);
    entries.push({ path: entry.path, status: wasDirectory ? "existing" : "created" });
  }
  return { dryRun: false, targetAssets: plan.targetAssets, hierarchyRoot: plan.hierarchyRoot, entries };
}
