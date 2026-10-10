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
        className="bg-muted hidden w-10 shrink-0 border-l text-xs md:block"
        aria-label="展开产物"
        onClick={onToggle}
      >
        产物
      </button>
    );
  }
  return (
    <aside className="bg-muted w-full shrink-0 border-t px-5 py-4 md:w-72 md:border-l md:border-t-0">
      <div className="mb-5 flex font-semibold">
        产物
        <button
          type="button"
          className="text-muted-foreground ml-auto font-normal"
          aria-label="收起产物"
          onClick={onToggle}
        >
          ⇥
        </button>
      </div>
      {artifacts.length === 0 ? <p className="text-muted-foreground text-sm">还没有产物</p> : null}
      <ul>
        {artifacts.map((artifact) => (
          <li key={artifact.id} className="border-border border-b py-2">
            <p>{artifact.title}</p>
            <p className="text-muted-foreground text-xs">{artifact.detail}</p>
          </li>
        ))}
      </ul>
    </aside>
  );
}
