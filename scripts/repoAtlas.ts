/**
 * Repo atlas: scans the workspace for starry-night dirs, reads the git history,
 * and writes a sortable single-page dashboard.
 *   bun run scripts/repoAtlas.ts
 * Everything here is read-only measurement - no working-tree mutation.
 */
import { execSync } from "node:child_process";
import { existsSync, readdirSync, statSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WORKSPACE = dirname(REPO);
const OUT = join(REPO, "docs/prototypes/repo-atlas.html");
const MATCH = /(starry-night|^sn-)/i;
const TRUNK = "dev"; // every feature stream is measured against dev

const sh = (cmd: string, cwd = REPO) => {
  try {
    return execSync(cmd, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
};
const num = (s: string) => (s === "" ? 0 : Number(s));

type Row = {
  name: string;
  kind: "active" | "merged" | "worktree" | "husk";
  status: string;
  lastActivity: string | null;
  firstActivity: string | null;
  commits: number;
  ahead: number | null;
  behind: number | null;
  insertions: number;
  deletions: number;
  files: number;
  dirty: number | null;
  path: string | null;
  detail: string;
};

const rows: Row[] = [];

/* ---------- 1. directories in the workspace ---------- */
type DirInfo = { name: string; path: string; isRepo: boolean; sizeMb: number; mtime: string };
const dirs: DirInfo[] = readdirSync(WORKSPACE, { withFileTypes: true })
  .filter((d) => d.isDirectory() && MATCH.test(d.name))
  .map((d) => {
    const path = join(WORKSPACE, d.name);
    const isRepo = existsSync(join(path, ".git"));
    let bytes = 0;
    let mtime = 0;
    const walk = (p: string, depth: number) => {
      if (depth > 4) return; // node_modules keeps real files well below the top level
      let entries;
      try {
        entries = readdirSync(p, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const full = join(p, e.name);
        try {
          const st = statSync(full);
          mtime = Math.max(mtime, st.mtimeMs);
          if (e.isDirectory()) walk(full, depth + 1);
          else bytes += st.size;
        } catch {
          /* unreadable - skip */
        }
      }
    };
    walk(path, 0);
    return {
      name: d.name,
      path,
      isRepo,
      sizeMb: Math.round((bytes / 1e6) * 10) / 10,
      mtime: new Date(mtime).toISOString(),
    };
  });

/* ---------- 2. merged streams, from merge-commit second parents ---------- */
type Stream = {
  commits: number;
  ins: number;
  del: number;
  files: Set<string>;
  first: string;
  last: string;
  merges: number;
};
const streams = new Map<string, Stream>();

// %x1f as the field separator: "|" would be swallowed as a shell pipe on Windows.
const mergeLog = sh('git log --all --merges --format="%H%x1f%cI%x1f%s"').split("\n").filter(Boolean);
for (const line of mergeLog) {
  const [hash, date, ...rest] = line.split("\x1f");
  const subject = rest.join("\x1f");
  const m = subject.match(/^[Mm]erge (?:branch ['"]?)?([^\s:'"]+)/);
  if (!m) continue;
  const branch = m[1].replace(/^origin\//, "");
  if (branch === "main" || branch === TRUNK || branch === "pull") continue;
  const p2 = sh(`git rev-parse -q --verify "${hash}^2"`);
  if (!p2) continue;
  const commits = num(sh(`git rev-list --count "${hash}^1..${hash}^2"`));
  if (commits === 0) continue;

  const s = streams.get(branch) ?? {
    commits: 0,
    ins: 0,
    del: 0,
    files: new Set<string>(),
    first: date,
    last: date,
    merges: 0,
  };
  s.commits += commits;
  s.merges += 1;
  s.first = date < s.first ? date : s.first;
  s.last = date > s.last ? date : s.last;
  for (const stat of sh(`git log --format= --numstat "${hash}^1..${hash}^2"`).split("\n")) {
    const [a, d, f] = stat.split("\t");
    if (!f) continue;
    s.ins += num(a === "-" ? "0" : a);
    s.del += num(d === "-" ? "0" : d);
    s.files.add(f);
  }
  streams.set(branch, s);
}

/* ---------- 3. live branches ---------- */
const liveBranches = sh("git for-each-ref --format=%(refname:short) refs/heads")
  .split("\n")
  .filter(Boolean);
const worktrees = sh("git worktree list --porcelain")
  .split("\n\n")
  .filter(Boolean)
  .map((block) => {
    const path = block.match(/^worktree (.+)$/m)?.[1] ?? "";
    const branch = block.match(/^branch refs\/heads\/(.+)$/m)?.[1] ?? null;
    const head = block.match(/^HEAD ([0-9a-f]+)$/m)?.[1] ?? "";
    return { path, branch, head };
  });
const wtByBranch = new Map(worktrees.filter((w) => w.branch).map((w) => [w.branch as string, w]));
const currentBranch = sh("git rev-parse --abbrev-ref HEAD");
const dirtyCount = sh("git status --porcelain").split("\n").filter(Boolean).length;

for (const b of liveBranches) {
  const last = sh(`git log -1 --format=%cI ${b}`);
  const first = sh(`git log --reverse --format=%cI ${TRUNK}..${b}`).split("\n").filter(Boolean)[0] ?? last;
  const counts = sh(`git rev-list --left-right --count ${TRUNK}...${b}`).split(/\s+/);
  const behind = num(counts[0] ?? "0");
  const ahead = num(counts[1] ?? "0");
  const shortstat = ahead > 0 ? sh(`git diff --shortstat ${TRUNK}...${b}`) : "";
  const wt = wtByBranch.get(b);
  const isTrunk = b === TRUNK || b === "main";

  let status: string;
  if (isTrunk) status = "trunk";
  else if (b === currentBranch) status = "checked out";
  else if (ahead === 0) status = "merged";
  else if (Date.now() - new Date(last).getTime() > 30 * 864e5) status = "stale";
  else status = "open";

  rows.push({
    name: b,
    kind: "active",
    status,
    lastActivity: last || null,
    firstActivity: first || null,
    commits: isTrunk ? num(sh(`git rev-list --count ${b}`)) : ahead,
    ahead: isTrunk ? null : ahead,
    behind: isTrunk ? null : behind,
    insertions: num(shortstat.match(/(\d+) insertion/)?.[1] ?? "0"),
    deletions: num(shortstat.match(/(\d+) deletion/)?.[1] ?? "0"),
    files: num(shortstat.match(/(\d+) file/)?.[1] ?? "0"),
    dirty: b === currentBranch ? dirtyCount : null,
    path: wt ? wt.path : b === currentBranch ? REPO : null,
    detail: sh(`git log -1 --format=%s ${b}`),
  });
}

/* detached worktrees have no branch row of their own */
for (const w of worktrees.filter((w) => !w.branch && w.head)) {
  const last = sh(`git log -1 --format=%cI ${w.head}`);
  rows.push({
    name: `(detached) ${w.head.slice(0, 7)}`,
    kind: "worktree",
    status: "detached",
    lastActivity: last || null,
    firstActivity: last || null,
    commits: 0,
    ahead: null,
    behind: num(sh(`git rev-list --count ${w.head}..${TRUNK}`)),
    insertions: 0,
    deletions: 0,
    files: 0,
    dirty: sh("git status --porcelain", w.path).split("\n").filter(Boolean).length,
    path: w.path,
    detail: sh(`git log -1 --format=%s ${w.head}`),
  });
}

/* Agent worktree dirs that exist on disk but git no longer registers: the
   .git/worktrees admin data gets pruned out from under them, leaving orphans. */
const WT_DIR = join(REPO, ".claude/worktrees");
const registered = new Set(worktrees.map((w) => resolve(w.path).toLowerCase()));
if (existsSync(WT_DIR)) {
  for (const name of readdirSync(WT_DIR)) {
    const path = join(WT_DIR, name);
    if (registered.has(resolve(path).toLowerCase())) continue;
    const mtime = statSync(path).mtimeMs;
    rows.push({
      name,
      kind: "worktree",
      status: "unregistered",
      lastActivity: new Date(mtime).toISOString(),
      firstActivity: new Date(mtime).toISOString(),
      commits: 0,
      ahead: null,
      behind: null,
      insertions: 0,
      deletions: 0,
      files: 0,
      dirty: null,
      path,
      detail: "on disk but absent from `git worktree list` - git pruned the admin data",
    });
  }
}

/* ---------- 4. merged streams that no longer have a branch ---------- */
for (const [name, s] of streams) {
  if (liveBranches.includes(name)) continue;
  rows.push({
    name,
    kind: "merged",
    status: s.merges > 1 ? `merged x${s.merges}` : "merged",
    lastActivity: s.last,
    firstActivity: s.first,
    commits: s.commits,
    ahead: null,
    behind: null,
    insertions: s.ins,
    deletions: s.del,
    files: s.files.size,
    dirty: null,
    path: null,
    detail: `${s.merges} merge${s.merges > 1 ? "s" : ""} into the trunk line`,
  });
}

/* ---------- 5. husk directories ---------- */
const streamNames = [...streams.keys(), ...liveBranches];
for (const d of dirs) {
  if (d.isRepo) continue;
  const tokens = d.name
    .toLowerCase()
    .replace(/^sn-|^starry-night-?/g, "")
    .split(/[-_]/)
    .filter(Boolean);
  const guess = streamNames.find((n) => tokens.some((t) => t && n.toLowerCase().includes(t))) ?? null;
  const contents = readdirSync(d.path);
  rows.push({
    name: d.name,
    kind: "husk",
    status: "abandoned dir",
    lastActivity: d.mtime,
    firstActivity: d.mtime,
    commits: guess ? (streams.get(guess)?.commits ?? 0) : 0,
    ahead: null,
    behind: null,
    insertions: 0,
    deletions: 0,
    files: 0,
    dirty: null,
    path: d.path,
    detail:
      `${contents.join(", ")} only, no .git${guess ? ` - the work landed on ${guess}` : ""}` +
      ` - ${d.sizeMb < 0.1 ? "<0.1" : d.sizeMb} MB on disk`,
  });
}

/* ---------- 6. emit ---------- */
const meta = {
  generated: new Date().toISOString(),
  workspace: WORKSPACE,
  repo: REPO,
  origin: sh("git remote get-url origin"),
  currentBranch,
  dirtyCount,
  totalCommits: num(sh("git rev-list --all --count")),
  firstCommit: sh("git log --reverse --format=%cI").split("\n")[0] ?? "",
  tags: sh("git tag --sort=-creatordate").split("\n").filter(Boolean),
  dirCount: dirs.length,
  huskCount: dirs.filter((d) => !d.isRepo).length,
  trunk: TRUNK,
};

const template = readFileSync(join(REPO, "scripts/repoAtlas.template.html"), "utf8");
const html = template.replace("/*__DATA__*/", `const DATA = ${JSON.stringify({ meta, rows })};`);
writeFileSync(OUT, html);
console.log(`wrote ${OUT}`);
console.log(
  `  ${rows.length} rows: ${rows.filter((r) => r.kind === "active").length} live, ` +
    `${rows.filter((r) => r.kind === "merged").length} merged, ` +
    `${rows.filter((r) => r.kind === "husk").length} husks`,
);
