import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type {
  Credential,
  CredentialId,
  CredentialPendingRequest,
  EnvironmentId,
} from "@t3tools/contracts";

import { useProjects } from "../state/entities";
import { useEnvironmentQuery } from "../state/query";
import { useAtomCommand } from "../state/use-atom-command";
import {
  credentialGrantsQuery,
  credentialLive,
  revokeCredentialGrant,
  createCredential,
  credentialListQuery,
  credentialsStatusQuery,
  deleteCredential,
  lockCredentials,
  readCredentialHistory,
  removeCredentialSecret,
  setCredentialPin,
  setCredentialSecret,
  unlockCredentials,
  updateCredential,
} from "./credentialState";

import { CredentialsManager, type CredentialsManagerActions } from "./CredentialsManager";
import { bindCredentialOsUnlock, useCredentialOsUnlockStatus } from "./credentialOsUnlock";
import { classifyCredentialFailure, type CredentialActionResult } from "./credentialWriteGate";

const HISTORY_PAGE_SIZE = 50;

const settle = async <A, E>(
  run: () => Promise<AtomCommandResult<A, E>>,
): Promise<CredentialActionResult<A>> => {
  const result = await run();
  if (result._tag === "Success") return { ok: true, value: result.value };
  if (isAtomCommandInterrupted(result)) {
    return {
      ok: false,
      failure: {
        kind: "error",
        message: "The environment disconnected before the action finished.",
      },
    };
  }
  return { ok: false, failure: classifyCredentialFailure(squashAtomCommandFailure(result)) };
};

export function CredentialsEnvironmentPanel({
  environmentId,
  addRequest,
  presetTemplateId,
  focusCredentialId,
  onCredentialCreated,
}: {
  readonly environmentId: EnvironmentId;
  readonly addRequest?: Extract<CredentialPendingRequest, { kind: "add" }>;
  readonly presetTemplateId?: string | null;
  readonly focusCredentialId?: CredentialId | null;
  readonly onCredentialCreated?: (credential: Credential) => void;
}) {
  const revoke = useAtomCommand(revokeCredentialGrant, { reportFailure: false });
  const canManage = useAtomValue(createCredential.permissionAtom(environmentId));
  const live = useEnvironmentQuery(canManage ? credentialLive.liveStateAtom(environmentId) : null);
  const osUnlockView = useCredentialOsUnlockStatus(environmentId);
  const osUnlock = osUnlockView.supported ? bindCredentialOsUnlock(environmentId) : null;
  const statusQuery = useEnvironmentQuery(
    canManage ? credentialsStatusQuery({ environmentId, input: {} }) : null,
  );
  const listQuery = useEnvironmentQuery(
    canManage ? credentialListQuery({ environmentId, input: {} }) : null,
  );
  const create = useAtomCommand(createCredential, {
    label: "create credential",
    reportFailure: false,
  });
  const update = useAtomCommand(updateCredential, {
    label: "update credential",
    reportFailure: false,
  });
  const setSecret = useAtomCommand(setCredentialSecret, {
    label: "replace credential secret",
    reportFailure: false,
  });
  const removeSecret = useAtomCommand(removeCredentialSecret, {
    label: "remove credential secret",
    reportFailure: false,
  });
  const remove = useAtomCommand(deleteCredential, {
    label: "delete credential",
    reportFailure: false,
  });
  const setPin = useAtomCommand(setCredentialPin, {
    label: "set credential PIN",
    reportFailure: false,
  });
  const unlock = useAtomCommand(unlockCredentials, {
    label: "unlock credentials",
    reportFailure: false,
  });
  const lock = useAtomCommand(lockCredentials, {
    label: "lock credentials",
    reportFailure: false,
  });
  const readHistory = useAtomCommand(readCredentialHistory, {
    label: "read credential history",
    reportFailure: false,
  });
  const grants = useEnvironmentQuery(
    canManage ? credentialGrantsQuery({ environmentId, input: {} }) : null,
  );
  const projects = useProjects();

  const actions: CredentialsManagerActions = {
    create: (input) => settle(() => create({ environmentId, input })),
    update: (input) => settle(() => update({ environmentId, input })),
    setSecret: (input) => settle(() => setSecret({ environmentId, input })),
    removeSecret: (input) => settle(() => removeSecret({ environmentId, input })),
    deleteCredential: async (id): Promise<CredentialActionResult<void>> => {
      const result = await settle(() => remove({ environmentId, input: { id } }));
      return result.ok ? { ok: true, value: undefined } : result;
    },
    setPin: (input) => settle(() => setPin({ environmentId, input })),
    unlock: (pin) => settle(() => unlock({ environmentId, input: { pin } })),
    lock: () => settle(() => lock({ environmentId, input: {} })),
    loadHistory: (id, cursor) =>
      settle(() =>
        readHistory({
          environmentId,
          input: {
            credentialId: id,
            limit: HISTORY_PAGE_SIZE,
            ...(cursor === undefined ? {} : { cursor }),
          },
        }),
      ),
  };

  return (
    <CredentialsManager
      environmentId={environmentId}
      addRequest={addRequest}
      presetTemplateId={presetTemplateId ?? null}
      focusCredentialId={focusCredentialId ?? null}
      {...(onCredentialCreated ? { onCreated: onCredentialCreated } : {})}
      historyRevision={live.data?.historyRevision ?? 0}
      grants={grants.data ?? []}
      grantsError={grants.error}
      onRevokeGrant={(grant) =>
        settle(() =>
          revoke({
            environmentId,
            input:
              grant.kind === "approval"
                ? { kind: "approval", grantId: grant.id }
                : {
                    kind: "workflow-preapproval",
                    projectId: grant.projectId,
                    workflow: grant.workflow,
                    credentialId: grant.credentialId,
                  },
          }),
        )
      }
      credentials={listQuery.data?.credentials ?? []}
      status={statusQuery.data ?? null}
      projects={projects
        .filter((project) => project.environmentId === environmentId)
        .map((project) => ({ id: project.id, title: project.title }))}
      loading={listQuery.isPending && listQuery.data === null}
      error={listQuery.error ?? statusQuery.error}
      readOnly={!canManage}
      osUnlock={osUnlock}
      osUnlockStatus={osUnlockView.status}
      onOsUnlockStatus={osUnlockView.setStatus}
      onRetry={() => {
        statusQuery.refresh();
        listQuery.refresh();
      }}
      actions={actions}
    />
  );
}
