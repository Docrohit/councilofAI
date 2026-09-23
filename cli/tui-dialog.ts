export interface Choice {
  id: string;
  title: string;
  detail?: string;
}
export interface Field {
  label: string;
  value: string;
  secret?: boolean;
  hint?: string;
  validate?: (value: string) => string | undefined;
}
export class Dialog {
  query = "";
  index = 0;
  error = "";
  selected = new Set<string>();
  constructor(
    readonly title: string,
    readonly choices: Choice[],
    readonly accept: (ids: string[]) => void | Promise<void>,
    readonly fields?: Field[],
    readonly multiple = false,
  ) {}
  get filtered() {
    return this.choices.filter((c) =>
      `${c.title} ${c.detail || ""}`
        .toLowerCase()
        .includes(this.query.toLowerCase()),
    );
  }
  lines(height: number) {
    const lines = [this.title, ""];
    if (this.fields) {
      const start = Math.max(0, this.index - Math.floor((height - 6) / 2));
      for (
        let i = start;
        i < Math.min(this.fields.length, start + height - 6);
        i++
      ) {
        const f = this.fields[i];
        lines.push(
          `${i === this.index ? "›" : " "} ${f.label}: ${f.secret ? "•".repeat(Math.min(24, f.value.length)) : f.value}${i === this.index ? "│" : ""}`,
        );
      }
      lines.push(
        "",
        this.fields[this.index]?.hint || "",
        "Tab/↑/↓ field · Ctrl+U clear · Enter save · Esc cancel",
      );
    } else {
      lines.push(`Search: ${this.query}│`, "");
      const choices = this.filtered;
      this.index = Math.min(this.index, Math.max(0, choices.length - 1));
      const start = Math.max(0, this.index - Math.floor((height - 7) / 2));
      lines.push(
        ...choices
          .slice(start, start + Math.max(1, height - 7))
          .map(
            (c, j) =>
              `${start + j === this.index ? "›" : " "} ${this.multiple ? `[${this.selected.has(c.id) ? "x" : " "}] ` : ""}${c.title}${c.detail ? " — " + c.detail : ""}`,
          ),
      );
      if (!choices.length) lines.push("No matches.");
      lines.push(
        "",
        `↑/↓ choose · ${this.multiple ? "Space select · " : ""}Enter ${this.multiple ? "apply" : "open"} · Esc close`,
      );
    }
    if (this.error) lines.push(this.error);
    return lines.join("\n");
  }
  async key(
    str: string,
    k: { name?: string; ctrl?: boolean; meta?: boolean; shift?: boolean },
    pasted = false,
  ) {
    const length = this.fields?.length ?? this.filtered.length;
    if (!pasted && ["up", "down", "tab"].includes(k.name || "")) {
      this.index =
        (this.index +
          (k.name === "up" || k.shift ? Math.max(1, length) - 1 : 1)) %
        Math.max(1, length);
    } else if (!pasted && k.name === "return") {
      try {
        await this.accept(
          this.multiple
            ? [...this.selected]
            : [this.filtered[this.index]?.id].filter(Boolean),
        );
      } catch (e) {
        const issues = (e as { issues?: unknown }).issues;
        this.error = Array.isArray(issues)
          ? "Check the connection fields. Use a variable NAME for environment-based keys."
          : (e as Error).message.replace(/[\r\n\t]+/g, " ").slice(0, 240);
      }
    } else if (!pasted && this.multiple && str === " ") {
      const id = this.filtered[this.index]?.id;
      if (id)
        this.selected.has(id)
          ? this.selected.delete(id)
          : this.selected.add(id);
    } else {
      const f = this.fields?.[this.index];
      let value = f ? f.value : this.query;
      if (!pasted && k.ctrl && k.name === "u") value = "";
      else if (!pasted && k.name === "backspace")
        value = Array.from(value).slice(0, -1).join("");
      else if ((pasted || (!k.ctrl && !k.meta)) && str)
        value += str.replace(/[\r\n\t]/g, "");
      else return;
      if (f) {
        const error = f.validate?.(value);
        if (error) {
          this.error = error;
          return;
        }
        f.value = value.slice(0, f.secret ? 16000 : 500);
        this.error = "";
      } else {
        this.query = value.slice(0, 200);
        this.index = 0;
      }
    }
  }
}
