import type { TagColor, TagDefinition, Thought } from "./types";

export const TAG_COLOR_LABELS: Record<TagColor, string> = {
  graphite: "Graphite",
  clay: "Clay",
  moss: "Moss",
  sky: "Sky",
  plum: "Plum",
  rose: "Rose",
};

export function colorForTag(
  definitions: readonly TagDefinition[],
  name: string,
): TagColor | null {
  return definitions.find((definition) => definition.name === name)?.color ?? null;
}

export function tagColorClass(color: TagColor | null): string {
  return `tag-color--${color ?? "graphite"}`;
}

export function thoughtOutlineClass(thought: Thought, definitions: readonly TagDefinition[]): string {
  if (thought.pinned) return "thought-outline--pinned";
  const color = thought.tags.map((tag) => colorForTag(definitions, tag)).find((color) => color !== null);
  return color ? `thought-outline--tagged ${tagColorClass(color)}` : "";
}

export function TagColorDot({ color }: { color: TagColor | null }) {
  return <span className={`tag-color-dot ${tagColorClass(color)}`} aria-hidden="true" />;
}
