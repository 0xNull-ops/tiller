import { PlayIcon, XIcon } from "lucide-react";

import { WorkspacePageHeader } from "../../components/WorkspacePageHeader";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { SidebarInset } from "../../components/ui/sidebar";
import { isElectron } from "../../env";
import { SampleCanvas } from "./SampleCanvas";
import { SaveCopyDialog } from "./SaveCopyDialog";
import { SAMPLE_WORKFLOW } from "./sampleWorkflow";
import { TOUR_STEPS } from "./tourSteps";
import { useTourStore } from "./tourStore";

/** /workflows/sample: the bundled sample, read-only, and the stage the tour walks over. */
export function SampleWorkflowPage() {
  const demoRun = useTourStore((store) => store.demoRun);
  const demoPlaying = useTourStore((store) => store.demoPlaying);
  const startDemo = useTourStore((store) => store.startDemo);
  const exitDemo = useTourStore((store) => store.exitDemo);
  const saveCopyOpen = useTourStore((store) => store.saveCopyOpen);
  const setSaveCopyOpen = useTourStore((store) => store.setSaveCopyOpen);
  const tourStep = useTourStore((store) =>
    store.status === "running" ? (TOUR_STEPS[store.index] ?? null) : null,
  );
  return (
    <div className="flex h-dvh min-h-0 flex-1 overflow-hidden overscroll-y-none">
      <SidebarInset>
        {isElectron ? <WorkspacePageHeader electron /> : null}
        <header className="flex flex-wrap items-center gap-2 border-b px-6 py-3">
          <h1 className="text-sm font-semibold">{SAMPLE_WORKFLOW.name}</h1>
          <Badge variant="outline">Sample</Badge>
          {demoRun ? <Badge variant="info">Demo</Badge> : null}
          <span className="flex-1" />
          {demoRun ? (
            <Button variant="outline" size="xs" onClick={exitDemo}>
              <XIcon /> Exit demo
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="xs"
            data-tour="run-button"
            disabled={demoPlaying}
            onClick={startDemo}
          >
            <PlayIcon /> {demoRun ? "Replay demo" : "Watch demo run"}
          </Button>
          <Button size="xs" onClick={() => setSaveCopyOpen(true)}>
            Save a copy
          </Button>
        </header>
        <SampleCanvas run={demoRun} editPreview={tourStep?.editPreview === true} />
        <SaveCopyDialog open={saveCopyOpen} onOpenChange={setSaveCopyOpen} />
      </SidebarInset>
    </div>
  );
}
