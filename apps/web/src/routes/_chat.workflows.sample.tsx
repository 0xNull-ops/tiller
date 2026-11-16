import { createFileRoute } from "@tanstack/react-router";

import { SampleWorkflowPage } from "../fork/tour/SampleWorkflowPage";

export const Route = createFileRoute("/_chat/workflows/sample")({
  component: SampleWorkflowPage,
});
