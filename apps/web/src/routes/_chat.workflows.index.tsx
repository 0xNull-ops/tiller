import { createFileRoute } from "@tanstack/react-router";

import { WorkflowsHomePage } from "../workflows/WorkflowsHomePage";

export const Route = createFileRoute("/_chat/workflows/")({
  validateSearch: (raw: Record<string, unknown>) => ({
    templates: raw.templates === true || raw.templates === "true",
  }),
  component: () => <WorkflowsHomePage templatesOnly={Route.useSearch().templates} />,
});
