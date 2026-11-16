/** Keep oversized seams advisory; missing fork markers remain the hard failure. */
export const FORK_LINE_WARN_LIMIT = 20;

interface UpstreamFileLines {
  readonly path: string;
  readonly added: number;
  readonly removed: number;
}

/** Upstream files carrying more than `limit` fork lines, worst first. */
export function oversizedUpstreamFiles(
  files: readonly UpstreamFileLines[],
  limit: number = FORK_LINE_WARN_LIMIT,
): readonly UpstreamFileLines[] {
  return files
    .filter((file) => file.added > limit)
    .sort((a, b) => b.added - a.added || a.path.localeCompare(b.path));
}

/** Warning lines for the status report, or nothing when every upstream file is small. */
export function oversizedSeamWarning(
  files: readonly UpstreamFileLines[],
  limit: number = FORK_LINE_WARN_LIMIT,
): readonly string[] {
  const oversized = oversizedUpstreamFiles(files, limit);
  if (oversized.length === 0) return [];
  return [
    `Upstream files with more than ${limit} fork lines (move the logic into a fork-owned file):`,
    ...oversized.map((file) => `  ${file.path} +${file.added}`),
  ];
}

export function launchIdentityViolations(path: string, source: string): readonly string[] {
  if (
    /(?:^|\/)mobile\//.test(path) ||
    /\.(?:test|spec)\./.test(path) ||
    path.endsWith("/MobileAppSettingsRow.tsx") ||
    !/^(?:apps\/(?:server|web|desktop)\/src\/|packages\/shared\/src\/|scripts\/(?:build-desktop-artifact\.ts|build-npm-launcher\.ts|npm-launcher\/))/.test(
      path,
    )
  )
    return [];
  return source
    .split(/\r?\n/)
    .flatMap((line, index) =>
      /registry\.npmjs\.org\/t3\/|ingest\.t3\.codes|com\.t3tools\.t3code|\bt3code(?:-dev)?:(?:\/\/|")|(?:github\.com\/|["'])pingdotgg\/t3code(?:\/releases|["'])/.test(
        line,
      ) && !line.includes("resources/linux/com.t3tools.t3code.metainfo.xml")
        ? [`${path}:${index + 1}: upstream launch identity`]
        : [],
    );
}
