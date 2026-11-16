# Workflows

Workflows save a repeatable sequence of skills and nested workflows in a project. A chat agent
drives each run, and you can inspect or control it from the workflow canvas.

## Take the tour

The first time a device opens Tiller it offers **Take the 90-second tour**. The tour walks over a
built-in sample workflow, "Launch a landing page", with a loop, a weekday 09:00 schedule and a
credential. It costs nothing: the sample is read-only, no agent runs, and nothing in your projects
changes. **Watch demo run** plays a recorded run on the canvas, labelled **Demo**. **Save a copy**
adds the sample to a project you choose.

Replay it from **Settings → Tiller → Workflows → Tour** or the command palette (**Replay Tiller
tour**). The same section has **Show the tour on new devices**. Each device keeps its own choice.
On mobile, **Settings → Tiller → Replay intro** shows a three-card intro instead.

## Start from a template

In **Workflows**, filter **Source → Built-in**, or choose **New workflow from template…** in the
command palette. Open a template to preview its read-only canvas. Choose the destination project
and **Use template** to make an editable copy; future template updates do not change your copy.
On mobile, open a project's workflows and use the **Templates** section.

**Needs N skills · Install all** installs missing skills to **All projects** after you review their
audit results. Skills already installed under the same name are kept.

Scheduled templates offer a prefilled schedule after copying. Choose a driver chat and supply the
workflow inputs before saving. Cadence, carry-over and page rotation are suggested for you to
adjust. Cancelling leaves the workflow copy in your project and creates no scheduled task.

Choose **Hide** on a template to hide it on that server. **Show hidden**, then **Unhide**, restores
it. **Settings → Tiller → Workflows → Show built-in workflows** hides or restores the whole set.

## Workflow-first

Enable **Workflow-first** for a thread to have the agent check saved workflows before substantial,
multi-step work. It lists kept workflows for the project and proposes a reasonable Tiller canvas
workflow by name, waiting for your approval before running it. If none fits, it creates and runs one
for the task without asking for generic creation approval, using an appropriate available skill. The
work is represented in the Workflows canvas and driven through workflow tools; reading a skill's
ordinary instructions alone does not count as running a workflow. Existing workflow gates, credential
approvals, and destructive-action permissions still apply. Simple questions, jokes, and tiny edits get
a direct answer. The policy applies to the main agent only; delegated child work is exempt, and a
thread already running a workflow continues it without repeating the check.

Workflows the agent creates while Workflow-first is on are **scratch**: they are saved under
**From threads**, a collapsed group on the Workflows page and in the sidebar, kept apart from
workflows you saved yourself. Open the group to see them. Scratch workflows stay out of the agent's
saved-workflow matches. Choose **Keep** on one to move it into the regular saved list; keeping changes
only that grouping, and the workflow keeps its name, runs and schedules. Keeping is optional, and the
agent does not ask you to save after every task. **Settings → Workflows** sets the default for new
threads.

## Create and edit a workflow

Open **Workflows** for a project, then add a first step or open a saved workflow. Use the canvas
toolbar to add a step or note. The `+` between work groups inserts a step there; the `+` after a
group appends one. Select a skill or nested workflow to edit it.

In edit mode, drag any card (a step, an approval gate, a check, a note, or a resource) to arrange
the canvas. Arranging never changes execution order or dependencies. **Tidy up** in the `⋯` menu
returns every card to automatic layout.

To add a dependency, drag a step's connector onto another step. The later step reads the earlier
step's output. Extra reads appear as dashed arcs above the flow (to the right in a narrow panel).
Select an arc to inspect the reading step; remove it with its × or the **Reads from** chip in the
inspector. Insert-step `+` controls appear only between consecutive steps.

Select a skill and choose **Add check** to validate its output. Checks belong to that skill and
run before dependent steps can start. A failed check returns the skill to the agent for repair; a
run allows up to three work attempts before it fails. Select a target step to require approval
before it can start. The agent proceeds only after you explicitly approve it in the conversation
or from the run controls.

## Loops

To repeat a range of steps until a reviewer or check passes, drag a later step's connector back
onto an earlier step and choose **Make a loop**, or open the later step's **Loop back** section in
the inspector. A feedback arc appears beneath the cards (to the left in a narrow panel). Loops
must nest or stay separate and cannot cross one another; a workflow can define up to five loops.

Configure each loop with:

- **Repeat from**: the earlier step where each new round starts.
- **Max rounds**: the maximum number of rounds (`1–20`).
- **Stop when**:
  - **This step says pass**: the closing step writes `VERDICT: pass` or `VERDICT: revise — <reason>`
    in its summary (omitting a verdict line counts as `pass`).
  - **Checks pass**: all checks on the closing step succeed.
  - **Condition passes**: the closing step evaluates your condition text and writes `VERDICT: pass`
    or `VERDICT: revise — <reason>`.
- **Send feedback to target step**: appends the closing step's round summary, failed checks, and
  outputs to the target step's prompt on the next round.

If a loop reaches `maxRounds` without satisfying its condition, the step is marked with a warning
and the workflow continues past the loop using the last round's output. An approval gate inside a
loop pauses for approval again on each round. Each step inside a loop keeps its completed round
summaries and outputs under **Previous rounds** in the step details.

Select a skill or nested workflow and choose **Add resource** in the editor header, then choose a
requirement, service login, MCP connection, or credential. **Check readiness** checks the selected step's
resources in the active chat's server-side workspace when that chat is available. From the
standalone project page, it uses a known project chat when one is available, otherwise the project
context. MCP setup may remain
**Unknown** or **not verified**; configuration alone does not prove a connection works. Workflow
resource cards do not store passwords or API tokens. A step that needs a secret can attach a
credential from the vault instead; see [Credentials](./credentials.md).

You can also open **Resources** from the header or a canvas `+` picker to attach a resource without
adding a step. The picker starts with the selected step or the step before that insertion point;
choose another owner if needed.

For an MCP resource, choose a connection reported by the step's selected provider, then add it to
the step. The picker shows the provider's reported connection and sign-in status, plus tool details
when available. Use **Refresh** to ask the step's provider instance for a current inventory. When
that instance has no chat running, T3 reads its own read-only MCP configuration instead, which
lists server names only: status stays **Unknown** and tools are unavailable until a chat runs on
that provider. Some providers share the same MCP connections across models. If a provider has no
readable inventory source, you can enter a known server name manually. This records a requirement
only: it does not configure a server URL or command, sign you in, or store credentials.

Add notes from the canvas toolbar for context that should be visible to the agent but should not
run or block a step. Manual edits and changes made by the main chat agent update the same saved
workflow.

To delete a workflow, choose **Delete workflow…** from its `⋯` menu on the Workflows page or in
the sidebar. That removes the file from the project's `.t3/workflows` folder and deletes its
schedules; past runs stay in history. A run that is already in progress keeps going, but the
workflow cannot be started again afterward.

## Find, pin and tag workflows

Open **Workflows** to browse the gallery. Search by name, brief, project or tag, and use the filters
to narrow by tags, project, running or scheduled status. Selected tags match any of those tags;
filters from different groups combine. Sort by recent activity, name, run count or steps.
**Grid** and **List** are remembered on this client. On narrow panels, open **Filters** to see the
same controls. Otherwise drag the edge of the filter panel to resize it, or focus that edge and use
the arrow keys; double click resets the width. The width is remembered on this client as well.

Pin a workflow from its card or action menu to keep it above the other workflows and first in the
sidebar. Pins are specific to the project and server. Unpin from the same controls; deleting a
workflow removes its pin. Automatically saved workflows stay collapsed under **From threads**
until you open the group or search for them. Choose **Keep** to promote one into your workflows.

Use the command palette’s **Open workflow…** to find a workflow by name or tag, then open its
canvas. Pinned workflows appear first in the sidebar, including ones with an active run.

On mobile, open a chat’s **Workflows** view to see the project’s saved workflows. Tap a tag chip
or choose a tag filter to narrow the list; **All tags** clears the filter. **Pin** and **Unpin**
update the same server preferences as web and desktop, and are available when your connection
allows workflow edits. Pinning works even when a workflow has no chat to open. Editing tags
remains available in the web and desktop workflow settings.

The card menu also lets you duplicate a workflow, edit its tags or delete it. If a workflow needs
skills, choose **Install** to review and install them through skills.sh.

Open a workflow’s settings to add or remove tags. Type a tag and press Enter or choose Add;
suggestions include common tags and tags already used on this server. Tags travel with the workflow
file. Each workflow can have up to six tags of 24 characters, using letters, digits and hyphens;
letters are saved in lowercase.

Agents can read tags and pin status with `workflow_list`, replace tags with `workflow_tags_set`,
and pin or unpin with `workflow_pin_set`. Pins belong to this server and project and stay outside
the workflow file.

## Run and review

Choose **Run** and select the chat that should drive the workflow. The run opens in that chat, and
the main agent decides how to complete or delegate each ready skill. In Start settings or the
header chip, choose one or more **Subagent models** with the same model picker used in chat; hold
Shift while selecting to keep the picker open and choose several. The main model picks among those
models for each delegated step, while a model set on an individual step takes precedence.

If a chosen model is unavailable on this machine, the run uses the other available choices. If none
are available, the agent decides which model to use. The workflow file keeps your choices, so a
shared workflow can use them on another machine where those models are available. You can set the
maximum number of choices in **Settings → General → Workflows**; the default is 4.

The run timer shows elapsed time on the canvas, in the sidebar, and on mobile. To keep useful skills
near the top, pin them from the skill finder or the **+** picker. Pins belong to the server and
appear first for every project on that server.

If a check fails, the agent can inspect the result and repair the owning skill. Approval remains
your decision.

Completed runs keep their original definition, outputs, checks, approvals, and readiness snapshot.
To change the saved workflow for future runs, choose **Edit future version**. That does not change
the definition or results pinned to an existing run.

On mobile, saved runs support viewing details and text outputs, approving, resuming, and stopping.
A run also shows each step's credentials and their status, read-only. The mobile view does not
provide the web canvas editor or rich output previews.

## Find and install skills

When a workflow can’t run because skills are missing, use **Install all** to install its template’s
skills or exact-name matches from skills.sh to **All projects**. Unresolved names stay listed.
Use **Find skills** to look for alternatives on the connected computer, then on skills.sh. Review
and select proposals before choosing **Install & link**; different names update the affected steps.
The same actions are available for an individual missing step. **Link another** searches both
installed skills and skills.sh.

Open **Settings → Tiller → Skills**, choose **Find a skill…** in the command palette,
or use **Browse skills.sh** in a step's skill picker. Search the directory, then preview a
skill to review its instructions, files, GitHub commit and available security audits.
A missing audit is not a safety guarantee. Skills with scripts show a warning because
an agent may run those scripts later.

Confirm installation to **All projects** on the connected environment, or select
**This project only** when browsing from a project. Installing downloads files without
running code. Mobile also supports search, preview and installation on the connected
environment. Domain sources open on skills.sh instead of installing.

Use **Refresh installed and requests** to see tracked skills and requests from agents.
An agent's `skills_install` tool only previews and queues a request; you confirm the
installation here. Requests expire after ten minutes or a server restart.

**Check for updates** resolves the latest commit and opens a preview when an update is
available. Review it, then replace the tracked skill. You can change the install name
to keep another copy. Uninstall asks for confirmation and only removes skills tracked
by Tiller. Hand-made skills cannot be replaced or removed through this browser.

The directory and GitHub requests come from the connected environment. Tiller caches
directory responses for ten minutes, sends no installation telemetry, and limits each
skill to 200 files and 5 MB.

## Triggers and schedules

The Start card lists Manual, scheduled and webhook triggers, including disabled triggers.
Choose **+ Trigger** or the header clock to manage them. Manual runs remain available even
when all automatic triggers are disabled. Mobile lists triggers and can enable, disable or
run a schedule now; edit its configuration on web or desktop.

Choose an hourly, daily or weekday preset, or set a custom interval or weekday/time combination.
Each schedule has its own input values. `{{date}}` resolves to the current date and
`{{run.number}}` to that schedule's next workflow run number. Saved timer previews use the
server's timezone. The server and driving chat must be available for scheduled runs.

Under **More knobs**, restrict starts to a time window, end after a number of runs, or choose
what happens while a run is active: skip, queue one, or start anyway. Queue one coalesces
multiple fires until the active run finishes. Enable **Carry over the last result** to include the
previous finished run's final step summary and outputs in the next run's brief and expose
`{{last.result}}` in input templates, step notes, and skill text. Use **Rotate an input through a
list** to cycle a workflow input through a list of values on each scheduled fire. Pausing a
schedule prevents future fires; it does not stop an active run. Delete removes the trigger.

### Continuous-improvement recipe

To build a scheduled workflow that improves a codebase area by area over time while refining each
round before moving on:

1. Add a workflow input such as `area` (`Billing`, `Onboarding`, `Search`, `Notifications`).
2. Create three steps: `audit`, `improve`, and `verify`, then add a **Loop back** from `verify` to
   `improve` with `maxRounds: 3` and **Stop when** set to **This step says pass** (or **Checks
   pass**). Reference `{{last.result}}` in `audit`'s note so each run builds on the previous run's
   findings.
3. Open **+ Trigger**, choose a daily or weekly schedule, open **More knobs**, enable **Carry over
   the last result**, and set **Rotate an input through a list** on `area` with your target areas.
   Each scheduled run picks the next area in rotation, passes the previous finished run's result as
   `{{last.result}}`, and iterates inside the `improve → verify` loop until checks pass.

Webhook schedules provide a URL to copy, token rotation, and recent deliveries. Rotating
invalidates the previous URL. **Send test** passes an unsigned JSON payload through the same
verification and filtering pipeline; signed endpoints report a rejected signature. Existing webhook signature, filtering and delivery settings
are available under **Webhook security and runtime…** or through agent tools; use `request_secret` for
signing secrets.

An **After workflow** trigger starts after another workflow in the same project succeeds or
finishes. Disable it temporarily or remove it to break the connection. Cycles and chains
longer than two connections are rejected. Each finished source run starts a target at most once.

A step's **Wait before** setting delays it after its dependencies finish. Agents can also set
an `until` time with selected weekdays. Timed waits survive server restarts. **Start now**
skips a timed wait; **Stop run** prevents it from resuming. Approval gates remain separate.

Agents can use `workflow_schedule_put`, `workflow_schedule_list`, `workflow_trigger_put`,
`workflow_trigger_delete`, `workflow_loop_put`, `workflow_loop_delete`, and `workflow_step_put`
with `waitBefore` to manage these settings.
