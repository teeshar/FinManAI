/**
 * The plan's written explanation.
 *
 * The narrative arrives as plain text with `**bold**` runs — that is true of
 * both the model-written version and the deterministic fallback, because the
 * fallback is assembled from the same phrasing. Rendered raw it shows literal
 * asterisks in the middle of the most-read paragraph on the page.
 *
 * **This is parsed into React elements, never injected as HTML.** The text may
 * have been produced by a language model, and `dangerouslySetInnerHTML` on
 * model output is an XSS vector regardless of how well the numeric and claim
 * guards are doing their job. Splitting on `**` and emitting `<strong>` yields
 * text nodes React escapes for us, so a model that emitted `<script>` would
 * render those characters harmlessly on screen.
 *
 * Nothing else in the markdown vocabulary is supported, deliberately. The
 * narrative is prose, not a document format, and every construct added here is
 * one more thing that can render wrongly in a plan someone is relying on.
 */

function formatInline(text: string, keyPrefix: string): React.ReactNode[] {
  // Split on the delimiter, keeping it: odd indices are the emphasised runs.
  return text.split(/\*\*/).map((part, i) =>
    i % 2 === 1 ? (
      <strong key={`${keyPrefix}-${i}`} className="font-semibold">
        {part}
      </strong>
    ) : (
      <span key={`${keyPrefix}-${i}`}>{part}</span>
    ),
  );
}

export function Narrative({ text, source }: { text: string; source: string }) {
  // Blank lines separate paragraphs; single newlines are soft wraps.
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);

  return (
    <div className="card p-6 sm:p-7">
      <div className="prose-advice space-y-4">
        {paragraphs.map((p, i) => (
          <p key={i} className="whitespace-pre-line">
            {formatInline(p, `p${i}`)}
          </p>
        ))}
      </div>
      <p
        className="mt-6 border-t pt-4 text-xs leading-relaxed"
        style={{ borderColor: 'var(--border)', color: 'var(--text-faint)' }}
      >
        {source === 'llm'
          ? 'Written by an AI model constrained to the figures below. Every number it used was checked against the calculated plan.'
          : 'Written from a fixed template. No AI model was used for this explanation.'}
      </p>
    </div>
  );
}
