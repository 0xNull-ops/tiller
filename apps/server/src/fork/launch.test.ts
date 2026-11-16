import { it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import { HttpClient } from "effect/http";
import * as AnalyticsService from "../telemetry/AnalyticsService.ts";

it.effect("shipping analytics stays off even with inherited T3 telemetry credentials", () =>
  Effect.gen(function* () {
    const analytics = yield* AnalyticsService.AnalyticsService;
    yield* analytics.record("launch");
    yield* analytics.flush;
  }).pipe(
    Effect.provide(AnalyticsService.layer),
    Effect.provideService(
      HttpClient.HttpClient,
      HttpClient.make(() =>
        Effect.sync(() => {
          throw new Error("Telemetry must never send");
        }),
      ),
    ),
    Effect.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          T3CODE_TELEMETRY_ENABLED: true,
          T3CODE_POSTHOG_KEY: "test",
          T3CODE_POSTHOG_HOST: "https://example.invalid",
        }),
      ),
    ),
  ),
);
