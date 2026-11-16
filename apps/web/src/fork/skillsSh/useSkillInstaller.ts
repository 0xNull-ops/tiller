import { useAtomValue } from "@effect/atom-react";
import { createSkillsShCommands } from "@t3tools/client-runtime/state/skillsSh";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, SkillsShPreview } from "@t3tools/contracts";
import { connectionAtomRuntime } from "../../connection/runtime";
import { useAtomCommand } from "../../state/use-atom-command";
const commands = createSkillsShCommands(connectionAtomRuntime);
export function useSkillInstaller(environmentId: EnvironmentId) {
  const preview = useAtomCommand(commands.preview, { reportFailure: false });
  const install = useAtomCommand(commands.install, { reportFailure: false });
  const search = useAtomCommand(commands.search, { reportFailure: false });
  const canInstall = useAtomValue(commands.install.permissionAtom(environmentId));
  return {
    canInstall,
    search: async (query: string) => {
      const result = await search({ environmentId, input: { query, limit: 50 } });
      if (result._tag !== "Success") throw squashAtomCommandFailure(result);
      return result.value.skills;
    },
    preview: async (id: string) => {
      const result = await preview({ environmentId, input: { id } });
      if (result._tag !== "Success") throw squashAtomCommandFailure(result);
      return result.value;
    },
    install: async (resolved: typeof SkillsShPreview.Type, name: string) => {
      if (!canInstall) throw new Error("Settings write permission is required to install skills.");
      const result = await install({
        environmentId,
        input: { scope: "global", id: resolved.id, sha: resolved.sha, name },
      });
      if (result._tag !== "Success") throw squashAtomCommandFailure(result);
      return result.value.name;
    },
  };
}
