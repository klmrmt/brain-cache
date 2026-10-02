interface BlobProps {
  mood?: "idle" | "listening" | "saved";
  compact?: boolean;
}

export function Blob({ mood = "idle", compact = false }: BlobProps) {
  return (
    <div className={`blob blob--${mood}${compact ? " blob--compact" : ""}`} aria-hidden="true">
      <span className="blob__eye blob__eye--left" />
      <span className="blob__eye blob__eye--right" />
      <span className="blob__signal" />
    </div>
  );
}
