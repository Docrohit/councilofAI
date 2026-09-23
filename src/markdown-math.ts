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
