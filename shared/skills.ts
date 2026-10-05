import { parseDocument } from "yaml";
import { z } from "zod";

/** Agent Skills names: lowercase letters, digits and single hyphens. */
export const skillNameSchema = z
  .string()
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const frontmatter = z.object({
  name: skillNameSchema,
  description: z.string().min(1).max(1024),
  license: z.string().optional(),
  compatibility: z.string().min(1).max(500).optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  "allowed-tools": z.string().optional(),
});
export const SKILL_MD_MAX_CHARS = 32000;

/**
 * Parses SKILL.md in the Agent Skills format. When `name` is given (the
 * skill's directory), the frontmatter name must match it.
 */
export function parseSkill(content: string, name?: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(
    content,
  );
  if (!match) throw new Error("SKILL.md requires YAML frontmatter.");
  const doc = parseDocument(match[1], { uniqueKeys: true });
  if (doc.errors.length) throw new Error("Invalid Skills YAML frontmatter.");
  const meta = frontmatter.parse(doc.toJS({ maxAliasCount: 10 }));
  if (name !== undefined && meta.name !== name)
    throw new Error("Skill name must match its directory.");
  if (content.length > SKILL_MD_MAX_CHARS)
    throw new Error(
      `SKILL.md exceeds ${SKILL_MD_MAX_CHARS} characters; move detail to references.`,
    );
  return { ...meta, body: match[2].trim() };
}
