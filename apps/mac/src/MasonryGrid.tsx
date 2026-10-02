import { useLayoutEffect, useRef, type ReactNode } from "react";

/** Keep document/keyboard order while letting each card occupy its natural height. */
export function MasonryGrid({ children }: { children: ReactNode }) {
  const gridRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const cards = Array.from(grid.children) as HTMLElement[];
    let frame: number | undefined;
    const measure = () => {
      const gap = parseFloat(getComputedStyle(grid).getPropertyValue("--card-gap")) || 12;
      const spans = cards.map((card) => Math.ceil(card.getBoundingClientRect().height + gap));
      cards.forEach((card, index) => {
        const span = `span ${spans[index]}`;
        if (card.style.gridRowEnd !== span) card.style.gridRowEnd = span;
      });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    cards.forEach((card) => observer.observe(card));
    return () => {
      observer.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [children]);

  return <div className="thought-grid" ref={gridRef}>{children}</div>;
}
