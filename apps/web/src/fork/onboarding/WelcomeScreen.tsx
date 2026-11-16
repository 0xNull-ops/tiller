/* oxlint-disable shadcn/no-unknown-classes -- Welcome layout and animations are defined in welcome.css. */
import { useEffect, useRef, useState } from "react";
import {
  ArrowRightIcon,
  CheckIcon,
  GitBranchIcon,
  ScanSearchIcon,
  TerminalIcon,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import { BrandLogo } from "../BrandLogo";
import { FORK_BRAND } from "../brand";
import { PRIVACY_POLICY_URL, TERMS_URL } from "../../legalLinks";
import mark from "../assets/tiller-mark.svg";
import lightMark from "../assets/tiller-mark-light.svg";
import "./welcome.css";

const LAUNCH_STAGES = ["Welcome", "Connect", "Agents", "Projects"] as const;

export function WelcomeScreen({
  onBegin,
  onSkip,
}: {
  onBegin: () => void;
  onSkip: () => Promise<boolean>;
}) {
  const beginRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [skipFailed, setSkipFailed] = useState(false);
  const [hidden, setHidden] = useState(document.hidden);
  const [skipping, setSkipping] = useState(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- pauses compositor animations when the document is hidden
  useEffect(() => {
    const update = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- native modal keeps the obscured route inert and traps keyboard focus
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    beginRef.current?.focus();
    return () => dialog?.close();
  }, []);
  const skip = async () => {
    setSkipping(true);
    setSkipFailed(false);
    if (!(await onSkip())) {
      setSkipping(false);
      setSkipFailed(true);
    }
  };
  return (
    <dialog
      ref={dialogRef}
      className="tiller-welcome-dialog"
      aria-labelledby="tiller-welcome-title"
      onCancel={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        // Chrome closes a modal on the second Escape unless keydown is cancelled too.
        if (event.key === "Escape") event.preventDefault();
      }}
    >
      <main className="tiller-welcome" data-paused={hidden} aria-labelledby="tiller-welcome-title">
        <header className="drag-region tiller-welcome-header">
          <BrandLogo className="block h-8 w-24" />
          <ol aria-label="Setup progress" className="tiller-welcome-progress">
            {LAUNCH_STAGES.map((stage, i) => (
              <li key={stage} aria-current={i === 0 ? "step" : undefined}>
                <span>{i + 1}</span>
                {stage}
              </li>
            ))}
          </ol>
          <Button variant="ghost-muted" disabled={skipping} onClick={() => void skip()}>
            Skip setup
          </Button>
        </header>
        <div className="tiller-welcome-body">
          <section className="tiller-welcome-copy">
            <picture aria-hidden="true">
              <img className="hidden size-20 dark:block" src={mark} alt="" />
              <img className="size-20 dark:hidden" src={lightMark} alt="" />
            </picture>
            <h1 id="tiller-welcome-title">
              One canvas for <br />
              your agents.
            </h1>
            <p>Connect them, then build your first workflow.</p>
            <div>
              <Button ref={beginRef} size="lg" disabled={skipping} autoFocus onClick={onBegin}>
                Begin setup <ArrowRightIcon />
              </Button>
            </div>
            {skipFailed ? (
              <p role="alert">
                Could not finish setup. Your settings could not be saved. Try again.
              </p>
            ) : null}
          </section>
          <MiniCanvas />
        </div>
        <footer>
          By using {FORK_BRAND.name} you agree to the{" "}
          <a href={TERMS_URL} target="_blank" rel="noreferrer noopener">
            Terms
          </a>
          . See the{" "}
          <a href={PRIVACY_POLICY_URL} target="_blank" rel="noreferrer noopener">
            privacy policy
          </a>
          .
        </footer>
      </main>
    </dialog>
  );
}

function MiniCanvas() {
  return (
    <div
      className="tiller-welcome-canvas"
      role="img"
      aria-label="A workflow with three connected steps: Explore, Build, and Review. All steps complete in sequence."
    >
      <div className="tiller-welcome-graph" aria-hidden="true">
        <div className="tiller-welcome-edge edge-one">
          <i />
        </div>
        <div className="tiller-welcome-edge edge-two">
          <i />
        </div>
        {[
          { title: "Explore the codebase", agent: "Claude · Research", Icon: ScanSearchIcon },
          { title: "Build the feature", agent: "Codex · Implement", Icon: TerminalIcon },
          { title: "Review and refine", agent: "Claude · Review", Icon: GitBranchIcon },
        ].map(({ title, agent, Icon }, i) => (
          <div key={title} className={`tiller-welcome-card card-${i}`}>
            <div className="tiller-welcome-card-meta">
              <span>STEP 0{i + 1}</span>
              <span className="tiller-welcome-status">
                <span className="queued">Queued</span>
                <span className="running">Running</span>
                <span className="done">
                  <CheckIcon size={12} />
                  Done
                </span>
              </span>
            </div>
            <div className="tiller-welcome-card-title">
              <Icon size={17} />
              <strong>{title}</strong>
            </div>
            <p>{agent}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
