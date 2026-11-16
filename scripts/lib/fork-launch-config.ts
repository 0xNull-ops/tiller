export function launchBuildEnvironment(env: Record<string, string | undefined>) {
  return Object.fromEntries(
    Object.entries(env).map(([key, value]) => [
      key,
      /CLERK|RELAY|CONNECT|OTLP/.test(key) ? "" : value,
    ]),
  );
}
