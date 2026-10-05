import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDb } from "../server/db.ts";
import {
  builtinSkills,
  listSkills,
  loadSkill,
  prepareUserSkill,
  saveUserSkill,
  setUserSkillEnabled,
  skillCatalog,
  skillsPromptGuide,
} from "../server/skills.ts";
import { analyzeStrategy } from "../server/options.ts";

const skillMd = (name: string, body = "Do the thing carefully.") =>
  `---\nname: ${name}\ndescription: Test skill ${name}.\n---\n\n${body}\n`;

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "council-skills-test-"));
  const db = openDb(dir);
  for (const id of ["owner", "other"])
    db.prepare(
      "INSERT INTO users(id,email,name,password,created_at,email_verified,access_approved) VALUES(?,?,?,?,?,?,?)",
    ).run(id, `${id}@example.test`, id, "hash", new Date().toISOString(), 1, 1);
  return {
    db,
    close() {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("built-in options skills load and appear for every account", () => {
  const builtins = builtinSkills();
  for (const name of [
    "option-chain-analysis",
    "option-buying-strategy",
    "option-spread-strategy",
  ]) {
    assert(builtins.has(name), `${name} is built in`);
    assert(builtins.get(name)!.body.includes("Required output checklist"));
  }
  const f = fixture();
  try {
    const names = skillCatalog(f.db, "other").map((s) => s.name);
    assert(names.includes("option-buying-strategy"));
    const guide = skillsPromptGuide(f.db, "other");
    assert.match(guide, /skill_load/);
    assert.match(guide, /option-spread-strategy/);
  } finally {
    f.close();
  }
});

test("uploaded skills normalise folder paths and reject unsafe or conflicting input", () => {
  const prepared = prepareUserSkill([
    { path: "my-skill/SKILL.md", content: skillMd("my-skill") },
    { path: "my-skill/references/guide.md", content: "Guide" },
    { path: "my-skill/scripts/run.py", content: "print('never executed')" },
    { path: "notes.txt", content: "Loose note" },
  ]);
  assert.equal(prepared.name, "my-skill");
  assert.deepEqual(Object.keys(prepared.resources).sort(), [
    "references/guide.md",
    "references/notes.txt",
    "scripts/run.py",
  ]);
  assert.throws(
    () =>
      prepareUserSkill([
        { path: "SKILL.md", content: skillMd("option-chain-analysis") },
      ]),
    /built-in skill name/,
  );
  assert.throws(
    () =>
      prepareUserSkill([
        { path: "a/SKILL.md", content: skillMd("a") },
        { path: "b/SKILL.md", content: skillMd("b") },
      ]),
    /exactly one SKILL.md/,
  );
  assert.throws(
    () =>
      prepareUserSkill([
        { path: "SKILL.md", content: skillMd("ok-skill") },
        { path: "../secret.md", content: "x" },
      ]),
    /Invalid file path/,
  );
  assert.throws(
    () => prepareUserSkill([{ path: "SKILL.md", content: "no frontmatter" }]),
    /YAML frontmatter/,
  );
  assert.throws(
    () =>
      prepareUserSkill([
        {
          path: "SKILL.md",
          content: "---\nname: Bad Name\ndescription: x\n---\nbody",
        },
      ]),
    /lowercase letters/,
  );
});

test("user skills are owner-scoped, toggleable and paged for agents", () => {
  const f = fixture();
  try {
    const long = "x".repeat(9000);
    const saved = saveUserSkill(f.db, "owner", [
      { path: "SKILL.md", content: skillMd("long-skill", long) },
      { path: "references/extra.md", content: "Extra detail" },
    ]);
    assert.equal(saved.replaced, false);
    const first = loadSkill(f.db, "owner", "long-skill");
    assert.equal(first.source, "user");
    assert.equal(first.content.length, 8000);
    assert.equal(first.nextOffset, 8000);
    const second = loadSkill(f.db, "owner", "long-skill", undefined, 8000);
    assert.equal(second.nextOffset, null);
    assert.equal(
      loadSkill(f.db, "owner", "long-skill", "references/extra.md").content,
      "Extra detail",
    );
    assert.throws(
      () => loadSkill(f.db, "other", "long-skill"),
      /No enabled skill/,
    );
    assert.equal(
      skillCatalog(f.db, "other").some((s) => s.name === "long-skill"),
      false,
    );
    const id = listSkills(f.db, "owner").find(
      (s) => s.name === "long-skill",
    )!.id!;
    assert.equal(setUserSkillEnabled(f.db, "other", id, false), false);
    assert.equal(setUserSkillEnabled(f.db, "owner", id, false), true);
    assert.throws(
      () => loadSkill(f.db, "owner", "long-skill"),
      /No enabled skill/,
    );
    assert.equal(
      skillCatalog(f.db, "owner").some((s) => s.name === "long-skill"),
      false,
    );
    assert.equal(
      saveUserSkill(f.db, "owner", [
        { path: "SKILL.md", content: skillMd("long-skill") },
      ]).replaced,
      true,
    );
  } finally {
    f.close();
  }
});

test("option_strategy computes spreads, unlimited risk, breakevens and probabilities", () => {
  const spread = analyzeStrategy({
    spot: 100,
    lotSize: 10,
    legs: [
      { type: "CE", side: "buy", strike: 100, premium: 5 },
      { type: "CE", side: "sell", strike: 110, premium: 2 },
    ],
  });
  assert.equal(spread.netPremium, 30);
  assert.match(spread.entry, /Net debit/);
  assert.equal(spread.maxProfit, 70);
  assert.equal(spread.maxLoss, -30);
  assert.deepEqual(spread.breakevens, [103]);
  assert.equal(spread.rewardToRisk, 2.33);

  const shortCall = analyzeStrategy({
    spot: 100,
    lotSize: 1,
    legs: [{ type: "CE", side: "sell", strike: 105, premium: 3 }],
  });
  assert.equal(shortCall.maxLoss, "unlimited");
  assert.equal(shortCall.maxProfit, 3);
  assert.deepEqual(shortCall.breakevens, [108]);

  const longPut = analyzeStrategy({
    spot: 100,
    lotSize: 1,
    legs: [{ type: "PE", side: "buy", strike: 100, premium: 4 }],
  });
  assert.equal(longPut.maxProfit, 96);
  assert.equal(longPut.maxLoss, -4);

  const condor = analyzeStrategy({
    spot: 100,
    lotSize: 1,
    daysToExpiry: 30,
    iv: 20,
    riskFreeRate: 0,
    legs: [
      { type: "PE", side: "buy", strike: 85, premium: 0.5 },
      { type: "PE", side: "sell", strike: 90, premium: 1.5 },
      { type: "CE", side: "sell", strike: 110, premium: 1.5 },
      { type: "CE", side: "buy", strike: 115, premium: 0.5 },
    ],
  });
  assert.equal(condor.maxProfit, 2);
  assert.equal(condor.maxLoss, -3);
  assert.deepEqual(condor.breakevens, [88, 112]);
  // Breakevens sit about two standard deviations away (20% IV, 30 days).
  assert(
    Math.abs(condor.probabilityOfProfitPct! - 96.4) < 1,
    `condor PoP ${condor.probabilityOfProfitPct}`,
  );
  assert(Math.abs(condor.greeks!.delta) < 0.2);
  assert(condor.greeks!.thetaPerDay > 0, "short premium earns theta");

  const longCall = analyzeStrategy({
    spot: 100,
    lotSize: 10,
    daysToExpiry: 30,
    riskFreeRate: 0,
    legs: [{ type: "CE", side: "buy", strike: 100, premium: 2.3, iv: 20 }],
  });
  assert(longCall.probabilityOfProfitPct! < 50);
  assert(
    Math.abs(longCall.greeks!.delta - 5.1) < 0.3,
    `delta ${longCall.greeks!.delta}`,
  );
  assert.equal(longCall.maxProfit, "unlimited");
  assert(
    longCall.payoffAtExpiry.some((row) => row.price === 102.3 && row.pnl === 0),
  );

  assert.throws(
    () =>
      analyzeStrategy({
        spot: 100,
        lotSize: 1,
        legs: [{ type: "CE", side: "buy", premium: 1 }],
      }),
    /positive strike/,
  );

  // Zero-cost risk reversals have a flat zero region between the strikes.
  const bearish = analyzeStrategy({
    spot: 100,
    lotSize: 1,
    daysToExpiry: 30,
    iv: 20,
    riskFreeRate: 0,
    legs: [
      { type: "PE", side: "buy", strike: 90, premium: 2 },
      { type: "CE", side: "sell", strike: 110, premium: 2 },
    ],
  });
  assert.deepEqual(bearish.breakevens, [90, 110]);
  assert(
    bearish.probabilityOfProfitPct! < 10,
    `${bearish.probabilityOfProfitPct}`,
  );
  assert.equal(bearish.maxLoss, "unlimited");
  const bullish = analyzeStrategy({
    spot: 100,
    lotSize: 1,
    daysToExpiry: 30,
    iv: 20,
    riskFreeRate: 0,
    legs: [
      { type: "PE", side: "sell", strike: 90, premium: 2 },
      { type: "CE", side: "buy", strike: 110, premium: 2 },
    ],
  });
  assert.deepEqual(bullish.breakevens, [90, 110]);
  assert(
    bullish.probabilityOfProfitPct! < 10,
    `${bullish.probabilityOfProfitPct}`,
  );
  assert.equal(bullish.maxProfit, "unlimited");
  assert.equal(bullish.maxLoss, -90);
});
