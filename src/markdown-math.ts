// Normalize common model-produced LaTeX delimiters without changing code samples.
// Incomplete delimiters stay as text while a response is streaming.
export function normalizeMath(source: string): string {
  const lines = source.split("\n");
  let fence: { char: string; length: number } | undefined;
  let prose = "";
  let output = "";
  const flush = () => {
    output += normalizeProse(prose);
    prose = "";
  };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const suffix = index < lines.length - 1 ? "\n" : "";
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      output += line + suffix;
      if (
        marker &&
        marker[1][0] === fence.char &&
        marker[1].length >= fence.length &&
        !marker[2].trim()
      )
        fence = undefined;
    } else if (marker || /^(?: {4}|\t)/.test(line)) {
      flush();
      output += line + suffix;
      if (marker) fence = { char: marker[1][0], length: marker[1].length };
    } else prose += line + suffix;
  }
  flush();
  return output;
}

function normalizeProse(text: string): string {
  let result = "";
  for (let i = 0; i < text.length;) {
    if (text[i] === "`") {
      const ticks = text.slice(i).match(/^`+/)![0];
      let end = text.indexOf(ticks, i + ticks.length);
      while (
        end !== -1 &&
        (text[end - 1] === "`" || text[end + ticks.length] === "`")
      )
        end = text.indexOf(ticks, end + ticks.length);
      if (end !== -1) {
        result += text.slice(i, end + ticks.length);
        i = end + ticks.length;
        continue;
      }
    }
    if (text[i] === "\\") {
      // Some model answers carry JSON-escaped delimiters into prose. Only
      // repair matched doubled delimiters whose body has mathematical syntax;
      // ordinary escaped text and all protected code spans remain literal.
      const doubled = text[i + 1] === "\\" && ["(", "["].includes(text[i + 2]);
      if (doubled) {
        const display = text[i + 2] === "[";
        const closing = display ? "\\\\]" : "\\\\)";
        const end = text.indexOf(closing, i + 3);
        const body = end < 0 ? "" : text.slice(i + 3, end);
        if (end >= 0 && /\\[A-Za-z]+|[\d_^=+*/<>]/.test(body)) {
          // Decode a whole escaping layer only when every slash run is even
          // and a recognized escaped command signals mathematical intent.
          // Never collapse a suffix of a row break (four slashes become two).
          const escapedCommand =
            /(?<!\\)\\\\(?:(?:begin|frac|dfrac|tfrac|sqrt)\s*\{|(?:zeta|alpha|beta|gamma|delta|theta|lambda|pi|sigma|phi|omega)\b)/.test(
              body,
            );
          const allEscaped = [...body.matchAll(/\\+/g)].every(
            (m) => m[0].length % 2 === 0,
          );
          const math =
            escapedCommand && allEscaped ? body.replace(/\\\\/g, "\\") : body;
          result += display ? `\n\n$$\n${math.trim()}\n$$\n\n` : `$${math}$`;
          i = end + 3;
          continue;
        }
      }
      const next = text[i + 1];
      if (next === "(" || next === "[") {
        const end = text.indexOf(next === "(" ? "\\)" : "\\]", i + 2);
        if (end !== -1) {
          const body = text.slice(i + 2, end);
          result +=
            next === "(" ? `$${body}$` : `\n\n$$\n${body.trim()}\n$$\n\n`;
          i = end + 2;
          continue;
        }
      }
      // Preserve escaped backslashes/dollars/backticks rather than interpreting them.
      result += text.slice(i, i + 2);
      i += 2;
      continue;
    }
    // Do not let two ordinary currency amounts become a single math expression.
    if (text[i] === "$" && /\d/.test(text[i + 1] || "")) {
      const amount = text.slice(i).match(/^\$\d[\d,.]*(?=\s|$|[;:!?])/);
      if (amount) {
        const closing = text.indexOf("$", i + amount[0].length);
        const between =
          closing < 0 ? "" : text.slice(i + amount[0].length, closing);
        if (
          closing < 0 ||
          (/\d/.test(text[closing + 1] || "") &&
            !/[\n=+*/^_{}\\]/.test(between))
        ) {
          result += "\\" + amount[0];
          i += amount[0].length;
          continue;
        }
      }
    }
    result += text[i++];
  }
  return result;
}
