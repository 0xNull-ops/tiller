# FORK.md: this repo vs upstream T3 Code

Tiller started as a fork of [T3 Code](https://github.com/pingdotgg/t3code) (MIT) and is now maintained as an independent open-source project. It adds **Workflows**: a canvas of skill steps that a chat thread's agent drives, delegating to subagents, and a **Credential vault**: per-environment credentials that agents and workflows use without the value entering a chat, a file in git or model context. Everything that makes it differ from upstream is recorded here, so an occasional manual upstream merge stays routine. The `fork(...)` seam markers below keep that possible. On the desktop app, Touch ID, Windows Hello or polkit can stand in for typing the vault PIN; that shell-side storage is fork-owned and the server still verifies every unlock.

## Identity

The product is **Tiller** (formerly Shipyard). Replaced brand assets are documented in [`apps/web/src/fork/assets/README.md`](apps/web/src/fork/assets/README.md). The repo folder, branch prefixes and `shipyard*` internal helper names may stay.
Feedback and triage file into the public repository `Antler-Web-Studios/tiller`.

- Sidebar identity: theme-specific Tiller wordmarks and mark SVGs.
- App identity: Tiller PNG, ICO, ICNS, and iconset assets; web favicon and touch icons.
- Removed: the old Möbius mark artwork.

**Read this before you edit any file that came from upstream, or before you merge upstream.**

|             |                                                                                    |
| ----------- | ---------------------------------------------------------------------------------- |
| Repository  | `Antler-Web-Studios/tiller` (public). Work happens on `main`.                      |
| Upstream    | `upstream` = `github.com/pingdotgg/t3code`, branch `main`. Push to it is disabled. |
| Status tool | `node scripts/fork-seams.ts`, with `--check`, `--drift` and `--write` (see below). |

## The rule

Upstream changes fast: hundreds of commits a week, and its biggest files change almost daily. So every line we change in an upstream file is a merge conflict waiting to happen. Fork work lives in **files upstream doesn't have**. Upstream files only get **seams**, which are small, marked hooks that call into our files.

Place seams at stable anchors such as list tails, a single spread or union member, or one call. Never put them inside upstream import blocks or mid-list.
New fork features register in the fork aggregators (`apps/server/src/fork/…`, `packages/contracts/src/forkRpc.ts`, `apps/server/src/fork/mcpToolkits.ts`, and web/mobile `fork/settings`), never in upstream files.

`node scripts/fork-seams.ts --check` enforces the marker half of that rule. It also names any upstream file carrying more than about 20 fork lines, as advice rather than a failure: that file has outgrown a seam, so move the logic into an owned file.

## Three kinds of divergence

### 1. Owned files (preferred)

New files in folders upstream doesn't have. They never conflict. The owned folders:

<!-- fork-owned:start -->

- `apps/desktop/src/fork/`: desktop integration helpers, including isolated release-test profiles.

- `scripts/lib/fork-launch-config.ts`: launch release configuration filtering.
- `packages/shared/src/fork/launch.ts`: launch privacy flag.

- `scripts/dmg/`: unattended DMG layout and reproducible branded artwork.

- `scripts/homebrew/`: Tiller cask release template.

- `docs/operations/tiller-release.md`: maintainer Mac release procedure.
- `scripts/fork-release*`: Mac release driver, independent version, signing entitlements and public notes.

- `apps/web/src/fork/builtins/`: gallery adapters, read-only previews, template copying and batch skill installation
- `apps/mobile/src/fork/builtins/`: project templates and schedule-editor integration
- `packages/client-runtime/src/state/workflowTemplates.ts`: guarded template RPC commands for both clients
- `packages/shared/src/fork/builtins/`: read-only workflow template definitions and derived plan metadata
- `packages/contracts/src/workflowTemplates.ts`: workflow template listing and copy contracts

- `apps/server/src/workflows/`: the workflow engine, its store, skills and RPC handlers
- `apps/server/src/workflows/WorkflowFirst.ts`, `WorkflowFirst.test.ts` and `workflowFirstInstructions.ts`: per-thread Workflow-first state and provider policy text
- `apps/server/src/credentials/`: the credential vault: vault key, store, unlock, history, redaction and RPC handlers
- `apps/server/src/mcp/toolkits/credential/`: credential agent tools and registration
- `apps/server/src/mcp/toolkits/workflow/`: the agent tools (`workflow_*`)
- `apps/web/src/workflows/`: the canvas, panels and editors
- `apps/mobile/src/workflows/`: saved workflow run viewing and controls
- `docs/user/workflows.md`: the workflow user guide
- `docs/user/credentials.md`: the credential vault user guide
- `apps/web/src/routes/_chat.workflows.index.tsx`: workflows home page route (`/workflows`)
- `apps/web/src/routes/_chat.workflows.$environmentId.$projectId.$slug.tsx`: standalone workflow canvas route
- `apps/web/src/fork/`: branding configuration, wordmark, static shell/manifest plugin and accent stylesheet
- `apps/web/src/fork/tour/`: the first-run tour: coach-mark engine, bundled sample workflow, recorded demo run, read-only scheduler preview and Replay entry points
- `apps/web/src/routes/_chat.workflows.sample.tsx`: the read-only sample workflow route (`/workflows/sample`)
- `apps/mobile/src/fork/tour/`: the mobile 3-card intro sheet and its per-device state
- `packages/contracts/src/workflow.ts`: the shared workflow schemas
- `packages/contracts/src/forkRpc.ts`: the fork RPC method names and `Rpc.make` definitions, spread into `rpc.ts`
- `apps/server/src/auth/RpcAuthorization.fork.test.ts`: credential scope checks kept out of upstream's test file
- `packages/client-runtime/src/state/commandPermissions.fork.test.ts`: workflow and credential command permission checks kept out of upstream's test file
- `packages/contracts/src/workflow.test.ts`: workflow definition compatibility checks
- `packages/contracts/src/workflowSchedule.ts`: shared workflow schedule binding and prompt
- `packages/contracts/src/workflowSchedule.test.ts`: schedule ownership checks
- `packages/contracts/src/workflowCanvasColors.ts`: the canvas attachment colours a user picks, stored in client settings
- `packages/contracts/src/workflowCanvasColors.test.ts`: canvas colour validation and the fallback for an unreadable stored value
- `packages/contracts/src/credential.ts`: the shared credential schemas
- `packages/contracts/src/credential.test.ts`: credential schema checks
- `packages/shared/src/credentialTemplates.ts`: the credential template catalogue and `.env` parsing
- `packages/shared/src/credentialTemplates.test.ts`: template and `.env` parser checks
- `packages/provider-core/src/server/workflowMcpInventory.ts`: shared live MCP inventory types
- `packages/provider-opencode/src/server/workflowMcpInventory.ts`: OpenCode live MCP inventory normalizers
- `apps/web/src/credentials/`: credential brand icons, the monogram fallback and the icon picker, plus the Settings → Credentials manager
- `apps/desktop/src/credentials/`: the desktop shell's OS unlock (Touch ID, Windows Hello, polkit), the encrypted PIN store and its prompt adapters
- `apps/desktop/src/ipc/methods/credentialOsUnlock.ts`: the one IPC method that serves the OS unlock bridge
- `apps/web/src/routes/_chat.settings.credentials.tsx`: the Credentials settings route
- `apps/web/src/routes/_chat.settings.workflows.tsx`: the Workflows settings route
- `apps/web/scripts/generate-credential-brand-index.ts`: regenerates the brand index from simple-icons
- `packages/shared/src/credentialBrand.ts`: brand matching and glyph-contrast rules shared by web and mobile
- `packages/shared/src/credentialBrandIndex.ts`: the generated brand list (slug, title, hex, aliases)
- `packages/shared/src/credentialBrand.test.ts`: brand matching and contrast checks
- `packages/shared/src/credentialPresentation.ts`: credential status and history copy shared by web and mobile
- `packages/shared/src/credentialPresentation.test.ts`: status tone and history label checks
- `packages/shared/src/workflowElapsed.ts`: the run timer label (`Running 4:12`, `Took 14:02`) and duration format shared by web and mobile
- `packages/shared/src/workflowElapsed.test.ts`: timer format and label checks
- `packages/shared/src/workflowScratch.ts`: the "From threads" scratch split and origin thread shared by web and mobile
- `packages/shared/src/workflowScratch.test.ts`: scratch grouping checks
- `packages/shared/src/workflowSubagents.ts`: subagent model resolution shared by the server and both clients
- `packages/shared/src/workflowSubagents.test.ts`: resolver checks: exact and same-driver matches, every missing reason, dedupe
- `apps/mobile/src/features/credentials/`: credential list and history, live approval cards and PIN unlock
- `scripts/fork-seams.ts`: this file's status tool
- `scripts/lib/fork-seam-rules.ts`: the seam-size advisory the status tool prints
- `scripts/fork-seams.test.ts`: checks for that advisory
- `scripts/fork-brand-assets.test.ts`: regression for upstream icon generation vs Tiller packaging copies
- `packages/client-runtime/src/credentials/`: shared credential live subscription and activity derivations
- `packages/client-runtime/src/workflows/`: client launch forwarding checks for the draft Workflow-first choice
- `apps/server/src/fork/`: fork service aggregators, RPC and MCP registrations, skills.sh and triage
- `apps/mobile/src/fork/settings.ts` and `apps/mobile/src/fork/settingsScreens.ts`: mobile Tiller settings targets, search terms and route registrations
- `apps/mobile/src/fork/viteConfig.ts`: the mobile credential screens included in the React test project
- `apps/server/src/fork/mcpToolkits.ts`: credential and workflow MCP toolkit registrations
- `evals/mcp-tool-use/cases/workflows.ndjson`, `evals/mcp-tool-use/workflows.fork.ts` and `evals/mcp-tool-use/workflows.fork.test.ts`: workflow MCP tool-use eval cases and grader checks
- `packages/shared/src/fork/feedback.ts`: the public feedback repository, its issue forms and the only facts the app may prefill
- `packages/shared/src/fork/feedback.test.ts`: those facts and URL checks
- `apps/desktop/src/fork/`: opening the prefilled feedback issue from the main process, where the OS version and architecture are known
- `apps/web/src/fork/feedback/`: the Send feedback action, its Settings section and its command palette entries
- `apps/server/src/fork/triage/`: the Tiller triage playbook and the public repository it files into

<!-- fork-owned:end -->

A new owned folder goes in that list. Otherwise the status tool reports its files as strays.

Fork-added dependency: `simple-icons` (CC0-1.0), a dependency of `apps/web` only. Every
brand glyph is its own lazy chunk, and the title/slug/alias index is generated into
`packages/shared/src/credentialBrandIndex.ts` by `vp run --filter @t3tools/web
credentials:brand-index`, so no icon path data is imported at runtime. `apps/web` and
`packages/shared` package.json edits carry a `fork(credentials)` marker.

### 2. Seams: marked edits to upstream files

When upstream code must call ours, edit the upstream file as little as possible and mark it:

- **The marker:** put `// fork(<feature>)` on the edited line, or on a comment line directly above a small block. For example, `fork(workflows)`; later `fork(brand)`. Use `{/* fork(workflows) */}` in JSX.
- **Add, don't change.** Inserting a line next to upstream's survives their edits. Changing their line conflicts every time they touch it. When you must change an upstream line, keep the change to one line.
- **Keep the seam a call.** The logic belongs in an owned file; the seam only imports it and calls it. Example: `ws.ts` calls `WorkflowRpc.mergeInto(...)` instead of holding seven handlers.
- **Never** edit `apps/server/src/orchestration-v2/Orchestrator.ts`, and never add migrations to `apps/server/src/persistence/Migrations.ts`. The workflow store is JSON files on purpose.
- **Very busy files:** `apps/web/src/components/Sidebar.tsx` (5,100 lines, about 70 upstream commits a month) and `ChatView.tsx` each get **at most one** seam, which renders an owned component.

Edits to upstream files that can't carry a marker (Markdown) are allowed only when listed here with a reason:

<!-- fork-unmarked:start -->

- `third-party-licenses.config.json`: ships the full upstream MIT notice in desktop and web bundles.
- `apps/web/tsconfig.json`: includes the fork launch build configuration helper.

- `docs/user/appearance.md`: scene theme, Theme Studio and ambient effect guidance sits on the Appearance page users already open to change themes; Markdown cannot carry a `fork(...)` marker.
- `docs/user/background-service.md`: launch user guidance for Tiller identity, data and supported connections.
- `docs/user/composer.md`: launch user guidance for Tiller identity, data and supported connections.
- `docs/user/devices.md`: launch user guidance for Tiller identity, data and supported connections.
- `docs/user/install.md`: launch user guidance for Tiller identity, data and supported connections.
- `docs/user/keybindings.md`: launch user guidance for Tiller identity, data and supported connections.
- `docs/user/project-settings.md`: launch user guidance for Tiller identity, data and supported connections.
- `docs/user/remote-access.md`: launch user guidance for Tiller identity, data and supported connections.
- `docs/user/source-control.md`: launch user guidance for Tiller identity, data and supported connections.
- `.github/triage/PLAYBOOK.md`: the triage playbook upstream keeps byte-identical to `TRIAGE_PLAYBOOK`; it names Tiller's public repository and its redaction rules. The text lives in `apps/server/src/fork/triage/tillerTriagePrompt.ts`, and Markdown cannot carry a `fork(...)` marker.

- `AGENTS.md`: one appended line telling Codex agents, which read `AGENTS.md` and not `CLAUDE.md`, to read this file.
- `.github/workflows/ci.yml`: Tiller CI runs on GitHub-hosted runners without upstream's runner labels, task cache or apt mirrors. It is a standalone CI file, not a seam.
- `.github/actions/setup-ci-deps/action.yml`: drops the task-cache step and its secret input, which only served upstream's CI.
- `.github/actions/ci-changes/action.yml`: drops the release-smoke output along with its removed job.
- `.github/scripts/ci-changes.cjs`: drops the release-smoke output and the script-change flag that only it read.
- `.github/scripts/ci-changes.d.cts`: the matching type for that output.
- `scripts/check-changed.ts`: drops the release-smoke line from the CI summary.
- `package.json`: drops the `release:smoke` script, which pointed at the removed release smoke test. JSON cannot carry a `fork(...)` comment.
- `apps/web/src/routeTree.gen.ts`: generated by TanStack Router when owned workflow routes are added; regenerated on merge, never hand-edited.
- `pnpm-lock.yaml`: generated by pnpm; the credentials slice adds `simple-icons` there, and no marker survives a regeneration.
- `packages/shared/package.json`: subpath exports for the fork-owned credential template catalogue, brand matcher and status copy, the subagent model resolver and the run timer label. JSON cannot carry a `fork(...)` comment.
- `packages/client-runtime/package.json`: subpath exports for fork-owned client commands. JSON cannot carry a `fork(...)` comment, so the top-level `//` metadata carries the marker.
- `README.md`: rewritten for Tiller as a standalone open-source project.
- `CONTRIBUTING.md`: Tiller's own contribution guide.
- `LICENSE`: adds the Tiller copyright line; the T3 Tools line is kept.
- `docs/README.md`: the docs index points Release at the Tiller release procedure.

<!-- fork-unmarked:end -->

### 3. Replaced files (for UI changes too big for a seam)

When a component needs more than a seam, for example in the planned rebrand, **copy it into `apps/web/src/fork/`** and change the copy. Then switch the import to our copy with one seam where it's used. Upstream's original stays in place, untouched and unused, so syncs never conflict on it.

- **Header line** at the top of the copy: `// fork(replaces): apps/web/src/components/Foo.tsx @ <upstream commit>`. The commit is the upstream commit the copy was taken from.
- **Cost:** upstream's later fixes to the original don't arrive by themselves. `node scripts/fork-seams.ts --drift` lists the upstream commits that touched each original since its base commit. Port what matters, then bump the commit in the header.
- **Replace whole components, not half-files.** Prefer swapping at the route or layout level.

### Frozen areas

Upstream features we deliberately don't follow, each with a reason. None yet.

## Merging upstream by hand

Upstream merges are manual and occasional. Nothing merges upstream automatically.

1. `git fetch upstream`, then merge `upstream/main` into a branch, never directly into `main`.
2. Resolve conflicts by keeping upstream's structure and re-adding the fork change as one seam at a stable anchor, or by moving fork logic into an owned file.
3. Regenerate `apps/web/src/routeTree.gen.ts` and `pnpm-lock.yaml` when they change. Never hand-merge them.
4. Run `node scripts/fork-seams.ts --check`, `--drift` for replaced files, and `vp run check:changed`.
5. Re-check the Known gotchas below, then refresh the inventory with `node scripts/fork-seams.ts --write`.

## Name clash: upstream's own "workflows" are a different feature

- **What they are.** Upstream T3 shows **Claude Code's built-in multi-agent workflows**. When Claude runs a big task (e.g. "ultracode"), Claude Code writes a throwaway JavaScript script that splits the work into phases and agents. T3 reads Claude's `workflow_progress` messages and shows those phases and agents in the Lineage panel.
- **Where to find it.** In upstream's code:
  - `apps/server/src/orchestration-v2/Adapters/claudeWorkflowProgress.ts`
  - `workflowScriptQuery.ts`
  - `apps/web/src/components/chat/WorkflowOpeningBlock.tsx`
  - the `t3_workflow_stop` MCP tool, which stops one of those Claude runs
- **History.** Added Aug 6 (#5219, subagent and workflow tracking) and Oct 11 (#12598, phases and agents in Lineage). Both predate our work.

|                  | Upstream (Claude Code workflows)        | Ours (Workflows)                              |
| ---------------- | --------------------------------------- | --------------------------------------------- |
| Who makes it     | Claude improvises a script for one task | The user or agent saves it as a reusable file |
| Repeatable       | No, thrown away after the task          | Yes, run again or on a schedule               |
| Built from       | Code Claude writes                      | The user's skills                             |
| Providers        | Claude only                             | Any (Codex, Claude, OpenCode…)                |
| Gates and checks | None                                    | Approval gates, file/command checks           |
| Canvas           | Read-only list in Lineage               | Live canvas that builds and runs              |

**What this means for you:**

- Our tool descriptions say "saved T3 workflows in `.t3/workflows`" so agents don't confuse our `workflow_*` tools with `t3_workflow_stop`. Keep it that way.
- When merging upstream, skim upstream's changelog for anything about saved or repeatable workflows, skills or schedules. If upstream starts building what we have, flag it to the user early. We'd want to adopt their version or align with it rather than keep diverging.

## Known gotchas

- **Draft workflow kickoff mirrors upstream first-send setup.** `apps/web/src/workflows/draftWorkflowKickoff.ts` mirrors the `createThread` / `prepareWorktree` / `runSetupScript` bootstrap in `onSend`, which now lives in `apps/web/src/components/chat/useComposerSend.ts`. `ChatComposerHandle` exposes no send method. Re-check this copy against that bootstrap on every upstream merge.

- **The WebSocket RPC group is at a type-checker limit.** tsc-rs silently loses the handler layer's requirements type once one `group.of({...})` handles more than about 201 RPCs. It surfaces as `any` in the CLI's requirements, in `binCli.ts` and `cli/*`. That's why workflow handlers live in their own layer, `apps/server/src/workflows/workflowRpc.ts`, and credential handlers in `apps/server/src/credentials/credentialRpc.ts`, both merged next to upstream's. Never add either set of handlers to `ws.ts`. `WorkflowRpc.baseGroup` omits both sets from the base group, and upstream's split `SplitWsRpcGroup` / `OtherWsRpcGroup` now derive from that same base group; a third fork-owned RPC group has to be omitted there too. If the error returns after a sync with no new fork RPCs, upstream alone has passed the limit.
- **Upstream's RPC-layer test (`ws.test.ts`) mocks every service.** A new service our handlers need must be mocked there too, through a seam.
- **Machine-specific server test failures on macOS:** upstream's, and the same on pristine upstream. Linux does not show them. The causes are `/var` vs `/private/var` temp paths, global npm/launcher detection, and timeouts under full-suite load.
- **Web lint is strict, and upstream is at 0 errors.** It bans:
  - arbitrary Tailwind values (`text-[11px]`)
  - restyling ui primitives
  - `title=` tooltips
  - manual `useMemo`/`useCallback` (the React compiler is on)
  - reading a prop named `…Ref` during render (destructure it)
- **The generated route tree.** New routes add owned route files, but `routeTree.gen.ts` changes. On a merge, regenerate it; never hand-merge.

## Inventory

<!-- fork-inventory:start -->

_Generated by `node scripts/fork-seams.ts --write` against `upstream/main` @ `5b818b3e69`. Don't edit by hand._

**223 upstream files edited, 504 seams. 632 fork-only files. 0 replaced files.**

| Upstream file                                                                | Lines vs upstream | Markers                                  |
| ---------------------------------------------------------------------------- | ----------------- | ---------------------------------------- |
| `.github/actions/ci-changes/action.yml`                                      | +0 −2             | none, allowed                            |
| `.github/actions/setup-ci-deps/action.yml`                                   | +1 −22            | none, allowed                            |
| `.github/scripts/ci-changes.cjs`                                             | +0 −4             | none, allowed                            |
| `.github/scripts/ci-changes.d.cts`                                           | +0 −1             | none, allowed                            |
| `.github/triage/PLAYBOOK.md`                                                 | +55 −64           | none, allowed                            |
| `.github/workflows/ci.yml`                                                   | +15 −77           | none, allowed                            |
| `AGENTS.md`                                                                  | +2 −0             | none, allowed                            |
| `apps/desktop/src/app/DesktopApp.test.ts`                                    | +6 −0             | 2 (credentials)                          |
| `apps/desktop/src/app/DesktopAppIdentity.test.ts`                            | +6 −5             | 3 (launch, workflows)                    |
| `apps/desktop/src/app/DesktopAppIdentity.ts`                                 | +1 −3             | 1 (launch)                               |
| `apps/desktop/src/app/DesktopAssets.ts`                                      | +12 −23           | 2 (workflows)                            |
| `apps/desktop/src/app/DesktopClerk.test.ts`                                  | +21 −21           | 1 (launch)                               |
| `apps/desktop/src/app/DesktopCliCommand.test.ts`                             | +50 −46           | 1 (launch)                               |
| `apps/desktop/src/app/DesktopCliCommand.ts`                                  | +4 −4             | 4 (launch)                               |
| `apps/desktop/src/app/DesktopCliShim.test.ts`                                | +5 −1             | 1 (launch)                               |
| `apps/desktop/src/app/DesktopCliShim.ts`                                     | +4 −3             | 3 (launch)                               |
| `apps/desktop/src/app/DesktopEnvironment.test.ts`                            | +17 −2            | 2 (workflows, launch)                    |
| `apps/desktop/src/app/DesktopEnvironment.ts`                                 | +6 −4             | 4 (workflows, launch)                    |
| `apps/desktop/src/app/DesktopLegacyLocalStorage.ts`                          | +2 −1             | 2 (launch)                               |
| `apps/desktop/src/app/DesktopLifecycle.test.ts`                              | +2 −2             | 1 (launch)                               |
| `apps/desktop/src/app/DesktopLinuxUrlHandler.test.ts`                        | +8 −8             | 1 (launch)                               |
| `apps/desktop/src/app/DesktopPreReadyPlatform.test.ts`                       | +2 −2             | 1 (workflows)                            |
| `apps/desktop/src/app/DesktopStartupRecovery.ts`                             | +1 −1             | 1 (launch)                               |
| `apps/desktop/src/app/DesktopStatePaths.ts`                                  | +3 −2             | 1 (launch)                               |
| `apps/desktop/src/app/DesktopUserData.test.ts`                               | +5 −3             | 1 (launch)                               |
| `apps/desktop/src/app/DesktopUserData.ts`                                    | +6 −0             | 3 (launch)                               |
| `apps/desktop/src/electron/ElectronProtocol.test.ts`                         | +16 −15           | 1 (launch)                               |
| `apps/desktop/src/electron/ElectronProtocol.ts`                              | +2 −2             | 2 (launch)                               |
| `apps/desktop/src/ipc/channels.ts`                                           | +1 −0             | 1 (credentials)                          |
| `apps/desktop/src/ipc/DesktopIpcHandlers.ts`                                 | +3 −0             | 2 (credentials)                          |
| `apps/desktop/src/main.ts`                                                   | +4 −0             | 2 (credentials)                          |
| `apps/desktop/src/preload.ts`                                                | +3 −0             | 1 (credentials)                          |
| `apps/desktop/src/window/DesktopApplicationMenu.test.ts`                     | +24 −0            | 1 (launch)                               |
| `apps/desktop/src/window/DesktopApplicationMenu.ts`                          | +23 −0            | 4 (launch)                               |
| `apps/desktop/src/window/DesktopWindow.test.ts`                              | +12 −12           | 1 (launch)                               |
| `apps/desktop/src/wsl/DesktopWslEnvironment.test.ts`                         | +5 −4             | 1 (launch)                               |
| `apps/desktop/src/wsl/DesktopWslEnvironment.ts`                              | +6 −3             | 3 (launch)                               |
| `apps/desktop/tsconfig.json`                                                 | +8 −1             | 3 (launch, workflows)                    |
| `apps/desktop/vite.config.ts`                                                | +4 −0             | 4 (launch)                               |
| `apps/mobile/app.config.test.ts`                                             | +2 −2             | 1 (launch)                               |
| `apps/mobile/src/App.tsx`                                                    | +2 −0             | 2 (tour)                                 |
| `apps/mobile/src/features/home/HomeScreen.tsx`                               | +9 −0             | 4 (credentials)                          |
| `apps/mobile/src/features/settings/components/settings-page-targets.ts`      | +3 −0             | 1 (settings)                             |
| `apps/mobile/src/features/settings/components/SettingsRow.tsx`               | +3 −2             | 1 (settings)                             |
| `apps/mobile/src/features/settings/OutdatedServerUpdateSection.tsx`          | +1 −1             | 1 (environment-update-check)             |
| `apps/mobile/src/features/settings/scheduled-task-editor-state.test.ts`      | +31 −1            | 1 (builtins)                             |
| `apps/mobile/src/features/settings/scheduledTaskDraft.ts`                    | +3 −0             | 3 (builtins)                             |
| `apps/mobile/src/features/settings/settings-search.ts`                       | +2 −0             | 1 (settings)                             |
| `apps/mobile/src/features/settings/SettingsEnvironmentDetailRouteScreen.tsx` | +1 −1             | 1 (environment-update-check)             |
| `apps/mobile/src/features/settings/SettingsNotificationsRouteScreen.tsx`     | +1 −1             | 1 (mobile-permission-status)             |
| `apps/mobile/src/features/settings/SettingsRouteScreen.tsx`                  | +2 −0             | 1 (settings)                             |
| `apps/mobile/src/features/settings/SettingsScheduledTasksRouteScreen.tsx`    | +37 −17           | 9 (builtins)                             |
| `apps/mobile/src/features/settings/SettingsVoiceRouteScreen.tsx`             | +1 −1             | 1 (mobile-permission-status)             |
| `apps/mobile/src/features/threads/ThreadDetailScreen.tsx`                    | +8 −0             | 2 (credentials)                          |
| `apps/mobile/src/features/threads/ThreadHeader.tsx`                          | +25 −1            | 4 (workflow-first, workflows)            |
| `apps/mobile/src/features/threads/ThreadRouteScreen.tsx`                     | +9 −0             | 1 (workflows)                            |
| `apps/mobile/src/lib/projectIcon.ts`                                         | +2 −1             | 1 (credentials)                          |
| `apps/mobile/src/Stack.tsx`                                                  | +9 −0             | 3 (workflows, settings)                  |
| `apps/mobile/vite.config.ts`                                                 | +2 −0             | 2 (credentials)                          |
| `apps/server/scripts/cli.ts`                                                 | +10 −3            | 4 (launch)                               |
| `apps/server/src/auth/EnvironmentAuth.test.ts`                               | +1 −1             | 1 (launch)                               |
| `apps/server/src/auth/mcpOAuthHttp.ts`                                       | +5 −2             | 2 (launch)                               |
| `apps/server/src/auth/RpcAuthorization.ts`                                   | +34 −1            | 5 (credentials, workflows)               |
| `apps/server/src/binCli.ts`                                                  | +6 −3             | 3 (launch)                               |
| `apps/server/src/cli/app.test.ts`                                            | +6 −5             | 1 (launch)                               |
| `apps/server/src/cli/browser.ts`                                             | +1 −1             | 1 (launch)                               |
| `apps/server/src/cli/config.test.ts`                                         | +1 −0             | 1 (launch)                               |
| `apps/server/src/cli/invocation.test.ts`                                     | +48 −38           | 2 (launch)                               |
| `apps/server/src/cli/invocation.ts`                                          | +24 −11           | 11 (launch)                              |
| `apps/server/src/cli/pair.test.ts`                                           | +2 −1             | 1 (launch)                               |
| `apps/server/src/cli/theme.test.ts`                                          | +3 −2             | 1 (launch)                               |
| `apps/server/src/cli/triage.ts`                                              | +2 −2             | 1 (launch)                               |
| `apps/server/src/cli/up.test.ts`                                             | +4 −2             | 2 (launch)                               |
| `apps/server/src/cli/update.test.ts`                                         | +27 −26           | 1 (launch)                               |
| `apps/server/src/cli/update.ts`                                              | +14 −10           | 2 (launch)                               |
| `apps/server/src/cliCompileCache.test.ts`                                    | +1 −1             | 1 (launch)                               |
| `apps/server/src/cloud/bootService.test.ts`                                  | +52 −47           | 6 (launch)                               |
| `apps/server/src/cloud/bootService.ts`                                       | +4 −4             | 2 (launch)                               |
| `apps/server/src/cloud/npmRelease.test.ts`                                   | +6 −5             | 1 (launch)                               |
| `apps/server/src/cloud/npmRelease.ts`                                        | +4 −2             | 2 (launch)                               |
| `apps/server/src/cloud/pinnedRuntime.test.ts`                                | +27 −21           | 1 (launch)                               |
| `apps/server/src/cloud/pinnedRuntime.ts`                                     | +25 −9            | 5 (launch)                               |
| `apps/server/src/cloud/selfUpdate.test.ts`                                   | +15 −6            | 1 (launch)                               |
| `apps/server/src/cloud/serviceLauncherClient.test.ts`                        | +11 −10           | 1 (launch)                               |
| `apps/server/src/cloud/serviceLauncherClient.ts`                             | +4 −2             | 1 (launch)                               |
| `apps/server/src/cloud/servicePreflight.test.ts`                             | +5 −4             | 1 (launch)                               |
| `apps/server/src/cloud/servicePreflight.ts`                                  | +6 −6             | 6 (launch)                               |
| `apps/server/src/environment/ServerEnvironment.test.ts`                      | +6 −5             | 1 (launch)                               |
| `apps/server/src/httpCors.ts`                                                | +1 −1             | 1 (launch)                               |
| `apps/server/src/mcp/McpHttpServer.ts`                                       | +2 −0             | 2 (mcp)                                  |
| `apps/server/src/observability/RpcInstrumentation.ts`                        | +2 −0             | 1 (rpc-instrumentation)                  |
| `apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts`               | +17 −4            | 4 (workflows)                            |
| `apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts`                | +11 −0            | 2 (workflows)                            |
| `apps/server/src/orchestration-v2/runtimeLayer.ts`                           | +11 −1            | 5 (workflow-first)                       |
| `apps/server/src/orchestration-v2/ThreadLaunchService.ts`                    | +5 −0             | 3 (workflow-first)                       |
| `apps/server/src/os-jank.ts`                                                 | +1 −1             | 1 (launch)                               |
| `apps/server/src/policy/policyTemplates.ts`                                  | +4 −4             | 4 (launch)                               |
| `apps/server/src/project/ManagedProjectFolders.ts`                           | +1 −1             | 1 (launch)                               |
| `apps/server/src/provider/AgentContextBudget.test.ts`                        | +2 −0             | 2 (mcp)                                  |
| `apps/server/src/server.ts`                                                  | +5 −0             | 3 (services)                             |
| `apps/server/src/serverRuntimeState.test.ts`                                 | +4 −4             | 1 (launch)                               |
| `apps/server/src/serviceLauncher.test.ts`                                    | +2 −1             | 1 (launch)                               |
| `apps/server/src/serviceLauncher.ts`                                         | +2 −1             | 1 (launch)                               |
| `apps/server/src/storageCleanup.test.ts`                                     | +30 −2            | 4 (sync)                                 |
| `apps/server/src/telemetry/AnalyticsService.test.ts`                         | +10 −3            | 1 (launch)                               |
| `apps/server/src/telemetry/AnalyticsService.ts`                              | +8 −4             | 4 (launch)                               |
| `apps/server/src/triage/triagePrompt.test.ts`                                | +10 −1            | 2 (launch)                               |
| `apps/server/src/triage/triagePrompt.ts`                                     | +16 −162          | 2 (launch)                               |
| `apps/server/src/triage/TriageService.test.ts`                               | +6 −0             | 1 (launch)                               |
| `apps/server/src/triage/TriageService.ts`                                    | +12 −1            | 3 (launch)                               |
| `apps/server/src/ws.test.ts`                                                 | +2 −0             | 2 (ws-test)                              |
| `apps/server/src/ws.ts`                                                      | +29 −5            | 14 (workflows, credentials, rpc)         |
| `apps/server/vite.config.ts`                                                 | +4 −1             | 3 (launch)                               |
| `apps/web/package.json`                                                      | +5 −2             | 1 (credentials)                          |
| `apps/web/src/branding.ts`                                                   | +4 −3             | 4 (workflows, launch)                    |
| `apps/web/src/cloud/publicConfig.test.ts`                                    | +5 −0             | 1 (launch)                               |
| `apps/web/src/cloud/publicConfig.ts`                                         | +2 −0             | 2 (launch)                               |
| `apps/web/src/components/chat/ChatComposer.tsx`                              | +1 −0             | 1 (workflow-first)                       |
| `apps/web/src/components/chat/ComposerControlsBar.tsx`                       | +5 −0             | 2 (workflow-first)                       |
| `apps/web/src/components/chat/composerControlsOwnership.test.ts`             | +10 −0            | 1 (workflow-first)                       |
| `apps/web/src/components/chat/composerControlsOwnership.ts`                  | +3 −1             | 2 (workflow-first)                       |
| `apps/web/src/components/chat/ComposerFooterControls.tsx`                    | +17 −1            | 5 (workflow-first)                       |
| `apps/web/src/components/chat/MessagesTimeline.tsx`                          | +6 −0             | 2 (scenes)                               |
| `apps/web/src/components/chat/RightPanelSurfaceContent.tsx`                  | +10 −0            | 2 (workflows)                            |
| `apps/web/src/components/chat/TimelineWorkEntryRow.tsx`                      | +4 −0             | 2 (credentials)                          |
| `apps/web/src/components/chat/useComposerSend.ts`                            | +13 −7            | 1 (workflow-first)                       |
| `apps/web/src/components/ChatView.tsx`                                       | +8 −0             | 2 (credentials)                          |
| `apps/web/src/components/CommandPalette.tsx`                                 | +13 −0            | 4 (workflows, launch)                    |
| `apps/web/src/components/CommandPaletteThemeItems.tsx`                       | +2 −1             | 1 (scenes)                               |
| `apps/web/src/components/desktopUpdate.logic.test.ts`                        | +3 −2             | 1 (launch)                               |
| `apps/web/src/components/desktopUpdate.logic.ts`                             | +1 −1             | 1 (launch)                               |
| `apps/web/src/components/GitHubStarPrompt.tsx`                               | +1 −1             | 1 (launch)                               |
| `apps/web/src/components/HostedEmptyState.tsx`                               | +8 −5             | 2 (workflows)                            |
| `apps/web/src/components/RightPanelTabs.tsx`                                 | +9 −0             | 7 (workflows)                            |
| `apps/web/src/components/settings/AboutVersionTitle.tsx`                     | +2 −1             | 2 (workflows)                            |
| `apps/web/src/components/settings/AddCodexAccountDialog.tsx`                 | +1 −0             | 1 (codex-account-dialog)                 |
| `apps/web/src/components/settings/AddEnvironmentDialog.browser.test.tsx`     | +4 −0             | 1 (launch)                               |
| `apps/web/src/components/settings/AddEnvironmentDialog.tsx`                  | +2 −1             | 1 (launch)                               |
| `apps/web/src/components/settings/AppearanceSettingsPanel.tsx`               | +47 −43           | 2 (settings)                             |
| `apps/web/src/components/settings/ConnectionDiagnosisDetails.tsx`            | +1 −1             | 1 (connection-diagnosis-countdown)       |
| `apps/web/src/components/settings/ConnectionsSettings.tsx`                   | +2 −1             | 1 (launch)                               |
| `apps/web/src/components/settings/DeviceSourcesSettings.tsx`                 | +16 −12           | 2 (launch)                               |
| `apps/web/src/components/settings/LabsSettingsPanel.tsx`                     | +4 −1             | 2 (launch)                               |
| `apps/web/src/components/settings/pairingUrls.test.ts`                       | +5 −0             | 1 (launch)                               |
| `apps/web/src/components/settings/pairingUrls.ts`                            | +2 −0             | 2 (launch)                               |
| `apps/web/src/components/settings/ScheduledTasksSettings.tsx`                | +2 −0             | 1 (workflow-triggers)                    |
| `apps/web/src/components/settings/SettingsPanels.tsx`                        | +6 −4             | 4 (launch)                               |
| `apps/web/src/components/settings/settingsSearch.ts`                         | +14 −1            | 7 (launch, settings)                     |
| `apps/web/src/components/settings/SettingsSidebarNav.tsx`                    | +2 −0             | 1 (settings)                             |
| `apps/web/src/components/settings/ThemeSettings.tsx`                         | +128 −93          | 5 (scenes)                               |
| `apps/web/src/components/Sidebar.logic.ts`                                   | +2 −0             | 2 (scenes)                               |
| `apps/web/src/components/Sidebar.tsx`                                        | +2 −0             | 2 (workflows)                            |
| `apps/web/src/components/sidebar/SidebarChrome.tsx`                          | +32 −24           | 12 (workflows)                           |
| `apps/web/src/components/ui/select.tsx`                                      | +3 −0             | 3 (workflows)                            |
| `apps/web/src/hooks/useHandleNewThread.test.ts`                              | +7 −0             | 1 (scenes)                               |
| `apps/web/src/hooks/useHandleNewThread.ts`                                   | +11 −4            | 4 (scenes)                               |
| `apps/web/src/hooks/useResizeDrag.ts`                                        | +10 −6            | 5 (workflows)                            |
| `apps/web/src/hooks/useSettings.ts`                                          | +2 −1             | 1 (brand)                                |
| `apps/web/src/hooks/useSidebarProjectGroups.ts`                              | +2 −1             | 2 (scenes)                               |
| `apps/web/src/legalLinks.ts`                                                 | +2 −1             | 2 (launch)                               |
| `apps/web/src/lib/bootError.test.ts`                                         | +4 −2             | 1 (launch)                               |
| `apps/web/src/lib/bootError.ts`                                              | +15 −9            | 4 (launch)                               |
| `apps/web/src/main.tsx`                                                      | +1 −0             | 1 (workflows)                            |
| `apps/web/src/providerInstances.ts`                                          | +2 −1             | 1 (workflows)                            |
| `apps/web/src/rightPanelStore.ts`                                            | +5 −1             | 3 (workflows)                            |
| `apps/web/src/routes/__root.tsx`                                             | +8 −0             | 8 (credentials, tour, scenes, workflows) |
| `apps/web/src/routes/welcome.tsx`                                            | +1 −1             | 1 (launch)                               |
| `apps/web/src/routeTree.gen.ts`                                              | +128 −0           | none, allowed                            |
| `apps/web/src/themePalette.ts`                                               | +5 −1             | 2 (scenes)                               |
| `apps/web/src/timestampFormat.ts`                                            | +24 −0            | 2 (workflows)                            |
| `apps/web/tsconfig.json`                                                     | +1 −0             | none, allowed                            |
| `apps/web/vite.config.ts`                                                    | +6 −1             | 6 (launch, workflows, brand)             |
| `CONTRIBUTING.md`                                                            | +16 −121          | none, allowed                            |
| `docs/README.md`                                                             | +1 −1             | none, allowed                            |
| `docs/user/appearance.md`                                                    | +22 −0            | none, allowed                            |
| `evals/mcp-tool-use/run.ts`                                                  | +19 −3            | 7 (workflows)                            |
| `knip.jsonc`                                                                 | +10 −8            | 4 (launch, workflows)                    |
| `LICENSE`                                                                    | +1 −0             | none, allowed                            |
| `package.json`                                                               | +0 −1             | none, allowed                            |
| `packages/client-runtime/package.json`                                       | +14 −1            | 1 (workflows)                            |
| `packages/client-runtime/src/operations/commands.ts`                         | +4 −0             | 1 (workflow-first)                       |
| `packages/client-runtime/src/rpc/client.ts`                                  | +2 −0             | 2 (workflows, credentials)               |
| `packages/client-runtime/src/state/runtime.ts`                               | +10 −0            | 1 (credentials)                          |
| `packages/contracts/src/auth.ts`                                             | +11 −0            | 6 (credentials)                          |
| `packages/contracts/src/clientRpcPermissions.ts`                             | +3 −0             | 1 (permissions)                          |
| `packages/contracts/src/index.ts`                                            | +1 −0             | 1 (contracts)                            |
| `packages/contracts/src/ipc.ts`                                              | +4 −0             | 2 (credentials)                          |
| `packages/contracts/src/orchestrationV2.ts`                                  | +1 −0             | 1 (workflow-first)                       |
| `packages/contracts/src/rpc.ts`                                              | +7 −0             | 2 (rpc)                                  |
| `packages/contracts/src/settings.ts`                                         | +5 −0             | 3 (workflows)                            |
| `packages/provider-core/src/server/ProviderAdapter.ts`                       | +6 −0             | 2 (workflows)                            |
| `packages/provider-opencode/src/server/adapter.ts`                           | +14 −0            | 2 (workflows)                            |
| `packages/provider-opencode/src/server/v2/adapter.ts`                        | +9 −0             | 2 (workflows)                            |
| `packages/shared/package.json`                                               | +34 −1            | 1 (credentials)                          |
| `packages/shared/src/cliRelease.ts`                                          | +3 −2             | 2 (launch)                               |
| `packages/shared/src/codexAuthHandoff.ts`                                    | +2 −2             | 2 (launch)                               |
| `packages/shared/src/connectAuth.ts`                                         | +1 −1             | 1 (launch)                               |
| `packages/shared/src/favicon.test.ts`                                        | +3 −2             | 1 (launch)                               |
| `packages/shared/src/favicon.ts`                                             | +2 −0             | 2 (launch)                               |
| `packages/shared/src/managedPolicyFile.ts`                                   | +1 −1             | 1 (launch)                               |
| `packages/shared/src/promptLinks.test.ts`                                    | +18 −17           | 1 (launch)                               |
| `packages/shared/src/promptLinks.ts`                                         | +3 −2             | 2 (launch)                               |
| `packages/shared/src/providerAuthReturnUrl.test.ts`                          | +4 −3             | 1 (launch)                               |
| `packages/shared/src/providerAuthReturnUrl.ts`                               | +1 −1             | 1 (launch)                               |
| `packages/shared/src/remote.test.ts`                                         | +3 −2             | 1 (launch)                               |
| `packages/shared/src/remote.ts`                                              | +4 −4             | 2 (launch)                               |
| `pnpm-lock.yaml`                                                             | +9 −0             | none, allowed                            |
| `README.md`                                                                  | +36 −84           | none, allowed                            |
| `scripts/apply-web-brand-assets.ts`                                          | +4 −3             | 2 (workflows)                            |
| `scripts/build-cli-archive.ts`                                               | +8 −3             | 4 (launch)                               |
| `scripts/build-desktop-artifact.test.ts`                                     | +33 −12           | 3 (launch, workflows)                    |
| `scripts/build-desktop-artifact.ts`                                          | +32 −42           | 22 (launch, workflows)                   |
| `scripts/build-npm-launcher.test.ts`                                         | +297 −240         | 2 (launch)                               |
| `scripts/build-npm-launcher.ts`                                              | +36 −16           | 12 (launch)                              |
| `scripts/check-changed.ts`                                                   | +0 −1             | none, allowed                            |
| `scripts/lib/public-config.test.ts`                                          | +23 −0            | 1 (launch)                               |
| `scripts/lib/public-config.ts`                                               | +6 −2             | 5 (launch)                               |
| `scripts/npm-launcher/bin.mjs`                                               | +2 −1             | 1 (launch)                               |
| `scripts/npm-launcher/t3.mjs`                                                | +31 −15           | 12 (launch)                              |
| `scripts/smoke-desktop-app.ts`                                               | +1 −0             | 1 (launch)                               |
| `scripts/tsconfig.json`                                                      | +5 −1             | 2 (workflows)                            |
| `third-party-licenses.config.json`                                           | +7 −0             | none, allowed                            |
| `vite.config.ts`                                                             | +16 −0            | 1 (credentials)                          |

<!-- fork-inventory:end -->
