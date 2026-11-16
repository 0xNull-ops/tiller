import { useState } from "react";
import { useProjects } from "../state/entities";
import { createFileRoute } from "@tanstack/react-router";
import { useSettingsScope } from "../components/settings/SettingsScopeContext";
import { SettingsPageContainer } from "../components/settings/settingsLayout";
import { SkillsBrowser } from "../fork/skillsSh/SkillsBrowser";
function SkillsSettings() {
  const { environment, connectedEnvironments } = useSettingsScope();
  const target = environment ?? connectedEnvironments[0];
  const projects = useProjects().filter(
    (project) => project.environmentId === target?.environmentId,
  );
  const [projectPath, setProjectPath] = useState("");
  return (
    <SettingsPageContainer>
      {target ? (
        <div>
          <label className="text-sm">
            Project for project-scoped skills
            <select value={projectPath} onChange={(event) => setProjectPath(event.target.value)}>
              <option value="">Choose a project (optional)</option>
              {projects.map((project) => (
                <option key={project.id} value={project.workspaceRoot}>
                  {project.title}
                </option>
              ))}
            </select>
          </label>
          <SkillsBrowser
            environmentId={target.environmentId}
            project={
              projects.some((project) => project.workspaceRoot === projectPath)
                ? projectPath
                : undefined
            }
          />
        </div>
      ) : (
        <p>Connect an environment to browse skills.</p>
      )}
    </SettingsPageContainer>
  );
}
export const Route = createFileRoute("/_chat/settings/skills")({ component: SkillsSettings });
