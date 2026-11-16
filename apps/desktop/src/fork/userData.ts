import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

export const resolveTillerUserDataPath = Effect.fn("tiller.userData.resolvePath")(function* (
  fallback: string,
) {
  const override = yield* Config.option(Config.String("TILLER_DESKTOP_USER_DATA_DIR"));
  return Option.getOrElse(
    Option.filter(override, (directory) => directory.trim().length > 0),
    () => fallback,
  );
}, Effect.orDie);
