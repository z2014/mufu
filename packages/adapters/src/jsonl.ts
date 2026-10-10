import { readFileSync } from 'node:fs';

type FixtureMarker = {
  origin: 'handwritten' | 'recorded';
  protocol: string;
  note?: string;
};

export function isFixtureMarker(
  value: unknown,
): value is { origin: string; protocol: string } | { _fixture: FixtureMarker } {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  if (row._fixture && typeof row._fixture === 'object') return true;
  return (
    typeof row.origin === 'string' &&
    typeof row.protocol === 'string' &&
    Object.keys(row).every((key) => ['origin', 'protocol', 'note', 'source'].includes(key))
  );
}

function readJsonl(path: string): unknown[] {
  const text = readFileSync(path, 'utf8');
  const rows: unknown[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    rows.push(JSON.parse(trimmed) as unknown);
  }
  return rows;
}

export function fixtureMessages(path: string): unknown[] {
  return readJsonl(path).filter((row) => !isFixtureMarker(row));
}

export function fixtureMarker(path: string): FixtureMarker | null {
  const first = readJsonl(path)[0];
  if (!first || typeof first !== 'object') return null;
  const row = first as Record<string, unknown>;
  const marker = (row._fixture as FixtureMarker | undefined) ?? (isFixtureMarker(row) ? (row as FixtureMarker) : null);
  if (!marker) return null;
  if (marker.origin !== 'handwritten' && marker.origin !== 'recorded') return null;
  return marker;
}
