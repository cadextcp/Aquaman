/**
 * Render one literal inside a translated sentence as <code>.
 *
 * The alternative — splitting the sentence into "before", <code>, "after" —
 * hands a translator three fragments and fixes the word order in English.
 * Here the catalog keeps ONE sentence with a {placeholder}, and the literal is
 * re-wrapped after interpolation, wherever in the sentence it ended up.
 */
export function withInlineCode(text: string, literal: string): React.ReactNode[] {
  return text.split(literal).flatMap((part, i) =>
    i === 0
      ? [<span key={`s${i}`}>{part}</span>]
      : [
          <code key={`c${i}`} className="text-xs">
            {literal}
          </code>,
          <span key={`s${i}`}>{part}</span>,
        ],
  );
}

/** The bearer-header literal shown in the MCP and REST API settings cards. */
export const BEARER_HEADER = "Authorization: Bearer";
