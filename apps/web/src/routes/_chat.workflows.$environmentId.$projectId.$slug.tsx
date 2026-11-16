import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { createFileRoute } from "@tanstack/react-router";

import { WorkflowStandalonePage } from "../workflows/WorkflowStandalonePage";

export interface WorkflowStandaloneRouteSearch {
  readonly run?: string;
  readonly step?: string;
}

function WorkflowStandaloneRouteView() {
  const params = Route.useParams();
  const search = Route.useSearch();
  return (
    <WorkflowStandalonePage
      environmentId={params.environmentId as EnvironmentId}
      projectId={params.projectId as ProjectId}
      slug={params.slug}
      runId={search.run ?? null}
      stepId={search.step ?? null}
    />
  );
}

export const Route = createFileRoute("/_chat/workflows/$environmentId/$projectId/$slug")({
  validateSearch: (raw: Record<string, unknown>): WorkflowStandaloneRouteSearch => ({
    ...(typeof raw.run === "string" && raw.run ? { run: raw.run } : {}),
    ...(typeof raw.step === "string" && raw.step ? { step: raw.step } : {}),
  }),
  component: WorkflowStandaloneRouteView,
});
