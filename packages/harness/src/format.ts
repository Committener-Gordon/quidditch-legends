/**
 * Terminal formatting for the balance report. Plain ASCII plus block characters,
 * so the output pastes into a commit message or an issue without mangling.
 */

export function histogram(
  values: number[],
  options: { bins?: number; width?: number; label?: string; format?: (n: number) => string } = {},
): string {
  const { bins = 14, width = 42, label = '', format = (n: number) => n.toFixed(0) } = options;
  if (values.length === 0) return `${label}: no data`;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const size = span / bins;

  const counts = new Array<number>(bins).fill(0);
  for (const value of values) {
    const index = Math.min(bins - 1, Math.floor((value - min) / size));
    counts[index] = (counts[index] ?? 0) + 1;
  }
  const peak = Math.max(...counts);

  const lines: string[] = [];
  if (label) lines.push(`  ${label}`);
  for (let index = 0; index < bins; index++) {
    const low = min + index * size;
    const count = counts[index] ?? 0;
    const filled = peak > 0 ? Math.round((count / peak) * width) : 0;
    const share = ((count / values.length) * 100).toFixed(1).padStart(5);
    lines.push(
      `  ${format(low).padStart(6)} ${'#'.repeat(filled).padEnd(width)} ${share}%  ${String(count).padStart(7)}`,
    );
  }
  return lines.join('\n');
}

export interface Check {
  name: string;
  value: number;
  target: [number, number];
  format?: (n: number) => string;
  note?: string;
}

export function renderChecks(checks: Check[]): string {
  const lines: string[] = [];
  const nameWidth = Math.max(...checks.map((c) => c.name.length)) + 2;
  for (const check of checks) {
    const format = check.format ?? ((n: number) => n.toFixed(2));
    const [low, high] = check.target;
    const inRange = check.value >= low && check.value <= high;
    const flag = inRange ? 'ok  ' : 'MISS';
    lines.push(
      `  ${flag}  ${check.name.padEnd(nameWidth)}${format(check.value).padStart(9)}` +
        `   target ${format(low)}-${format(high)}` +
        (check.note ? `   ${check.note}` : ''),
    );
  }
  return lines.join('\n');
}

export function table(headers: string[], rows: string[][], align: ('l' | 'r')[] = []): string {
  const widths = headers.map((head, index) =>
    Math.max(head.length, ...rows.map((row) => (row[index] ?? '').length)),
  );
  const render = (cells: string[]) =>
    '  ' +
    cells
      .map((cell, index) =>
        (align[index] ?? 'r') === 'l'
          ? cell.padEnd(widths[index] ?? 0)
          : cell.padStart(widths[index] ?? 0),
      )
      .join('  ');
  return [render(headers), '  ' + '-'.repeat(widths.reduce((a, b) => a + b + 2, 0) - 2), ...rows.map(render)].join(
    '\n',
  );
}

export function heading(text: string): string {
  return `\n${text}\n${'-'.repeat(text.length)}`;
}

export function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}
