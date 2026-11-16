import type { AmbientControls } from "./controls";
import type { AmbientKind } from "./types";
export type Particle = { x: number; y: number; phase: number; size: number };
const wrap = (value: number) => ((value % 1) + 1) % 1;
export function drawAmbientFrame({
  context,
  kind,
  controls,
  particles,
  width,
  height,
  time,
  elapsed,
  color,
}: {
  context: CanvasRenderingContext2D;
  kind: AmbientKind;
  controls: AmbientControls;
  particles: Particle[];
  width: number;
  height: number;
  time: number;
  elapsed: number;
  color: string;
}) {
  context.clearRect(0, 0, width, height);
  context.fillStyle = color;
  context.strokeStyle = color;
  const rain = kind === "rain";
  const fire = kind === "fire";
  const rising = kind === "embers" || fire || kind === "bubbles";
  for (const particle of particles) {
    const speed = rain ? 0.32 : rising ? -0.045 : kind === "dust" ? 0.004 : 0.018;
    particle.y = wrap(particle.y + speed * elapsed);
    particle.x = wrap(
      particle.x +
        ((rain ? -0.06 : Math.sin(time + particle.phase) * 0.008) + controls.wind * 0.035) *
          elapsed,
    );
    const radius = particle.size * controls.size;
    context.lineWidth = controls.size;
    context.globalAlpha =
      controls.opacity *
      (rising
        ? Math.sin(particle.y * Math.PI) * (0.35 + 0.2 * Math.sin(time * 4 + particle.phase))
        : kind === "fireflies"
          ? 0.2 + 0.35 * (1 + Math.sin(time + particle.phase))
          : kind === "snow"
            ? 0.75
            : 0.45);
    context.beginPath();
    const x = particle.x * width;
    const y = particle.y * height;
    if (fire) {
      const base = height + 8;
      const flame =
        (0.08 + radius * 0.04) * height * (0.65 + 0.35 * Math.sin(time * 3 + particle.phase));
      const spread = 4 + radius * 4;
      const glow = context.createLinearGradient(x, base - flame, x, base);
      glow.addColorStop(0, "#ff5b1800");
      glow.addColorStop(0.6, "#ff702566");
      glow.addColorStop(1, "#ffd066bb");
      context.fillStyle = glow;
      context.globalAlpha = 0.75 * controls.opacity;
      context.moveTo(x - spread, base);
      context.quadraticCurveTo(
        x - spread * 1.4,
        base - flame * 0.4,
        x + Math.sin(time + particle.phase) * spread,
        base - flame,
      );
      context.quadraticCurveTo(x + spread, base - flame * 0.35, x + spread, base);
      context.fill();
      context.fillStyle = color;
    } else if (kind === "meteors") {
      const cycle = wrap(time * 0.08 + particle.phase / (Math.PI * 2));
      if (cycle > 0.12) continue;
      const progress = cycle / 0.12;
      const headX = wrap(particle.x + progress * 0.45) * width;
      const headY = (particle.y * 0.5 + progress * 0.5) * height;
      const length = (30 + particle.size * 18) * controls.size;
      const tail = context.createLinearGradient(
        headX - length,
        headY - length * 0.65,
        headX,
        headY,
      );
      tail.addColorStop(0, "#b9dfff00");
      tail.addColorStop(1, "#e3f2ff");
      context.strokeStyle = tail;
      context.globalAlpha = Math.sin(progress * Math.PI) * controls.opacity;
      context.moveTo(headX - length, headY - length * 0.65);
      context.lineTo(headX, headY);
      context.stroke();
      context.strokeStyle = color;
    } else if (rain) {
      context.moveTo(x, y);
      context.lineTo(x - 3 * controls.size, y + 12 * controls.size);
      context.stroke();
    } else if (kind === "bubbles") {
      context.arc(x, y, radius * 2, 0, Math.PI * 2);
      context.stroke();
    } else if (kind === "petals") {
      context.ellipse(x, y, radius * 2, radius, time * 0.6 + particle.phase, 0, Math.PI * 2);
      context.fill();
    } else {
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
    }
  }
  context.globalAlpha = 1;
}
