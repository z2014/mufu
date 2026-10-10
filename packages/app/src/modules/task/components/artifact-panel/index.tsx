import type { ArtifactView } from '@mufu/core/view';

export function ArtifactPanel({
  artifacts,
  open,
  onToggle,
}: {
  artifacts: ArtifactView[];
  open: boolean;
  onToggle: () => void;
}) {
  if (!open) {
    return (
      <button
        type="button"
        className="hidden w-10 shrink-0 border-l bg-muted text-xs md:block"
        aria-label="展开产物"
        onClick={onToggle}
      >
        产物
      </button>
    );
  }
  return (
    <aside className="w-full shrink-0 border-t bg-muted px-5 py-4 md:w-72 md:border-t-0 md:border-l">
      <div className="mb-5 flex font-semibold">
        产物
        <button type="button" className="ml-auto font-normal text-muted-foreground" aria-label="收起产物" onClick={onToggle}>
          ⇥
        </button>
      </div>
      {artifacts.length === 0 ? <p className="text-sm text-muted-foreground">还没有产物</p> : null}
      <ul>
        {artifacts.map((artifact) => (
          <li key={artifact.id} className="border-b border-border py-2">
            <p>{artifact.title}</p>
            <p className="text-xs text-muted-foreground">{artifact.detail}</p>
          </li>
        ))}
      </ul>
    </aside>
  );
}
