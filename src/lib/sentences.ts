/**
 * Cut a growing stream of tokens into whole sentences.
 *
 * This is what makes the deck feel like a person rather than a terminal:
 * waiting for the full answer before speaking adds seconds of silence, and
 * speaking every token produces a stutter. Sentences are the right unit for
 * both the caption line and the voice.
 *
 * The subtlety is the end of the buffer. A full stop sitting at the end of
 * what has arrived so far is not necessarily the end of a sentence — mid-way
 * through "notes.md." the buffer really does read "…to notes.", and treating
 * that as complete emits a sentence and then a fragment reading "md.", which
 * the voice then pronounces as two letters. So a terminator only ends a
 * sentence when something non-space follows it, or when the stream is over.
 */
export function takeSentences(
  buffer: string,
  final: boolean,
): { sentences: string[]; rest: string } {
  const sentences: string[] = [];
  let rest = buffer;

  // Mid-stream a terminator must be followed by real whitespace. At the end
  // of the run, whatever is left is the last sentence whether it is
  // punctuated or not.
  const re = /^([\s\S]*?[.!?…]["')\]]?)(\s+)/;

  for (;;) {
    const m = rest.match(re);
    if (!m) break;
    const sentence = m[1].trim();
    rest = rest.slice(m[0].length);
    if (sentence.length >= 2) sentences.push(sentence);
  }

  if (final && rest.trim()) {
    sentences.push(rest.trim());
    rest = "";
  }

  return { sentences, rest };
}
