# Credentials

The credential vault keeps the tokens, keys, and files that your projects and workflows need on the
machine running T3 Code. Agents use a credential through T3, so they can deploy, upload, or call an
API without the value appearing in a chat, a file in your repository, or a run's history.

Manage the vault in **Settings → Credentials**. From a workflow, choose **⋯ → Credentials…** to open
the same vault.

## Add a credential

Choose **Add credential**, then pick a type such as App Store Connect API key, Apple signing,
RevenueCat, GitHub token, Vercel, Stripe, or Google service account. Choose **Custom** for anything
else. You can also paste a `.env` file to fill in its fields at once.

- Secret values are write-only. After you save, the vault shows only that a value is set and when it
  changed. Replace or remove a value from the credential's page.
- A file, such as a `.p8` key or a service-account JSON, can be up to 1 MB.
- Each field has an environment variable name, the name the command sees, such as `ASC_KEY_ID`.
  You can change it while you add the credential.
- Names that change how commands run are refused, including `PATH`, `HOME`, `SHELL`, `NODE_OPTIONS`,
  `LD_PRELOAD`, and any name starting with `DYLD_`. A credential saved with one of these names does
  not pass it to commands, and the command's result lists the name as skipped.
- To limit a credential to some projects, choose **Only these projects** and pick them.

## Unlock with a PIN

Approving or denying an agent's request, and setting a workflow to **Pre-approved**, need the vault
unlocked. Set a PIN in **Settings → Credentials**: at least four digits, or a passphrase of six or
more characters. An unlock lasts five minutes on that device.

On the desktop app, Touch ID, Windows Hello, or your system password can stand in for typing the
PIN. T3 still verifies the unlock.

## How agents use a credential

When an agent needs a credential, T3 runs its command with the credential's values set as environment
variables. The agent sees the command's output with every known value replaced by `[redacted]`. It
never receives the value itself.

A secret file can also be given to an agent for one run. The agent can read that file, so use this
only when a tool needs a file path. T3 deletes the file when the run ends, or after an hour at most.

## Approvals

When an agent wants to use a credential and no approval covers it, T3 asks you in the chat and on
your phone. The request shows who is asking (provider, model, main agent or subagent), the workflow
and step if there is one, and the command. On a workflow's canvas, the credential's card shows the
same request with the approval buttons, and while the command runs, the card shows who is using it.

Outside a workflow, you can **Allow once** or **Allow for this thread**. Inside a workflow set to
**Once per run** (the default), you can also allow the use **for this run** or **for this
workflow**. Choose **Deny** to refuse. If nobody answers within ten minutes, the request is denied
and the command does not run.

On a credential's page, **Always ask before agents use this** makes every use ask you, even where you
allowed it before. To take back an approval, open the credential's page and choose **Revoke** under
**Grants**. The next use asks again.

## Workflow approvals

Each workflow has a **Credential approvals** setting:

- **Ask every time**: every use asks you.
- **Once per run** (default): the first use asks, and you can allow it for the run or the workflow.
- **Pre-approved**: the credentials attached to the workflow's steps are used without asking.
  Scheduled runs need this setting, because nobody is there to answer. Any other credential still
  asks.

Approval is recorded on this server for the credentials that were attached when you chose
Pre-approved. Attach another credential later, or download a workflow that arrives saying
Pre-approved, and it asks the next time: the setting in the file is your intent, and the approval
lives with your vault. Choose **Re-approve credentials** to cover what is attached now.

Each covered credential also appears on that credential's page under **Grants**, as
**Pre-approved for workflow**, with the project. Choosing **Revoke** there withdraws just that
credential, and the workflow then shows **Re-approve credentials** until you cover it again.

A workflow with credentials that isn't Pre-approved shows **Scheduled runs need your attention** in
its schedules, with a **Switch to Pre-approved** button. The same block appears, with
**Re-approve credentials**, when a credential attached since then is not covered. If a scheduled run
needs a required credential it cannot use, the run does not start, and it shows why.

## Attach credentials to a workflow step

Attach a credential from the step's **Resources → Credentials** tab. The attachment records the
credential type and, once you choose one, which credential to use. Values stay in the vault, so a
workflow can be shared without them. **Suggested for this step** lists the credentials that match the
step's skill, and **New credential…** adds one and attaches it to the step.

Each attached credential has a card beside the step with its status and the one action that fixes
it: **Add** for a missing credential, **Choose…** when several match, and **Fix** for a missing field
or an expired credential. The step's details list each credential's environment variables under
**Credentials**, so you can see what the agent gets.

If you don't choose a credential, T3 uses the only usable one of that type. If several match, the
step shows **Choose a credential**.

Each attached credential shows one of these statuses:

- **Ready**: the step will use it.
- **Matched automatically**: T3 picked the only usable credential of this type.
- **Choose a credential**: several match. Pick one.
- **Missing**: there is no credential of this type. Add one.
- **Missing a required field**: finish adding the credential.
- **Expiring soon** or **Expires in N days**: still usable. Renew it before it expires.
- **Expired**: the step cannot use it. Renew the credential.
- **Not allowed in this project**: the credential is limited to other projects.
- **Credential vault unavailable**: T3 could not read the vault. Try again.

On mobile, a saved run shows each step's credentials and their status, read-only.

## History

Each credential has a **History** of its uses: when it was used, which fields were used, who asked, the workflow and step, the command, the decision, and the result. Values never appear
there.

## Mobile

On your phone, open **Settings → Credentials** to see your credentials and their history, approve or
deny requests, and unlock the vault with your PIN. Add, edit, or delete a credential, and revoke an
approval, on desktop or web.
