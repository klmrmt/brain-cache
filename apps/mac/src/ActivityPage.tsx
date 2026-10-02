import { useEffect, useRef, useState } from "react";
import { ActivitySummary, type Progress } from "./TaskActivity";
import { ActivityGarden } from "./ActivityGarden";

export function ActivityPage({ progress, returnLabel, onBack, onCapture, error, onRetry }: {
  progress: Progress;
  returnLabel: string;
  onBack: () => void;
  onCapture: () => void;
  error: string | null;
  onRetry: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [moreActivity, setMoreActivity] = useState(false);
  const visibleCompletions = moreActivity ? progress.todayCompletions : progress.todayCompletions.slice(0, 3);
  useEffect(() => { headingRef.current?.focus({ preventScroll: true }); }, []);

  return (
    <section className="thoughts-pane activity-page" aria-labelledby="activity-page-title">
      <div className="thoughts-toolbar">
        <div>
          <h1 ref={headingRef} id="activity-page-title" tabIndex={-1}>Activity</h1>
        </div>
        <div className="thoughts-toolbar__actions">
          <button className="activity-button" type="button" aria-label={`Back to ${returnLabel}`} onClick={onBack}>
            <span aria-hidden="true">←</span> {returnLabel}
          </button>
          <button className="new-thought-button" type="button" onClick={onCapture}>
            <span>+</span> new thought
          </button>
        </div>
      </div>
      {error ? (
        <div className="notice notice--error" role="alert">
          <strong>Local store unavailable</strong>
          <span>{error}</span>
          <button type="button" onClick={onRetry}>retry</button>
        </div>
      ) : (
        <div className="activity-page__content">
          <div className="activity-page__overview">
            <dl className="activity-page__week"><dt>finished this week</dt><dd>{progress.week.toLocaleString()}</dd></dl>
            <dl className="activity-page__counts" aria-label="Completion counts">
              <div><dt>Today</dt><dd>{progress.today.toLocaleString()}</dd></div>
              <div><dt>All time</dt><dd>{progress.total.toLocaleString()}</dd></div>
            </dl>
          </div>
          <ActivityGarden total={progress.total} />
          <section className="activity-page__recent" aria-labelledby="recent-completions-title">
            <h2 id="recent-completions-title">Today</h2>
            {visibleCompletions.length === 0 ? <p>Your first finish will appear here.</p> : (
              <ol>
                {visibleCompletions.map((completion) => <li key={JSON.stringify([completion.thoughtId, completion.itemId])}>
                  <span className="activity-page__check" aria-hidden="true">✓</span>
                  <span className="activity-page__task">{completion.text}</span>
                  <time dateTime={completion.completedAt} title={new Date(completion.completedAt).toLocaleString()}>{new Date(completion.completedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</time>
                </li>)}
              </ol>
            )}
          </section>
          <button className="activity-page__more" type="button" aria-expanded={moreActivity} aria-controls="activity-history" onClick={() => setMoreActivity((open) => !open)}>
            More activity <span aria-hidden="true">{moreActivity ? "−" : "+"}</span>
          </button>
          <section id="activity-history" className="activity-page__summary" aria-label="Completion history" hidden={!moreActivity}>
            {moreActivity && <>
              <ActivitySummary progress={progress} />
              <p className="task-activity__note activity-page__growth-note">Your garden grows with saved checklist completions. Days away never undo its growth. Unchecking a task adjusts its progress.</p>
            </>}
          </section>
        </div>
      )}
    </section>
  );
}
