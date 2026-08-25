import React, { useEffect, useRef, useState } from "react";
import { FolderOpen, LoaderCircle, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { invokeForResult, pickDirectory } from "@/lib/bridge";
import type { CapabilitySpec, FormModel, LaunchField, LaunchValues } from "@shared/commands";

export interface CapabilityFormProps {
  spec: CapabilitySpec;
  onRun: (capabilityId: string, values: LaunchValues) => void;
}

type LoadState =
  | { status: "loading" }
  | { status: "ready" }
  | { status: "error"; message: string };

/**
 * A discovered Unity project, as returned by the `projects:discover` command.
 * Structured parts (not one glued string) so the picker can lay the project
 * name, branch, and last-edit age out as distinct columns.
 */
interface DiscoveredProject {
  value: string;
  name: string;
  scene?: string;
  branch?: string;
  age?: string;
  mismatch?: string;
}

function initialValues(fields: LaunchField[]): LaunchValues {
  const next: LaunchValues = {};
  for (const field of fields) {
    switch (field.type) {
      case "boolean":
        next[field.name] = field.default === true;
        break;
      case "text":
      case "project":
        next[field.name] = field.default ?? "";
        break;
      case "select":
        next[field.name] = field.default ?? field.options[0]?.value;
        break;
      case "multiselect":
        next[field.name] = field.default ? [...field.default] : [];
        break;
      default: {
        const _never: never = field;
        void _never;
      }
    }
  }
  return next;
}

function fieldDomId(name: string): string {
  return `launch-${name}`;
}

export function CapabilityForm(props: CapabilityFormProps): React.JSX.Element {
  const { spec, onRun } = props;
  const activeIdRef = useRef(spec.id);
  activeIdRef.current = spec.id;

  const [fields, setFields] = useState<LaunchField[]>(() =>
    spec.form === true ? [] : spec.launch,
  );
  const [note, setNote] = useState<string | undefined>(undefined);
  const [blocker, setBlocker] = useState<string | undefined>(undefined);
  const [values, setValues] = useState<LaunchValues>(() =>
    spec.form === true ? {} : initialValues(spec.launch),
  );
  const [loadState, setLoadState] = useState<LoadState>(() =>
    spec.form === true ? { status: "loading" } : { status: "ready" },
  );

  useEffect(() => {
    if (spec.form !== true) {
      setFields(spec.launch);
      setNote(undefined);
      setBlocker(undefined);
      setValues(initialValues(spec.launch));
      setLoadState({ status: "ready" });
      return;
    }

    const requestedId = spec.id;
    const requestedLabel = spec.label;
    let cancelled = false;
    setLoadState({ status: "loading" });
    setNote(undefined);
    setBlocker(undefined);

    void invokeForResult(`${requestedId}:prepare`)
      .then((raw) => {
        if (cancelled || requestedId !== activeIdRef.current) return;
        const model = raw as FormModel;
        setFields(model.fields);
        setNote(model.note);
        setBlocker(model.blocker);
        setValues(initialValues(model.fields));
        setLoadState({ status: "ready" });
      })
      .catch((err: unknown) => {
        if (cancelled || requestedId !== activeIdRef.current) return;
        const detail = err instanceof Error ? err.message : String(err);
        setLoadState({
          status: "error",
          message: `Failed to prepare ${requestedLabel}: ${detail}`,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [spec.id, spec.form, spec.launch, spec.label]);

  const visibleFields = fields.filter(
    (field) => !field.visibleWhen || values[field.visibleWhen.field] === field.visibleWhen.equals,
  );

  const run = (): void => {
    if (blocker !== undefined) return;
    // Submit only the visible fields — a hidden field (e.g. add-ons when the
    // verb isn't "install") must not leak its value into the handler.
    const submit: LaunchValues = {};
    for (const field of visibleFields) submit[field.name] = values[field.name];
    onRun(spec.id, submit);
  };

  const setFieldValue = (name: string, value: string | boolean | string[]): void => {
    setValues((prev) => ({ ...prev, [name]: value }));
  };

  return (
    <div className="mx-auto w-full max-w-[640px] p-6">
      {loadState.status === "loading" ? (
        <div className="flex flex-col items-center justify-center gap-2 py-16">
          <LoaderCircle className="size-4 animate-spin" />
          <p className="text-sm text-muted-foreground" role="status">
            Preparing…
          </p>
        </div>
      ) : loadState.status === "error" ? (
        <p className="text-destructive">{loadState.message}</p>
      ) : (
        <Card className="w-full">
          <CardHeader>
            <CardTitle>{spec.label}</CardTitle>
            <CardDescription>{spec.description}</CardDescription>
          </CardHeader>
          {note ? <p className="px-6 text-sm text-muted-foreground">{note}</p> : null}
          <CardContent>
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                run();
              }}
            >
              {visibleFields.map((field) => (
                <LaunchFieldControl
                  key={field.name}
                  field={field}
                  value={values[field.name]}
                  onChange={(value) => setFieldValue(field.name, value)}
                />
              ))}
              <Button type="button" disabled={blocker !== undefined} onClick={run}>
                {spec.form === true ? "Apply" : "Run"}
              </Button>
              {blocker !== undefined ? (
                <p className="text-sm text-destructive" role="alert">
                  {blocker}
                </p>
              ) : null}
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function LaunchFieldControl(props: {
  field: LaunchField;
  value: string | boolean | string[] | undefined;
  onChange: (value: string | boolean | string[]) => void;
}): React.JSX.Element {
  const { field, value, onChange } = props;
  const id = fieldDomId(field.name);

  switch (field.type) {
    case "boolean": {
      return (
        <div className="flex items-center justify-between rounded-lg border bg-card px-3 py-2.5">
          <Label htmlFor={id}>{field.label}</Label>
          <Switch id={id} checked={value === true} onCheckedChange={(next) => onChange(next)} />
        </div>
      );
    }
    case "text": {
      const textValue = typeof value === "string" ? value : "";
      const kind = field.kind;
      return (
        <div className="space-y-2">
          <Label htmlFor={id}>{field.label}</Label>
          <div className="flex gap-2">
            <Input
              id={id}
              className="flex-1"
              value={textValue}
              placeholder={field.placeholder}
              onChange={(event) => onChange(event.target.value)}
            />
            {kind === "dir" || kind === "path" ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  void pickDirectory({ kind, title: field.label }).then((picked) => {
                    if (picked !== null) onChange(picked);
                  });
                }}
              >
                <FolderOpen />
                Browse…
              </Button>
            ) : null}
          </div>
        </div>
      );
    }
    case "select": {
      const selected =
        typeof value === "string" ? value : (field.default ?? field.options[0]?.value ?? "");
      return (
        <div className="space-y-2">
          <Label htmlFor={id}>{field.label}</Label>
          <Select value={selected} onValueChange={(next) => onChange(next)}>
            <SelectTrigger id={id} className="w-full">
              <SelectValue placeholder="Select…" />
            </SelectTrigger>
            <SelectContent>
              {field.options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      );
    }
    case "multiselect": {
      const selected = Array.isArray(value) ? value : [];
      return (
        <div className="space-y-2">
          <Label>{field.label}</Label>
          <div role="group" aria-label={field.label} className="space-y-0.5 rounded-lg border bg-card p-2">
            {field.options.map((option) => {
              const optionId = `${id}-${option.value}`;
              const checked = selected.includes(option.value);
              return (
                <Label
                  key={option.value}
                  htmlFor={optionId}
                  className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 font-normal hover:bg-accent"
                >
                  <Checkbox
                    id={optionId}
                    checked={checked}
                    onCheckedChange={(next) =>
                      onChange(
                        next
                          ? [...selected, option.value]
                          : selected.filter((v) => v !== option.value),
                      )
                    }
                  />
                  <span>{option.label}</span>
                </Label>
              );
            })}
          </div>
        </div>
      );
    }
    case "project": {
      const pathValue = typeof value === "string" ? value : "";
      return <ProjectControl id={id} label={field.label} value={pathValue} onChange={onChange} />;
    }
    default: {
      const _never: never = field;
      return _never;
    }
  }
}

/**
 * One project row in the picker: the name (with its variant scene) on the left,
 * the git branch as a monospace chip, a version-mismatch warning, and the
 * last-edit age pinned right — the three facts the user picks by, kept visually
 * distinct instead of run together in one line. Renders inside the Radix
 * `ItemText`, so the collapsed trigger mirrors the same layout for the choice.
 */
function ProjectOptionRow({ project }: { project: DiscoveredProject }): React.JSX.Element {
  return (
    <span className="flex w-full items-center gap-2">
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium text-foreground">{project.name}</span>
        {project.scene ? <span className="ml-1 text-muted-foreground">({project.scene})</span> : null}
      </span>
      {project.branch ? (
        <span className="max-w-[45%] shrink-0 truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
          {project.branch}
        </span>
      ) : null}
      {project.mismatch ? (
        <span title={project.mismatch} className="shrink-0 text-amber-500">
          <TriangleAlert className="size-3.5" />
        </span>
      ) : null}
      {project.age ? (
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{project.age}</span>
      ) : null}
    </span>
  );
}

/**
 * A discovered-project dropdown with a Browse fallback. Fetches the projects
 * under the configured root on mount; a path chosen via Browse (or a prefilled
 * default) that isn't in the discovered list is added as its own option so it
 * still shows as selected.
 */
export function ProjectControl(props: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}): React.JSX.Element {
  const { id, label, value, onChange } = props;
  const [projects, setProjects] = useState<DiscoveredProject[] | null>(null);
  const [root, setRoot] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void invokeForResult("projects:discover")
      .then((raw) => {
        if (cancelled) return;
        const model = raw as { root: string; projects: DiscoveredProject[] };
        setRoot(model.root);
        setProjects(model.projects);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const known = projects ?? [];
  const options: DiscoveredProject[] =
    value && !known.some((p) => p.value === value) ? [{ value, name: value }, ...known] : known;
  const selected = options.find((p) => p.value === value);
  const placeholder =
    projects === null ? "Loading projects…" : options.length > 0 ? "Select a project" : "No projects found — Browse…";

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Select value={value || undefined} onValueChange={onChange}>
          <SelectTrigger id={id} className="flex-1" aria-label={selected ? selected.name : placeholder}>
            {selected ? (
              <ProjectOptionRow project={selected} />
            ) : (
              <span className="text-muted-foreground">{placeholder}</span>
            )}
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value} textValue={option.name}>
                <ProjectOptionRow project={option} />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            void pickDirectory({ kind: "dir", title: label }).then((picked) => {
              if (picked !== null) onChange(picked);
            });
          }}
        >
          <FolderOpen />
          Browse…
        </Button>
      </div>
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : root ? (
        <p className="text-xs text-muted-foreground">Projects under {root}</p>
      ) : null}
    </div>
  );
}
