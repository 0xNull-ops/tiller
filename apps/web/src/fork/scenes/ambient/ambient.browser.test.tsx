import { expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "../../../../test/render";
import { AmbientSettings } from "./preference";
import { DEFAULT_AMBIENT_CONTROLS } from "./controls";
import { drawAmbientFrame } from "./draw";

it("saves and restores the ambient effect and its controls", async () => {
  const keys = ["tiller:scene-ambient-controls:v1", "tiller:scene-ambient-effect"];
  const previous = keys.map((key) => localStorage.getItem(key));
  localStorage.removeItem(keys[0]!);
  localStorage.setItem(keys[1]!, "meteors");
  try {
    await using screen = await render(<AmbientSettings scene={null} />);
    await userEvent.click(screen.getByRole("combobox", { name: "Ambient effect" }));
    await userEvent.click(page.getByRole("option", { name: "Meteors" }));
    expect(localStorage.getItem(keys[1]!)).toBe("meteors");
    await userEvent.click(screen.getByRole("slider", { name: "Particle size" }));
    await userEvent.keyboard("{End}");
    expect(JSON.parse(localStorage.getItem(keys[0]!)!).size).toBe(3);
    await screen.unmount();
    await using _restored = await render(<AmbientSettings scene={null} />);
    await expect.element(page.getByRole("slider", { name: "Particle size" })).toHaveValue("3");
  } finally {
    keys.forEach((key, index) => {
      const value = previous[index];
      if (value === null || value === undefined) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    });
  }
});

it.each(["snow", "meteors", "bubbles", "petals"] as const)(
  "applies the size and opacity controls to painted %s particles",
  (kind) => {
    const canvas = document.createElement("canvas");
    canvas.width = 200;
    canvas.height = 200;
    const context = canvas.getContext("2d")!;
    const paint = (size: number, opacity: number) => {
      drawAmbientFrame({
        context,
        kind,
        controls: { ...DEFAULT_AMBIENT_CONTROLS, size, opacity },
        particles: [{ x: 0.5, y: 0.5, size: 2, phase: 0.3 }],
        width: 200,
        height: 200,
        time: 0.3,
        elapsed: 0,
        color: "#ffffff",
      });
      const data = context.getImageData(0, 0, 200, 200).data;
      let painted = 0,
        alpha = 0;
      for (let index = 3; index < data.length; index += 4) {
        if (data[index]! > 0) painted++;
        alpha += data[index]!;
      }
      return { painted, alpha };
    };
    const small = paint(1, 1);
    const large = paint(3, 1);
    const faint = paint(3, 0.25);
    expect(large.painted).toBeGreaterThan(small.painted);
    expect(faint.alpha).toBeLessThan(large.alpha);
  },
);
