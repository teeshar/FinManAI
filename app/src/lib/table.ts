/**
 * Fixed-width tables for terminal output.
 *
 * Written rather than depended on because the requirement is small and the
 * subtlety is specific: this application prints rupee figures containing Indian
 * digit grouping (₹5,28,87,955) and the odd Devanagari or accented character,
 * so column widths have to be measured in what the terminal will actually
 * render — not in UTF-16 code units, which is what `String.length` counts.
 * Get that wrong and every column after the first misaligns.
 */

/**
 * Rendered width of a string.
 *
 * `Intl.Segmenter` counts grapheme clusters, so an emoji or a combining accent
 * counts once rather than two or three times. Wide CJK characters then get a
 * second column added.
 */
const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });

export function displayWidth(text: string): number {
  // Strip ANSI colour codes: they occupy no screen columns.
  const plain = text.replace(/\x1b\[[0-9;]*m/g, '');
  let width = 0;
  for (const { segment } of segmenter.segment(plain)) {
    const code = segment.codePointAt(0) ?? 0;
    // CJK, Hangul and fullwidth forms occupy two terminal columns.
    const wide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6);
    width += wide ? 2 : 1;
  }
  return width;
}

export type Column = {
  header: string;
  /** Right-align numbers so their magnitudes line up and can be compared. */
  align?: 'left' | 'right';
  /** Wrap rather than truncate past this width. Cells are never silently cut. */
  maxWidth?: number;
};

function pad(text: string, width: number, align: 'left' | 'right'): string {
  const gap = ' '.repeat(Math.max(0, width - displayWidth(text)));
  return align === 'right' ? gap + text : text + gap;
}

/** Break a cell onto multiple lines at word boundaries. */
function wrap(text: string, width: number): string[] {
  if (displayWidth(text) <= width) return [text];
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && displayWidth(line) + 1 + displayWidth(word) > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Render rows as a bordered table.
 *
 * A cell is wrapped, never truncated. Truncation in a financial tool hides the
 * end of a number, and a number with its tail missing is worse than one that
 * took two lines.
 */
export function table(columns: Column[], rows: string[][], indent = ''): string {
  if (rows.length === 0) return `${indent}(none)`;

  const widths = columns.map((col, i) => {
    const natural = Math.max(
      displayWidth(col.header),
      ...rows.map((r) => displayWidth(r[i] ?? '')),
    );
    return col.maxWidth ? Math.min(natural, col.maxWidth) : natural;
  });

  const line = (left: string, mid: string, right: string) =>
    indent + left + widths.map((w) => '─'.repeat(w + 2)).join(mid) + right;

  const renderRow = (cells: string[]): string[] => {
    const wrapped = cells.map((cell, i) => wrap(cell ?? '', widths[i]));
    const height = Math.max(...wrapped.map((w) => w.length));
    return Array.from({ length: height }, (_, lineNo) =>
      indent +
      '│ ' +
      wrapped
        .map((w, i) => pad(w[lineNo] ?? '', widths[i], columns[i].align ?? 'left'))
        .join(' │ ') +
      ' │',
    );
  };

  return [
    line('┌', '┬', '┐'),
    ...renderRow(columns.map((c) => `\x1b[1m${c.header}\x1b[0m`)),
    line('├', '┼', '┤'),
    ...rows.flatMap(renderRow),
    line('└', '┴', '┘'),
  ].join('\n');
}
