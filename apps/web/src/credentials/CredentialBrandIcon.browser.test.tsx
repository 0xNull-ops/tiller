import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../test/render";
import { CredentialBrandIcon } from "./CredentialBrandIcon";
import { CredentialIconPicker } from "./CredentialIconPicker";
import "~/index.css";

// The brand glyph draws on a 24-unit grid and the monogram fallback on a 16-unit
// one, so the viewBox says which of the two a tile settled on.
const brandGlyph = (root: ParentNode) => root.querySelector("svg[viewBox='0 0 24 24']");
const monogram = (root: ParentNode) => root.querySelector("svg[viewBox='0 0 16 16']");

// The tile fetches its glyph chunk lazily; on a loaded runner the first transform of those
// modules can outlast a wait, so the tests warm the same modules before rendering.
const warmGlyphChunks = () =>
  Promise.all([
    import("./CredentialBrandGlyph"),
    import("../../node_modules/simple-icons/icons/stripe.svg?raw"),
    import("../../node_modules/simple-icons/icons/linear.svg?raw"),
  ]);

it("draws a known brand's glyph and a monogram for an unknown name", async () => {
  await warmGlyphChunks();
  await using screen = await render(
    <div>
      <div data-testid="stripe">
        <CredentialBrandIcon name="Stripe live" />
      </div>
      <div data-testid="unknown">
        <CredentialBrandIcon name="Office wifi" />
      </div>
    </div>,
  );
  const stripe = screen.container.querySelector("[data-testid='stripe']")!;
  const unknown = screen.container.querySelector("[data-testid='unknown']")!;

  // One lazy chunk serves both tiles, so its arrival means both were matched.
  await vi.waitFor(() => expect(brandGlyph(stripe)).not.toBeNull());
  expect(brandGlyph(stripe)?.querySelector("path")?.getAttribute("d")).toBeTruthy();
  expect(monogram(stripe)).toBeNull();

  expect(brandGlyph(unknown)).toBeNull();
  expect(monogram(unknown)?.querySelector("text")?.textContent).toBe("OW");
});

it("prefers a picked brand colour over the detected one", async () => {
  await warmGlyphChunks();
  await using screen = await render(
    <CredentialBrandIcon name="Stripe live" iconOverride="linear" size="md" />,
  );

  await vi.waitFor(() => expect(brandGlyph(screen.container)).not.toBeNull());
  // Linear's purple, not Stripe's. A near-black brand would instead take the
  // theme foreground (covered by the tone test in @t3tools/shared).
  expect(getComputedStyle(brandGlyph(screen.container)!).color).toBe("rgb(94, 106, 210)");
});

it("picks a brand from the searchable list", async () => {
  const onValueChange = vi.fn();
  await using screen = await render(
    <CredentialIconPicker name="Stripe live" value={null} onValueChange={onValueChange} />,
  );

  await userEvent.click(screen.getByRole("button", { name: "Automatic" }));
  const search = page.getByRole("searchbox", { name: "Search brands" });
  await expect.element(search).toBeVisible();
  await userEvent.fill(search, "linear");
  await userEvent.click(page.getByRole("button", { name: "Linear" }));
  expect(onValueChange).toHaveBeenCalledWith("linear");

  await userEvent.click(screen.getByRole("button", { name: "Automatic" }));
  await userEvent.click(page.getByRole("button", { name: /^Automatic Detect/ }));
  expect(onValueChange).toHaveBeenCalledWith(null);
});
