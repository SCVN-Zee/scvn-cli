import { invokeForResult } from "@/lib/bridge";

export type ConfigSaveOwner = object;

export type ConfigSaveOutcome =
  | { kind: "saved"; value: unknown }
  | { kind: "superseded" };

type ConfigSaveWaiter = {
  resolve: (outcome: ConfigSaveOutcome) => void;
  reject: (error: unknown) => void;
};

type ConfigSaveRequest = {
  root: string;
  owner?: ConfigSaveOwner;
  waiters: ConfigSaveWaiter[];
};

type ConfigSaveListener = (root: string) => void;

let activeRequest: ConfigSaveRequest | null = null;
let queuedRequest: ConfigSaveRequest | null = null;
const listeners = new Set<ConfigSaveListener>();

function isSuccessfulResult(value: unknown): boolean {
  return typeof value === "object" && value !== null && "ok" in value && value.ok === true;
}

function settleRequest(request: ConfigSaveRequest, outcome: ConfigSaveOutcome): void {
  for (const waiter of request.waiters) waiter.resolve(outcome);
}

function notifySaved(root: string): void {
  for (const listener of [...listeners]) {
    try {
      listener(root);
    } catch {
      // A renderer listener must never interrupt the config queue.
    }
  }
}

async function drainQueue(): Promise<void> {
  if (activeRequest || !queuedRequest) return;
  const request = queuedRequest;
  queuedRequest = null;
  activeRequest = request;
  try {
    const value = await invokeForResult("config", { projectsRoot: request.root });
    if (isSuccessfulResult(value)) notifySaved(request.root);
    settleRequest(request, { kind: "saved", value });
  } catch (error: unknown) {
    for (const waiter of request.waiters) waiter.reject(error);
  } finally {
    activeRequest = null;
    if (queuedRequest) void drainQueue();
  }
}

/** Queue one config write, allowing only one host config command at a time. */
export function enqueueConfigSave(root: string, owner?: ConfigSaveOwner): Promise<ConfigSaveOutcome> {
  if (activeRequest?.root === root) {
    if (queuedRequest) {
      settleRequest(queuedRequest, { kind: "superseded" });
      queuedRequest = null;
    }
    return new Promise<ConfigSaveOutcome>((resolve, reject) => {
      activeRequest?.waiters.push({ resolve, reject });
    });
  }
  if (queuedRequest?.root === root) {
    return new Promise<ConfigSaveOutcome>((resolve, reject) => {
      queuedRequest?.waiters.push({ resolve, reject });
    });
  }
  if (queuedRequest) {
    settleRequest(queuedRequest, { kind: "superseded" });
    queuedRequest = null;
  }
  const promise = new Promise<ConfigSaveOutcome>((resolve, reject) => {
    queuedRequest = { root, owner, waiters: [{ resolve, reject }] };
  });
  void drainQueue();
  return promise;
}

/** Drop a queued intent from one surface; an active host write is untouched. */
export function cancelQueuedConfigSave(owner: ConfigSaveOwner): void {
  if (queuedRequest?.owner !== owner) return;
  const request = queuedRequest;
  queuedRequest = null;
  settleRequest(request, { kind: "superseded" });
}

/** Notify a mounted surface when another surface successfully changes config. */
export function subscribeConfigSaved(listener: ConfigSaveListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
