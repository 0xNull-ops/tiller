import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import { act, render } from "../../test/render";
import { WorkflowInspectorLayout } from "./WorkflowInspectorLayout";
import "~/index.css";

function Layout({ surface = "thread" }: { surface?: "thread" | "page" }) {
  return (
    <div className="flex h-200 flex-col">
      <WorkflowInspectorLayout surface={surface} inspector={<p>Step details</p>}>
        <div className="min-h-0 flex-1">Canvas</div>
      </WorkflowInspectorLayout>
    </div>
  );
}

it("resizes by keyboard, restores the height per surface, and resets on double click", async () => {
  const threadKey = "t3code:workflow-inspector-height:thread";
  const pageKey = "t3code:workflow-inspector-height:page";
  localStorage.removeItem(threadKey);
  localStorage.removeItem(pageKey);
  using _storage = {
    [Symbol.dispose]() {
      localStorage.removeItem(threadKey);
      localStorage.removeItem(pageKey);
    },
  };
  await using screen = await render(<Layout />);
  const separator = screen.getByRole("separator", { name: "Inspector height" });
  await expect.element(separator).toHaveAttribute("aria-valuenow", "320");
  await separator.click();
  await userEvent.keyboard("{ArrowUp}");
  await expect.element(separator).toHaveAttribute("aria-valuenow", "336");
  await vi.waitFor(() =>
    expect(
      screen.container.querySelector("[data-workflow-inspector]")!.getBoundingClientRect().height,
    ).toBe(336),
  );
  expect(localStorage.getItem(threadKey)).toBe("336");
  await userEvent.keyboard("{ArrowDown}");
  await expect.element(separator).toHaveAttribute("aria-valuenow", "320");
  await userEvent.keyboard("{End}");
  await expect.element(separator).toHaveAttribute("aria-valuenow", "640");
  await userEvent.keyboard("{Home}");
  await expect.element(separator).toHaveAttribute("aria-valuenow", "168");
  await act(() => screen.rerender(<Layout surface="page" />));
  await expect.element(separator).toHaveAttribute("aria-valuenow", "320");
  await act(() => screen.rerender(<Layout surface="thread" />));
  await expect.element(separator).toHaveAttribute("aria-valuenow", "168");
  await separator.dblClick();
  await expect.element(separator).toHaveAttribute("aria-valuenow", "320");
  expect(localStorage.getItem(threadKey)).toBeNull();
});

it("drags vertically and persists the bounded height on release", async () => {
  const key = "t3code:workflow-inspector-height:thread";
  localStorage.removeItem(key);
  using _storage = {
    [Symbol.dispose]() {
      localStorage.removeItem(key);
    },
  };
  await using screen = await render(<Layout />);
  const separator = screen.getByRole("separator", { name: "Inspector height" });
  await expect.element(separator).toHaveAttribute("aria-valuenow", "320");
  await userEvent.dragAndDrop(separator, screen.getByText("Canvas"), {
    targetPosition: { x: 100, y: 100 },
  });
  await expect.element(separator).toHaveAttribute("aria-valuenow", "640");
  expect(localStorage.getItem(key)).toBe("640");
  expect(document.body.style.cursor).toBe("");
  expect(document.body.style.userSelect).toBe("");
});
