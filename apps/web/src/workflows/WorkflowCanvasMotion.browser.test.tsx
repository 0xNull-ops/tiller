import { useState } from "react";
import { expect, it, vi } from "vite-plus/test";
import { act, render } from "../../test/render";
import { useWorkflowCanvasMotion } from "./useWorkflowCanvasMotion";
import "./WorkflowPanel.css";

function Canvas() {
  const [extra, setExtra] = useState(false);
  const [status, setStatus] = useState("running");
  const attach = useWorkflowCanvasMotion("one-workflow");
  return (
    <>
      <button onClick={() => setExtra(!extra)}>Toggle step</button>
      <button onClick={() => setStatus("done")}>Finish</button>
      <div style={{ position: "relative", width: 600, height: 300, overflow: "hidden" }}>
        <div ref={attach}>
          {extra ? (
            <div data-workflow-node="extra" style={{ position: "absolute", left: 0, top: 0 }}>
              New step
            </div>
          ) : null}
          <div
            data-workflow-node="work"
            data-status={status}
            style={{
              position: "absolute",
              left: extra ? 200 : 0,
              top: 100,
              width: 190,
              height: 100,
            }}
          >
            <span data-workflow-status>Build · {status}</span>
            {status === "running" ? <span data-workflow-sweep /> : null}
          </div>
          {extra ? (
            <svg>
              <path data-workflow-edge="extra-work" pathLength={1} d="M0 0L200 100" />
            </svg>
          ) : null}
        </div>
      </div>
    </>
  );
}

it("slides neighbours and draws the new connection when a step is inserted", async () => {
  await using screen = await render(<Canvas />);
  await act(() => screen.container.querySelector<HTMLButtonElement>("button")!.click());
  const card = screen.container.querySelector<HTMLElement>('[data-workflow-node="work"]')!;
  expect(card.style.left).toBe("200px");
  // Animations finish at the saved geometry; there is no permanent transform offset.
  await Promise.all(
    screen.container
      .getAnimations({ subtree: true })
      .filter((a) => a.effect?.getTiming().iterations !== Infinity)
      .map((a) => a.finished),
  );
  expect(getComputedStyle(card).transform).toBe("none");
  expect(screen.container.querySelector('[data-workflow-edge="extra-work"]')).not.toBeNull();
  expect(screen.container.textContent).toContain("New step");
});

it("removes controls immediately while the inert departing card fades", async () => {
  await using screen = await render(<Canvas />);
  await act(() => screen.container.querySelector<HTMLButtonElement>("button")!.click());
  await act(() => screen.container.querySelector<HTMLButtonElement>("button")!.click());
  expect(screen.container.querySelector('[data-workflow-node="extra"]')).toBeNull();
  await Promise.all(
    screen.container
      .getAnimations({ subtree: true })
      .filter((a) => a.effect?.getTiming().iterations !== Infinity)
      .map((a) => a.finished),
  );
  expect(screen.container.textContent).not.toContain("New step");
});

it("clears the running indicator on completion and finishes its one-time response", async () => {
  await using screen = await render(<Canvas />);
  await act(() => screen.container.querySelectorAll<HTMLButtonElement>("button")[1]!.click());
  expect(screen.container.textContent).toContain("Build · done");
  expect(screen.container.querySelector("[data-workflow-sweep]")).toBeNull();
  await Promise.all(screen.container.getAnimations({ subtree: true }).map((a) => a.finished));
  expect(screen.container.getAnimations({ subtree: true })).toHaveLength(0);
});

it("respects reduced motion when inserting and finishing a step", async () => {
  await using screen = await render(<Canvas />);
  const original = window.matchMedia.bind(window);
  using _mock = vi.spyOn(window, "matchMedia").mockImplementation((query) => {
    const result = original(query);
    return query === "(prefers-reduced-motion: reduce)" ? { ...result, matches: true } : result;
  });
  await act(() => screen.container.querySelector<HTMLButtonElement>("button")!.click());
  await act(() => screen.container.querySelectorAll<HTMLButtonElement>("button")[1]!.click());
  expect(screen.container.textContent).toContain("New step");
  expect(screen.container.textContent).toContain("Build · done");
  expect(screen.container.getAnimations({ subtree: true })).toHaveLength(0);
});

it("pauses the running highlight outside the viewport and while the document is hidden", async () => {
  await using screen = await render(<Canvas />);
  const card = screen.container.querySelector<HTMLElement>('[data-workflow-node="work"]')!;
  const sweep = card.querySelector<HTMLElement>("[data-workflow-sweep]")!;
  await vi.waitFor(() => expect(getComputedStyle(sweep).animationPlayState).toBe("running"));
  card.style.left = "1000px";
  await vi.waitFor(() => expect(getComputedStyle(sweep).animationPlayState).toBe("paused"));
  card.style.left = "0px";
  await vi.waitFor(() => expect(getComputedStyle(sweep).animationPlayState).toBe("running"));
  using _hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  document.dispatchEvent(new Event("visibilitychange"));
  expect(getComputedStyle(sweep).animationPlayState).toBe("paused");
});
