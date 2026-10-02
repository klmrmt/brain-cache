import { useEffect, useMemo, useRef, useState } from "react";
import { taskProgress } from "./taskProgress";
import type { Thought } from "./types";

export function useTaskProgress(thoughts: readonly Thought[]) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      const date = new Date();
      setNow(date);
      clearTimeout(timer);
      const midnight = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
      timer = setTimeout(refresh, midnight.getTime() - date.getTime() + 50);
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => { clearTimeout(timer); window.removeEventListener("focus", refresh); };
  }, []);
  // Use the current time on data changes too, so a freshly saved timestamp is never in the future.
  return useMemo(() => taskProgress(thoughts, new Date()), [thoughts, now]);
}

export type Progress = ReturnType<typeof taskProgress>;

export function TaskActivity({ progress, onClose }: { progress: Progress; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => { closeRef.current?.focus({ preventScroll: true }); }, []);
  return (
    <div
      className="thought-detail-layer thought-detail-layer--focus activity-layer"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
        if (event.key === "Tab") {
          event.preventDefault();
          (document.activeElement === closeRef.current ? bodyRef.current : closeRef.current)?.focus();
        }
      }}
    >
      <article className="task-activity" id="task-activity-panel" role="dialog" aria-modal="true" aria-labelledby="task-activity-title">
        <div className="task-activity__heading">
          <h2 id="task-activity-title">Activity</h2>
          <button ref={closeRef} type="button" aria-label="Close activity" title="Close activity" onClick={onClose}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </div>
        <div ref={bodyRef} className="task-activity__body" tabIndex={0} aria-label="Activity details">
          <ActivitySummary progress={progress} />
        </div>
      </article>
    </div>
  );
}

export function ActivitySummary({ progress }: { progress: Progress }) {
  const peak = Math.max(1, ...progress.days.map((day) => day.count));
  return <>
    <p className="eyebrow">Tasks completed</p>
    <dl className="task-activity__stats">
      {([
        ["Today", progress.today], ["Last 7 days", progress.week],
        ["Total", progress.total], ["Day streak", progress.streak],
      ] as const).map(([label, value]) => (
        <div key={label}><dt>{label}</dt><dd className={value > 0 ? "task-activity__value--saved" : undefined}>{value.toLocaleString()}</dd></div>
      ))}
    </dl>
    <div className="task-activity__details">
      <figure className="task-activity__week">
        <figcaption>Last 7 days</figcaption>
        <ol className="task-activity__chart">
          {progress.days.map((day) => (
            <li key={day.key} aria-label={`${day.date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}: ${day.count} ${day.count === 1 ? "task" : "tasks"} completed`}>
              <span className="task-activity__day-count" aria-hidden="true">{day.count}</span>
              <span className="task-activity__bar-track" aria-hidden="true"><span style={{ height: `${day.count / peak * 100}%` }} /></span>
              <span aria-hidden="true">{day.date.toLocaleDateString(undefined, { weekday: "short" })}</span>
            </li>
          ))}
        </ol>
      </figure>
      <div className="task-activity__milestone">
        <h3>{progress.total ? `${progress.total.toLocaleString()} ${progress.total === 1 ? "task" : "tasks"} completed. Keep going.` : "Your first finish starts here."}</h3>
        <p>Next milestone: {progress.nextMilestone.toLocaleString()} {progress.nextMilestone === 1 ? "task" : "tasks"}</p>
        <progress aria-label="Next task milestone" value={progress.total} max={progress.nextMilestone} />
        <p>{(progress.nextMilestone - progress.total).toLocaleString()} more to go</p>
        <p className="task-activity__streak-note">{progress.streak ? `A ${progress.streak}-day streak${progress.today ? ". Nice work." : ". Complete a task today to keep it going."}` : "One completed task starts a new streak."}</p>
      </div>
      <p className="task-activity__note">Across all your checklists, including archived cards. Unchecking reverses a completion; removing a finished item keeps its record. Days follow your Mac’s local time.</p>
      {progress.undated > 0 && <p className="task-activity__note">{progress.undated} earlier {progress.undated === 1 ? "completion is" : "completions are"} included in the total. Dates weren’t recorded, so they don’t appear in daily activity.</p>}
    </div>
  </>;
}

export function TaskCompletionFeedback({ progress, ready }: { progress: Progress; ready: boolean }) {
  const previous = useRef<Progress | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!ready) return;
    const before = previous.current;
    previous.current = progress;
    if (!before || progress.total <= before.total) {
      if (before && progress.total < before.total) setMessage("");
      return;
    }
    const gained = progress.total - before.total;
    setMessage(progress.milestone > before.milestone
      ? `${progress.milestone.toLocaleString()} ${progress.milestone === 1 ? "task" : "tasks"} completed. Milestone reached!`
      : `+${gained} ${gained === 1 ? "task" : "tasks"} completed. ${progress.today} today. Nice work.`);
  }, [progress, ready]);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(""), 3600);
    return () => clearTimeout(timer);
  }, [message]);
  return <div className={`task-completion-feedback${message ? " task-completion-feedback--visible" : ""}`} role="status" aria-live="polite" aria-atomic="true">{message && <><span aria-hidden="true">✓</span> {message}</>}</div>;
}
