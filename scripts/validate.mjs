#!/usr/bin/env node
// validate.mjs — Nolto Codex CLI plugin validator.
// Node built-ins only. Run: node codex-plugin/scripts/validate.mjs (any cwd)
// Exit 0: all checks pass. Exit 1: one error line per failure (file + reason).

import { readFileSync, readdirSync } from "fs";
import { resolve, join } from "path";
import { fileURLToPath } from "url";

// MIRROR_ROOT = codex-plugin/ (== public repo root, holds .agents/ marketplace + scripts).
// PLUGIN_DIR  = codex-plugin/plugins/nolto/ (the plugin itself; Codex requires the plugin to
//               live in a subdirectory of the marketplace root, not at the root — see
//               marketplace.json source.path "./plugins/nolto").
// REPO_ROOT   = monorepo root (canonical enum/scope sources for literal-drift checks).
const SCRIPTS_DIR = fileURLToPath(new URL(".", import.meta.url));
const MIRROR_ROOT = resolve(SCRIPTS_DIR, "..");
const PLUGIN_DIR = join(MIRROR_ROOT, "plugins", "nolto");
const REPO_ROOT = resolve(MIRROR_ROOT, "..");
const pp = (...p) => join(PLUGIN_DIR, ...p);   // plugin-internal files
const mp = (...p) => join(MIRROR_ROOT, ...p);  // mirror-root files (.agents/ marketplace)
const rp = (...p) => join(REPO_ROOT, ...p);    // monorepo canonical sources

// --- error collection -------------------------------------------------------

const errors = [];
const fail = (file, reason) => errors.push({ file, reason });

// --- I/O helpers ------------------------------------------------------------

function readJSONat(abs) {
  let raw;
  try { raw = readFileSync(abs, "utf8"); } catch { fail(abs, "File not found or unreadable"); return null; }
  try { return JSON.parse(raw); } catch (e) { fail(abs, `Invalid JSON: ${e.message}`); return null; }
}
const readJSON = (rel) => readJSONat(pp(rel)); // plugin-internal JSON

function readRepo(rel) {
  const abs = rp(rel);
  try { return readFileSync(abs, "utf8"); }
  catch { fail(abs, "Not found (needed for literal-drift check)"); return null; }
}

// --- templates --------------------------------------------------------------

const PLAN_CONTENT_MAX = 50_000;
const CANON_JP = ["未着手", "進行中", "完了", "破棄"];

function checkTemplates() {
  const tmplDir = pp("templates");
  const planTmpl = join(tmplDir, "plan-template.md");
  const agentsSample = join(tmplDir, "AGENTS.md.sample");

  let raw;
  try { raw = readFileSync(planTmpl, "utf8"); } catch { fail(planTmpl, "File not found"); return; }
  if (!raw.trim().length) { fail(planTmpl, "empty"); return; }
  const byteLen = Buffer.byteLength(raw, "utf8");
  if (byteLen >= PLAN_CONTENT_MAX) fail(planTmpl, `exceeds PLAN_CONTENT_MAX: ${byteLen} bytes (max ${PLAN_CONTENT_MAX - 1})`);

  // JP status-label hygiene: pipe-table cells of 2–4 JP chars must be canonical.
  // Strip HTML comments first to avoid matching documentation tables inside <!-- -->.
  const rawNoComments = raw.replace(/<!--[\s\S]*?-->/g, "");
  for (const [, cell] of rawNoComments.matchAll(/\|\s*([^\|]{2,4})\s*\|/g)) {
    const t = cell.trim();
    if (/^[　-鿿豈-﫿]{2,4}$/.test(t) && !CANON_JP.includes(t))
      fail(planTmpl, `Non-canonical JP status label "${t}" in table. Valid: ${CANON_JP.join(", ")}`);
  }

  // Marker-family presence (use comment-stripped string — same as JP-label check above)
  if (!/(✅|完了|済)/.test(rawNoComments)) fail(planTmpl, 'Missing done-family marker (✅ / 完了 / 済)');
  if (!/進行中|着手/.test(rawNoComments)) fail(planTmpl, 'Missing in_progress-family marker (進行中 / 着手)');
  if (!/- \[ \]/.test(rawNoComments)) fail(planTmpl, 'Missing not_started example (- [ ])');

  let sampleRaw;
  try { sampleRaw = readFileSync(agentsSample, "utf8"); } catch { fail(agentsSample, "File not found"); return; }
  if (!sampleRaw.trim().length) fail(agentsSample, "empty");
}

// --- canonical literal extraction -------------------------------------------

const arrRe = (name) => new RegExp(`export\\s+const\\s+${name}\\s*=\\s*\\[([^\\]]+)\\]`, "s");
const objRe = (name) => new RegExp(`const\\s+${name}[^=]*=\\s*(?:Object\\.freeze\\()?\\{([^}]+)\\}`, "s");
const extractArr = (src, name) => { const m = src.match(arrRe(name)); return m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : null; };
const extractKeys = (src, name) => { const m = src.match(objRe(name)); return m ? [...m[1].matchAll(/^\s*([a-zA-Z_][a-zA-Z0-9_]*):/gm)].map((x) => x[1]) : null; };
// Extract string values (quoted) from an object literal — used for PLAN_STATUS_LABELS JP values.
const extractVals = (src, name) => { const m = src.match(objRe(name)); return m ? [...m[1].matchAll(/:\s*"([^"]+)"/g)].map((x) => x[1]) : null; };

function loadCanonicals() {
  const [sSrc, rSrc, scSrc, scopeSrc] = [
    readRepo("packages/core/src/status.ts"),
    readRepo("packages/core/src/results.ts"),
    readRepo("packages/core/src/schemas.ts"),
    readRepo("apps/web/lib/oauth/scopes.ts"),
  ];
  if (!sSrc || !rSrc || !scSrc || !scopeSrc) return null;

  const planStatuses = extractArr(sSrc, "PLAN_STATUSES");
  const planStatusLabels = extractVals(sSrc, "PLAN_STATUS_LABELS");
  const testVerdicts = extractArr(rSrc, "TEST_VERDICTS");
  const reviewVerdicts = extractArr(rSrc, "REVIEW_VERDICTS");
  const planDocumentKinds = extractArr(scSrc, "PLAN_DOCUMENT_KINDS");
  const toolNames = extractKeys(scopeSrc, "TOOL_SCOPE_MAP");

  const missing = ["PLAN_STATUSES", "PLAN_STATUS_LABELS", "TEST_VERDICTS", "REVIEW_VERDICTS", "PLAN_DOCUMENT_KINDS", "TOOL_SCOPE_MAP"]
    .filter((_, i) => ![planStatuses, planStatusLabels, testVerdicts, reviewVerdicts, planDocumentKinds, toolNames][i]);
  if (missing.length) { fail(rp("packages/core/src/"), `Could not extract: ${missing.join(", ")}`); return null; }

  return { planStatuses, planStatusLabels, testVerdicts, reviewVerdicts, planDocumentKinds, toolNames };
}

// --- .codex-plugin/plugin.json ----------------------------------------------

function checkPlugin() {
  const d = readJSON(".codex-plugin/plugin.json");
  if (!d) return;
  const f = pp(".codex-plugin/plugin.json");
  if (!/^[a-z][a-z0-9-]*$/.test(d.name)) fail(f, `name must be kebab-case, got: ${JSON.stringify(d.name)}`);
  else if (d.name !== "nolto") fail(f, `name must be "nolto", got: "${d.name}"`);
  if (!/^\d+\.\d+\.\d+$/.test(d.version)) fail(f, `version must be semver, got: ${JSON.stringify(d.version)}`);
  if (d.version !== "0.1.3") fail(f, `version must be "0.1.3", got: "${d.version}"`);
  // Codex uses interface.displayName instead of top-level displayName
  if (!d.interface || typeof d.interface !== "object") fail(f, "interface must be an object");
  else if (typeof d.interface.displayName !== "string" || !d.interface.displayName)
    fail(f, "interface.displayName must be a non-empty string");
  for (const k of ["description", "homepage", "repository", "license"])
    if (typeof d[k] !== "string" || !d[k]) fail(f, `${k} must be a non-empty string`);
  if (!d.author || typeof d.author !== "object") fail(f, "author must be an object");
  else {
    if (!d.author.name) fail(f, "author.name must be a non-empty string");
    if (!d.author.email) fail(f, "author.email must be a non-empty string");
  }
  if (!Array.isArray(d.keywords) || !d.keywords.length) fail(f, "keywords must be a non-empty array");
  // hooks pointer: warn only (Codex allows it, but we do not ship one per decision §4)
  // No assertion on d.hooks — omitting it is correct but not required for validity.
}

// --- .agents/plugins/marketplace.json ---------------------------------------

function checkMarketplace() {
  // marketplace.json lives at the MIRROR root (public repo root), not inside the plugin dir.
  const f = mp(".agents/plugins/marketplace.json");
  const d = readJSONat(f);
  if (!d) return;
  if (d.name !== "nolto") fail(f, `name must be "nolto", got: ${JSON.stringify(d.name)}`);
  // Codex marketplace uses interface.displayName (not owner.name)
  if (!d.interface || typeof d.interface.displayName !== "string" || !d.interface.displayName)
    fail(f, "interface.displayName must be a non-empty string");
  if (!Array.isArray(d.plugins) || !d.plugins.length) { fail(f, "plugins must be a non-empty array"); return; }
  const e = d.plugins[0];
  if (e.name !== "nolto") fail(f, `plugins[0].name must be "nolto"`);
  // Codex marketplace source is an object {source, path}
  if (!e.source || typeof e.source !== "object") { fail(f, 'plugins[0].source must be an object with source and path fields'); }
  else {
    if (e.source.source !== "local") fail(f, `plugins[0].source.source must be "local", got: ${JSON.stringify(e.source.source)}`);
    // Codex requires the plugin in a subdirectory of the marketplace root (path "." does not
    // register — verified on codex-cli 0.137.0). The plugin lives at ./plugins/nolto.
    if (e.source.path !== "./plugins/nolto") fail(f, `plugins[0].source.path must be "./plugins/nolto", got: ${JSON.stringify(e.source.path)}`);
  }
  if (e.version !== "0.1.3") fail(f, `plugins[0].version must be "0.1.3", got: "${e.version}"`);
  if (!e.description) fail(f, "plugins[0].description must be non-empty");
  // policy checks
  if (!e.policy || typeof e.policy !== "object") { fail(f, "plugins[0].policy must be an object"); }
  else {
    if (e.policy.installation !== "AVAILABLE") fail(f, `plugins[0].policy.installation must be "AVAILABLE", got: ${JSON.stringify(e.policy.installation)}`);
    if (e.policy.authentication !== "ON_INSTALL") fail(f, `plugins[0].policy.authentication must be "ON_INSTALL", got: ${JSON.stringify(e.policy.authentication)}`);
  }
}

// --- .mcp.json --------------------------------------------------------------

function checkMcp() {
  const d = readJSON(".mcp.json");
  if (!d) return;
  const f = pp(".mcp.json");
  const s = d?.mcpServers?.nolto;
  if (!s) { fail(f, "mcpServers.nolto must be present"); return; }
  // Codex 0.137.0: no `type` field — transport is derived from `url:`
  // We do NOT assert type here (zero-secret means it must be absent).
  if (s.url !== "https://nolto.app/mcp") fail(f, `mcpServers.nolto.url must be "https://nolto.app/mcp"`);
  // Zero-secret assertions
  if ("headers" in s) fail(f, `mcpServers.nolto must NOT have "headers" (zero-secret assertion)`);
  if ("bearer_token_env_var" in s) fail(f, `mcpServers.nolto must NOT have "bearer_token_env_var" (zero-secret assertion)`);
  if ("http_headers" in s) fail(f, `mcpServers.nolto must NOT have "http_headers" (zero-secret assertion)`);
}

// --- templates/codex-hooks.json (Codex nested Stop-hook shape) -------------

function checkHooks() {
  const abs = pp("templates/codex-hooks.json");
  let raw;
  try { raw = readFileSync(abs, "utf8"); } catch { fail(abs, "templates/codex-hooks.json not found — required as the documented project .codex/hooks.json sample"); return; }
  let d;
  try { d = JSON.parse(raw); } catch (e) { fail(abs, `templates/codex-hooks.json invalid JSON: ${e.message}`); return; }
  if (!d || typeof d !== "object") { fail(abs, "templates/codex-hooks.json must be a top-level object"); return; }
  if (!d.hooks || typeof d.hooks !== "object") { fail(abs, "templates/codex-hooks.json must have a top-level hooks object"); return; }
  const stopArr = d.hooks["Stop"];
  if (!Array.isArray(stopArr) || stopArr.length === 0) {
    fail(abs, "hooks.Stop must be a non-empty array");
    return;
  }
  // Codex Stop-hook shape: hooks.Stop[*].hooks[*].{type, command, timeout}
  // (nested matcher group with inner hooks array — different from Claude's flat shape)
  for (let i = 0; i < stopArr.length; i++) {
    const group = stopArr[i];
    if (!group || typeof group !== "object") { fail(abs, `hooks.Stop[${i}] must be an object`); continue; }
    if (!Array.isArray(group.hooks) || group.hooks.length === 0) {
      fail(abs, `hooks.Stop[${i}].hooks must be a non-empty array (Codex nested hook shape)`);
      continue;
    }
    for (let j = 0; j < group.hooks.length; j++) {
      const entry = group.hooks[j];
      if (!entry || typeof entry !== "object") { fail(abs, `hooks.Stop[${i}].hooks[${j}] must be an object`); continue; }
      if (entry.type !== "command") fail(abs, `hooks.Stop[${i}].hooks[${j}].type must be "command", got: ${JSON.stringify(entry.type)}`);
      if (typeof entry.command !== "string" || !entry.command) fail(abs, `hooks.Stop[${i}].hooks[${j}].command must be a non-empty string`);
      else if (!entry.command.includes("nolto")) fail(abs, `hooks.Stop[${i}].hooks[${j}].command must reference "nolto", got: ${JSON.stringify(entry.command)}`);
      if (entry.timeout !== undefined && (typeof entry.timeout !== "number" || entry.timeout <= 0))
        fail(abs, `hooks.Stop[${i}].hooks[${j}].timeout must be a positive number`);
      // allowedEnvVars is Claude-only — do NOT validate it here
    }
  }
}

// --- skills -----------------------------------------------------------------

function parseFm(raw, file) {
  const parts = raw.split(/^---\s*$/m);
  if (parts.length < 3) { fail(file, "Frontmatter fences missing or malformed"); return null; }
  const fm = {};
  for (const line of parts[1].split("\n")) {
    const ci = line.indexOf(":");
    if (ci === -1) continue;
    const k = line.slice(0, ci).trim();
    if (k) fm[k] = line.slice(ci + 1).trim();
  }
  return { fm, body: parts.slice(2).join("---") };
}

function checkSkillBody(body, file, c) {
  const canonSet = new Set([...c.planStatuses, ...c.testVerdicts, ...c.reviewVerdicts, ...c.planDocumentKinds]);
  const toolSet = new Set(c.toolNames);

  // Tool-name check: Codex skills use bare names (no mcp__nolto__ prefix).
  // Scan code-fenced blocks and backtick-wrapped lowercase-underscore identifiers.
  // Check bare tool names that appear in backtick literals against the canonical 11.
  // We do NOT error on every backtick literal — only ones that look like tool names
  // (lowercase+underscore with at least one underscore, matching canonical patterns).
  // The nonEnum allowlist covers common prose tokens that aren't enum values or tool names.
  const nonEnum = new Set([
    ...c.toolNames,
    "planId","phaseId","projectId","uuid","queued","processing","completed",
    "status","verdict","message","summary","round","title","content","phases",
    "type","http","url","headers","encoding","utf","base","kind","source",
    "hash","path","file","api","mcp","manual","ok",
  ]);

  // Helper: report an unknown identifier with the correct error class.
  // Tool-shaped tokens (contain an underscore → could be a tool call) go to the
  // TOOL_SCOPE_MAP error path; everything else goes to the enum-literal path.
  function reportUnknown(lit, context) {
    if (lit.includes("_")) {
      fail(file, `${context} references unknown tool "${lit}" (not in TOOL_SCOPE_MAP). Valid tools: ${[...toolSet].join(", ")}`);
    } else {
      fail(file, `\`${lit}\` not in PLAN_STATUSES/TEST_VERDICTS/REVIEW_VERDICTS/PLAN_DOCUMENT_KINDS. Valid: ${[...canonSet].join(", ")}`);
    }
  }

  // --- Pass 1: inline backtick-wrapped identifiers ---
  // Strip fenced code blocks first so backtick scanning does not double-count them.
  const bodyNoFenced = body.replace(/```[\s\S]*?```/g, "");
  const lits = [...bodyNoFenced.matchAll(/`([^`\n]+)`/g)]
    .map((m) => m[1])
    .flatMap((l) => (l.includes("|") ? l.split("|").map((s) => s.trim()) : [l]))
    .filter((l) => /^[a-z][a-z_]*$/.test(l));
  for (const lit of lits) {
    if (nonEnum.has(lit) || toolSet.has(lit)) continue;
    if (!canonSet.has(lit)) reportUnknown(lit, `\`${lit}\``);
  }

  // --- Pass 2: fenced code block tool calls ---
  // Extract identifiers that look like tool CALLS (name followed immediately by '(')
  // from inside triple-backtick fenced blocks.  We require at least one underscore so
  // that single-word CLI sub-commands (e.g. "nolto", "queue") are not flagged.
  // Field names in JSON-style example payloads (e.g. projectId, phaseId) are excluded
  // because they contain uppercase letters and are therefore not matched by [a-z_]+.
  const fencedRe = /```[^\n]*\n([\s\S]*?)```/g;
  for (const fencedMatch of body.matchAll(fencedRe)) {
    const block = fencedMatch[1];
    // Match identifiers that: (a) are lowercase+underscore, (b) have ≥1 underscore,
    // (c) are immediately followed by '(' — i.e. look like a function/tool call.
    const callRe = /\b([a-z][a-z_]*_[a-z][a-z_]*)\(/g;
    for (const callMatch of block.matchAll(callRe)) {
      const name = callMatch[1];
      if (toolSet.has(name)) continue; // known tool — OK
      // Unknown tool-shaped call inside a fenced block → error
      fail(file, `Fenced block references unknown tool "${name}" (not in TOOL_SCOPE_MAP). Valid tools: ${[...toolSet].join(", ")}`);
    }
  }
}

// JP label table pattern: rows of the form "| `<status_enum>` | <jp_label> |"
// The first cell must be a backtick-quoted lowercase-underscore token (i.e. a status enum key).
const JP_LABEL_RE = /\|\s*`([a-z][a-z_]*)`\s*\|\s*([^|]+?)\s*\|/g;

function checkJpStatusLabels(c) {
  const skillFile = pp("skills/plan-status/SKILL.md");
  let raw;
  try { raw = readFileSync(skillFile, "utf8"); }
  catch { fail(skillFile, "Not found (needed for JP label drift check)"); return; }

  const statusSet = new Set(c.planStatuses);
  const labelSet = new Set(c.planStatusLabels);
  for (const [, statusKey, cell] of raw.matchAll(JP_LABEL_RE)) {
    // Only check rows whose first cell is a known status key.
    if (!statusSet.has(statusKey)) continue;
    const label = cell.trim();
    // Only check cells that contain at least one CJK character (JP labels).
    if (!/[　-鿿豈-﫿]/.test(label)) continue;
    if (!labelSet.has(label)) {
      fail(skillFile, `JP status label "${label}" is not in PLAN_STATUS_LABELS. Valid: ${[...labelSet].join(", ")}`);
    }
  }
}

function checkSkills(c) {
  let dirs;
  const sd = pp("skills");
  try { dirs = readdirSync(sd, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); }
  catch { fail(sd, "skills/ directory not found"); return; }
  if (!dirs.length) { fail(sd, "No skill directories found"); return; }

  for (const dir of dirs) {
    const f = pp("skills", dir, "SKILL.md");
    let raw;
    try { raw = readFileSync(f, "utf8"); } catch { fail(f, "SKILL.md not found"); continue; }
    const parsed = parseFm(raw, f);
    if (!parsed) continue;
    const { fm, body } = parsed;
    if (!fm.name) fail(f, "frontmatter.name is missing");
    else if (fm.name !== dir) fail(f, `frontmatter.name "${fm.name}" does not match dir "${dir}"`);
    if (!fm.description || fm.description.length < 20) fail(f, `frontmatter.description must be ≥20 chars`);
    if (c) checkSkillBody(body, f, c);
  }
}

// --- main -------------------------------------------------------------------

checkPlugin();
checkMarketplace();
checkMcp();
checkHooks();
checkTemplates();
const canonicals = loadCanonicals();
if (canonicals) checkJpStatusLabels(canonicals);
checkSkills(canonicals);

if (errors.length) {
  for (const { file, reason } of errors) process.stdout.write(`FAIL  ${file}\n      ${reason}\n`);
  process.stdout.write(`\n${errors.length} error(s) found. Validation failed.\n`);
  process.exit(1);
} else {
  const n = (() => { try { return readdirSync(pp("skills"), { withFileTypes: true }).filter((d) => d.isDirectory()).length; } catch { return 0; } })();
  process.stdout.write(`OK    plugin.json / marketplace.json / .mcp.json / templates / ${n} skills — all checks passed.\n`);
  process.exit(0);
}
