---
name: pr-review-loop
description: Automates the PR review cycle — requests Copilot review, waits for results, fixes issues, replies to comments, and resolves threads. Use when asked to "review loop", "fix PR comments", "iterate on PR review", or "resolve all review comments".
---

## PR Review Loop Skill

This skill automates the iterative PR review cycle with the Copilot pull-request reviewer. It requests a review, waits for comments, fixes valid issues, replies with explanations, resolves threads, and repeats until the PR is clean.

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
- If **unresolved threads exist** → skip to Step 5 (evaluate and fix them).
- If **all threads are resolved** (or no threads at all) → proceed to Step 3.

#### Step 3: Request Copilot Review

Request a review from the Copilot pull-request reviewer:
```bash
gh pr edit <PR_NUMBER> --add-reviewer "copilot-pull-request-reviewer"
```

If that fails (not a collaborator), try the GraphQL approach or inform the user that Copilot reviewer needs to be enabled for the repository.

#### Step 4: Wait for Review Results

Instead of counting reviews (which can give false positives due to early summary comments), **poll the GitHub Actions workflow run** for the Copilot code review to reach `completed` status.

**Strategy: Poll the "Copilot code review" workflow run status:**

First, get the PR's head SHA:
```bash
gh pr view <PR_NUMBER> --json headRefOid --jq '.headRefOid'
```

Then poll the workflow runs for that SHA using the GitHub Actions MCP tools:
- Use `github-mcp-server-actions_list` with `method: "list_workflow_runs"` to find runs matching the PR's head SHA.
- Look for a run with `name: "Copilot code review"` and the matching `head_sha`.
- Wait until `status === "completed"`.

Alternatively, poll via CLI:
```bash
gh api repos/<OWNER>/<REPO>/actions/runs \
  --jq '.workflow_runs[] | select(.name == "Copilot code review" and .head_sha == "<HEAD_SHA>") | .status'
```

**Polling strategy:**
1. After requesting the review, wait **10 seconds** for the workflow to be triggered.
2. Poll every **30 seconds** checking for the "Copilot code review" workflow run matching the PR's head SHA.
3. Wait until the run's `status` is `"completed"`.
4. Once completed, query review threads for unresolved comments (same as Step 2).
5. Timeout after **15 minutes** if the workflow doesn't complete.

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
2. Run the project's build and lint to verify no regressions.
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
  reply: addPullRequestReviewThreadReply(input: {
    pullRequestReviewThreadId: "<THREAD_ID>",
    body: "<EXPLANATION>"
  }) { comment { id } }
  resolve: resolveReviewThread(input: {
    threadId: "<THREAD_ID>"
  }) { thread { isResolved } }
}'
```

Reply format guidelines:
- Reference the commit SHA where the fix was made.
- Briefly describe what was changed and why.
- For non-issues, explain why no code change is needed.

**Batch multiple reply+resolve mutations into a single GraphQL call** for efficiency.

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

When a review cycle produces **zero new unresolved comments**, the loop is complete.

Report to the user:
- Total number of review rounds completed.
- Total number of issues fixed.
- Total number of comments resolved.
- Final status: all review threads resolved.

### Safety Rules

- **Check-in with user:** After every 15 consecutive review rounds, pause and ask the user if they'd like to continue or stop. This prevents runaway loops while not imposing a hard limit.
- **Build verification:** Always run build + lint after code changes, before pushing.
- **Don't fix unrelated issues:** Only address issues raised by the reviewer, not pre-existing problems.
- **Preserve commit history:** Use descriptive commit messages. Don't squash or amend previous commits.
- **Ask before large changes:** If a reviewer comment requires significant refactoring (>50 lines), confirm with the user first.

### GraphQL Reference

**Get unresolved review threads:**
```graphql
query {
  repository(owner: "$OWNER", name: "$REPO") {
    pullRequest(number: $PR) {
      reviewThreads(first: 50) {
        nodes {
          id, isResolved, isOutdated
          comments(first: 1) {
            nodes { body, path, line, author { login } }
          }
        }
      }
    }
  }
}
```

**Reply to thread and resolve:**
```graphql
mutation {
  addPullRequestReviewThreadReply(input: {
    pullRequestReviewThreadId: "$THREAD_ID",
    body: "$REPLY"
  }) { comment { id } }
  resolveReviewThread(input: {
    threadId: "$THREAD_ID"
  }) { thread { isResolved } }
}
```

**Request reviewer:**
```bash
gh pr edit $PR --add-reviewer "copilot-pull-request-reviewer"
```
