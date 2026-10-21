import type { ReactNode } from "react";

// THE APP'S NOTIFICATION API. Call `toast` from anywhere (components, hooks,
// mutation callbacks) to show a short notice; components/Toaster renders it.
// The Toaster is already mounted once in components/_globalContextProviders,
// so never render it again and never install another toast library.
//
//   import { toast } from "../helpers/toast";
//
//   toast("Marked as unread");
//   toast.success("Saved");
//   toast.error("Couldn't send message", { action: { label: "Retry", onClick: retry } });
//   toast("Task deleted", { action: { label: "Undo", onClick: undo } });
//   toast.success("Invite sent", { description: "jane@example.com" });
//   const id = toast.loading("Uploading…");  ...  toast.success("Uploaded", { id });
//   toast.promise(save(), { loading: "Saving…", success: "Saved", error: "Couldn't save" });
//   toast.dismiss(id);   // or toast.dismiss() for all
//
// The call shape is sonner's, so code written for `import { toast } from
// "sonner"` works by changing only the import. Keep the text short: a notice
// is one line (plus an optional one-line description) and is truncated past
// that. One action at most. Feedback that belongs to a thing on screen (a
// field error, a failed message) goes on that thing, not in a toast.
//
// Notices stack, newest in front with up to two older ones peeking out below;
// tapping or hovering the stack fans it out. Each notice has its own timer
// (3.5 s, 6 s for errors and notices with an action, never for `loading` or
// duration: Infinity), and nothing expires while the stack is hovered or
// fanned out. Re-using an id replaces that notice in place.

export type ToastTone = "default" | "success" | "error" | "warning" | "info" | "loading";
export type ToastId = string | number;

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  /** Re-use an id to replace that notice in place (e.g. loading → success). */
  id?: ToastId;
  /** One short line under the title. */
  description?: ReactNode;
  /** Milliseconds; Infinity keeps it until dismissed. */
  duration?: number;
  /** One action button, e.g. Undo or Retry. Clicking it also dismisses the notice. */
  action?: ToastAction;
  /** Replaces the tone's icon. */
  icon?: ReactNode;
}

export interface ToastItem {
  id: ToastId;
  tone: ToastTone;
  title: ReactNode;
  description?: ReactNode;
  action?: ToastAction;
  icon?: ReactNode;
  duration: number;
  /** Bumped on every show/replace so the Toaster re-plays its entrance. */
  version: number;
}

type PromiseMessage<T> = ReactNode | ((value: T) => ReactNode);

export interface ToastPromiseMessages<T> {
  loading: ReactNode;
  success: PromiseMessage<T>;
  error: PromiseMessage<unknown>;
  description?: ReactNode;
}

type Timer = { handle: ReturnType<typeof setTimeout> | null; startedAt: number; remaining: number };

let items: ToastItem[] = [];
const listeners = new Set<() => void>();
const timers = new Map<ToastId, Timer>();
let counter = 0;
let versionCounter = 0;

const emit = () => {
  items = [...items];
  listeners.forEach((l) => l());
};

const defaultDuration = (tone: ToastTone, hasAction: boolean) => {
  if (tone === "loading") return Infinity;
  if (tone === "error" || hasAction) return 6000;
  return 3500;
};

const clearTimer = (id: ToastId) => {
  const t = timers.get(id);
  if (t?.handle) clearTimeout(t.handle);
  timers.delete(id);
};

const startTimer = (id: ToastId, ms: number) => {
  clearTimer(id);
  if (!Number.isFinite(ms)) return;
  timers.set(id, {
    handle: setTimeout(() => dismiss(id), ms),
    startedAt: Date.now(),
    remaining: ms,
  });
};

function dismiss(id?: ToastId) {
  if (id === undefined) {
    timers.forEach((_, key) => clearTimer(key));
    items = [];
    emit();
    return;
  }
  clearTimer(id);
  const next = items.filter((i) => i.id !== id);
  if (next.length === items.length) return;
  items = next;
  emit();
}

const show = (tone: ToastTone, title: ReactNode, opts: ToastOptions = {}): ToastId => {
  const id = opts.id ?? `toast-${++counter}`;
  const duration = opts.duration ?? defaultDuration(tone, !!opts.action);
  const item: ToastItem = {
    id,
    tone,
    title,
    description: opts.description,
    action: opts.action,
    icon: opts.icon,
    duration,
    version: ++versionCounter,
  };
  items = [...items.filter((i) => i.id !== id), item];
  startTimer(id, duration);
  emit();
  return id;
};

const resolveMessage = <T,>(message: PromiseMessage<T>, value: T): ReactNode =>
  typeof message === "function" ? (message as (v: T) => ReactNode)(value) : message;

/** Shows `loading` until the promise settles, then turns into success or error. Returns the promise. */
function promise<T>(work: Promise<T> | (() => Promise<T>), messages: ToastPromiseMessages<T>, opts: ToastOptions = {}): Promise<T> {
  const id = show("loading", messages.loading, { ...opts, description: messages.description ?? opts.description });
  const running = typeof work === "function" ? work() : work;
  running.then(
    (value) => {
      show("success", resolveMessage(messages.success, value), { ...opts, id, duration: opts.duration });
    },
    (error: unknown) => {
      show("error", resolveMessage(messages.error, error), { ...opts, id, duration: opts.duration });
    },
  );
  return running;
}

// Hover / press holds a notice, so an Undo isn't snatched away mid-reach.
// Resume gives back what was left, with a short floor.
const pause = (id: ToastId) => {
  const t = timers.get(id);
  if (!t?.handle) return;
  clearTimeout(t.handle);
  t.handle = null;
  t.remaining = Math.max(0, t.remaining - (Date.now() - t.startedAt));
};

const resume = (id: ToastId) => {
  const t = timers.get(id);
  if (!t || t.handle) return;
  startTimer(id, Math.max(t.remaining, 1200));
};

// While the stack is fanned out or hovered, nothing in it may expire under the
// reader.
const pauseAll = () => items.forEach((i) => pause(i.id));
const resumeAll = () => items.forEach((i) => resume(i.id));

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = () => items;

export const toast = Object.assign(
  (title: ReactNode, opts?: ToastOptions) => show("default", title, opts),
  {
    success: (title: ReactNode, opts?: ToastOptions) => show("success", title, opts),
    error: (title: ReactNode, opts?: ToastOptions) => show("error", title, opts),
    warning: (title: ReactNode, opts?: ToastOptions) => show("warning", title, opts),
    info: (title: ReactNode, opts?: ToastOptions) => show("info", title, opts),
    message: (title: ReactNode, opts?: ToastOptions) => show("default", title, opts),
    loading: (title: ReactNode, opts?: ToastOptions) => show("loading", title, opts),
    promise,
    dismiss,
    /** Internal: used by components/Toaster only. */
    _store: { subscribe, getSnapshot, pause, resume, pauseAll, resumeAll },
  }
);

