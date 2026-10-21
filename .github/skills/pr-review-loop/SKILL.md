---
name: pr-review-loop
description: Automates the PR review cycle — requests Copilot review, waits for results, fixes issues, replies to comments, and resolves threads. Use when asked to "review loop", "fix PR comments", "iterate on PR review", or "resolve all review comments".
---

## PR Review Loop Skill

This skill automates the iterative PR review cycle with the Copilot pull-request reviewer. It requests a review, waits for comments, fixes valid issues, replies with explanations, resolves threads, and repeats until the PR is clean.

When invoked by `fix-all-issues`, retain its issue inventory and two-model review gate. Any repository-content changes made here must pass that gate again before pushing. A request to create or improve skills does not itself request execution of a PR review loop.

### Procedure

#### Step 1: Identify the PR

- If no PR number is given, detect the current branch and find its open PR:
  ```bash
  gh pr view --json number,title,headRefName --jq '.number'
  ```
- Confirm the PR number and repository (owner/repo) before proceeding.

#### Step 2: Check for Existing Unresolved Comments

Before requesting a new review, check if there are already unresolved review threads:

```bash
gh api graphql -f query='
query {
  repository(owner: "<OWNER>", name: "<REPO>") {
    pullRequest(number: <PR_NUMBER>) {
      reviewThreads(first: 50) {
        nodes {
          id
          isResolved
          isOutdated
          comments(first: 1) {
            nodes { body path line author { login } }
          }
        }
      }
    }
  }
}'
```

- Filter for threads where `isResolved == false`.
- Paginate `reviewThreads` using `pageInfo { hasNextPage endCursor }` and an `after` cursor; 50 threads is not a completeness limit. Fetch all comment pages for each unresolved thread, not just its first comment. Inspect top-level review bodies and PR comments for actionable feedback too.
- Do not silently ignore unresolved outdated threads: verify whether the current code addresses them.
- If **unresolved threads exist** → skip to Step 5 (evaluate and fix them).
- If **all threads are resolved** (or no threads at all) → proceed to Step 3.

#### Step 3: Request Copilot Review

Request a review from the Copilot pull-request reviewer:
```bash
gh pr edit <PR_NUMBER> --add-reviewer "copilot-pull-request-reviewer"
```

Before the request, record the current head SHA, request time, and existing matching Copilot workflow run IDs and attempt numbers. If the request fails, inspect the error and supported reviewer/API configuration. Report unavailable Copilot access as a blocker rather than inventing an unsupported GraphQL mutation or claiming a review was requested.

#### Step 4: Wait for Review Results

Instead of counting reviews (which can give false positives due to early summary comments), **poll the GitHub Actions workflow run** for the Copilot code review to reach `completed` status. Discover the actual run name: GitHub currently uses **"Running Copilot Code Review"** in this repository; older runs or installations may use **"Copilot code review"**. Do not hard-code only the older name and falsely time out.

**Strategy: Poll the discovered Copilot review workflow run:**

First, get the PR's head SHA:
```bash
gh pr view <PR_NUMBER> --json headRefOid --jq '.headRefOid'
```

Use `gh api` to discover and poll runs for that SHA:
- Inspect run names and identities for the matching head SHA, accepting the known Copilot review names above rather than unrelated CI jobs.
- Paginate workflow runs. Require a new run associated with this request, or an existing run whose attempt number has increased; an older completed review on the same SHA does not count.
- Wait until `status === "completed"` and require a successful conclusion. Failed, cancelled, skipped, and timed-out runs are not clean reviews.

For example, poll via CLI (adapt quoting and line continuation to the host shell):
```bash
gh api --paginate "repos/<OWNER>/<REPO>/actions/runs?head_sha=<HEAD_SHA>&per_page=100" \
  --jq '.workflow_runs[] | select(.name == "Running Copilot Code Review" or .name == "Copilot code review") | {id, name, head_sha, run_attempt, created_at, status, conclusion}'
```

**Polling strategy:**
1. After requesting the review, wait **10 seconds** for the workflow to be triggered.
2. Poll every **30 seconds** checking for the discovered Copilot review workflow run matching the PR's head SHA and this request.
3. Wait until the run's `status` is `"completed"` with a successful conclusion.
4. Once completed, query review threads for unresolved comments (same as Step 2).
5. Timeout after **15 minutes** if no corresponding successful workflow completes. Report the blocker, preserving the PR and work completed; do not count the timeout as a clean round.

**Important:** Do NOT rely on counting `copilot-pull-request-reviewer[bot]` reviews — the bot posts an initial summary comment almost immediately (before finishing the actual code review), which causes false positives. Always wait for the Actions workflow to complete.

#### Step 5: Evaluate Each Comment

For each unresolved review comment:

1. **Read the comment** — understand the issue being raised.
2. **Check the referenced file and line** — view the current code to assess validity.
3. **Decide action:**
   - If the issue is **valid and actionable** → fix it (Step 6).
   - If the issue is **already addressed** or **not applicable** (e.g., lockfile format noise) → reply explaining why and resolve (Step 7).
   - If the issue is **a false positive** → reply explaining why it's not an issue and resolve (Step 7).

#### Step 6: Fix Valid Issues

For each valid issue:

1. Make the code fix using edit tools.
2. Run relevant tests plus the project's required build and lint to verify no regressions. If this loop is part of `fix-all-issues`, also obtain its two consecutive clean dual-model review rounds on the changed candidate before pushing.
3. Stage and commit with a descriptive message referencing the fix:
   ```
   fix: <brief description of what was fixed>
   
   Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
   ```
4. Push to the PR branch.

**Important:** Batch related fixes into a single commit when possible to keep history clean.

#### Step 7: Reply and Resolve Threads

For each addressed comment, reply with how it was resolved and resolve the thread:

```bash
gh api graphql -f query='
mutation {
  addPullRequestReviewThreadReply(input: {
    pullRequestReviewThreadId: "<THREAD_ID>",
    body: "<EXPLANATION>"
  }) { comment { id } }
}'
```

After checking that the reply succeeded:

```bash
gh api graphql -f query='
mutation {
  resolveReviewThread(input: {
    threadId: "<THREAD_ID>"
  }) { thread { isResolved } }
}'
```

Reply format guidelines:
- Reference the commit SHA where the fix was made.
- Briefly describe what was changed and why.
- For non-issues, explain why no code change is needed.

Reply before resolving. Prefer separate requests so a failed reply cannot leave a thread resolved without its explanation. Batch independent replies when useful, check both HTTP and GraphQL errors, then resolve only threads whose replies succeeded.

#### Step 8: Check for Remaining Issues

After resolving all threads, check if there are any remaining unresolved threads (same query as Step 2).

- If **unresolved threads remain** → go back to Step 5.
- If **all resolved** → proceed to Step 9.

#### Step 9: Request Re-review (Loop)

If code changes were made, request another Copilot review to catch any new issues introduced by the fixes:

```bash
gh pr edit <PR_NUMBER> --add-reviewer "copilot-pull-request-reviewer"
```

Then go back to **Step 4** to wait for the new review.

#### Step 10: Completion

The loop is complete only after a newly requested Copilot review successfully finishes on the latest PR head, produces no remaining valid actionable feedback, and all conversations are addressed. An empty thread list before review completion or manually resolving threads is not sufficient.

Check required CI results, mergeability, draft status, branch protection, and required approvals separately before saying the PR is ready for merge. A clean Copilot review is not a substitute for required human approval. Report pending checks or missing approvals explicitly and never merge automatically.

Report to the user:
- Total number of review rounds completed.
- Total number of issues fixed.
- Total number of comments resolved.
- Final status: all review threads resolved.

#### Step 11: Post Summary to PR

After the loop completes, post a summary comment on the PR for the record:

```bash
gh pr comment <PR_NUMBER> --body "## PR Review Loop Summary

- **N review rounds** completed
- **M findings** raised across all rounds, with fixes and evidence-based non-issue dispositions:
  - **Round 1** (X issues): <brief description of issues and fixes>
  - **Round 2** (Y issues): <brief description>
  - ...
  - **Round N**: Clean — zero unresolved comments ✅
- **Final status:** All review threads resolved"
```

This provides a permanent record of the review process on the PR itself.

### Safety Rules

- **Check-in with user:** After every 15 consecutive review rounds, pause and ask the user if they'd like to continue or stop. This prevents runaway loops while not imposing a hard limit.
- **Build verification:** Always run build + lint after code changes, before pushing.
- **Don't fix unrelated issues:** Only address issues raised by the reviewer, not pre-existing problems.
- **Preserve commit history:** Use descriptive commit messages. Don't squash or amend previous commits.
- **Ask before large changes:** If a reviewer comment requires significant refactoring (>50 lines), confirm with the user first.

### GraphQL Reference

**Get unresolved review threads:**
```graphql
query($OWNER: String!, $REPO: String!, $PR: Int!, $CURSOR: String) {
  repository(owner: $OWNER, name: $REPO) {
    pullRequest(number: $PR) {
      reviewThreads(first: 50, after: $CURSOR) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id, isResolved, isOutdated
          comments(first: 100) {
            pageInfo { hasNextPage endCursor }
            nodes { body, path, line, author { login } }
          }
        }
      }
    }
  }
}
```

**Reply to a thread, verify success, then resolve in a separate request:**
```graphql
mutation {
  addPullRequestReviewThreadReply(input: {
    pullRequestReviewThreadId: "$THREAD_ID",
    body: "$REPLY"
  }) { comment { id } }
}
```

```graphql
mutation {
  resolveReviewThread(input: {
    threadId: "$THREAD_ID"
  }) { thread { isResolved } }
}
```

**Request reviewer:**
```bash
gh pr edit $PR --add-reviewer "copilot-pull-request-reviewer"
```
