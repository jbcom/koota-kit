import { execFileSync } from "node:child_process";

const REPO = "jbcom/koota-kit";

const ruleset = {
  name: "main-protection",
  target: "branch",
  enforcement: "active",
  conditions: {
    ref_name: { include: ["refs/heads/main"], exclude: [] },
  },
  rules: [
    { type: "deletion" },
    { type: "non_fast_forward" },
    { type: "required_linear_history" },
    {
      type: "pull_request",
      parameters: {
        required_approving_review_count: 0,
        dismiss_stale_reviews_on_push: true,
        require_code_owner_review: false,
        require_last_push_approval: false,
        required_review_thread_resolution: true,
      },
    },
    {
      type: "required_status_checks",
      parameters: {
        strict_required_status_checks_policy: true,
        required_status_checks: [
          { context: "Verify (ubuntu-24.04, Node 22)" },
          { context: "Verify (ubuntu-24.04, Node 24)" },
          { context: "Verify (ubuntu-24.04, Node 26)" },
          { context: "Verify (windows-2022, Node 24)" },
          { context: "Docs build" },
          { context: "Lint PR / title" },
        ],
      },
    },
  ],
  bypass_actors: [{ actor_type: "OrganizationAdmin", bypass_mode: "always" }],
};

// required_approving_review_count is 0 deliberately: this repo is
// agent-maintained, and requiring human review would either block the
// agent entirely or require it to review its own PRs, which reviews
// nothing. Fork-safety comes from (a) GitHub never granting a
// pull_request-triggered workflow repo secrets, (b)
// strict_required_status_checks_policy forcing the PR branch to be
// up-to-date with main and every listed check green on that exact
// commit, (c) non_fast_forward + deletion blocking history rewrites on
// main itself, and (d) only org admins ever bypassing this ruleset.

const existing = JSON.parse(
  execFileSync("gh", ["api", `repos/${REPO}/rulesets`], { encoding: "utf8" }),
);
const current = existing.find((r) => r.name === ruleset.name);

const endpoint = current ? `repos/${REPO}/rulesets/${current.id}` : `repos/${REPO}/rulesets`;
const method = current ? "PUT" : "POST";

execFileSync("gh", ["api", endpoint, "--method", method, "--input", "-"], {
  input: JSON.stringify(ruleset),
  stdio: ["pipe", "inherit", "inherit"],
});

console.log(`Ruleset "${ruleset.name}" applied to ${REPO}.`);
