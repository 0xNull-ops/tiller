import { View } from "react-native";

import { AppText } from "../../components/ui/AppText";
import { cn } from "../../lib/cn";
import { credentialBrandMark } from "./credentialBrandTile";

const TILE_SIZE = { sm: 28, lg: 40 } as const;

/**
 * The brand mark beside a credential. Decorative: the row already announces the
 * name, type and status, so screen readers skip the tile.
 */
export function CredentialBrandMark(props: {
  readonly name: string;
  readonly templateIcon?: string | null | undefined;
  readonly iconOverride?: string | null | undefined;
  readonly envVars?: readonly string[] | undefined;
  readonly size?: keyof typeof TILE_SIZE;
}) {
  const size = props.size ?? "sm";
  const mark = credentialBrandMark({
    name: props.name,
    templateIcon: props.templateIcon,
    iconOverride: props.iconOverride,
    envVars: props.envVars,
  });
  const dimension = TILE_SIZE[size];
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className={cn("items-center justify-center", mark.background === null && "bg-subtle-strong")}
      style={{
        width: dimension,
        height: dimension,
        borderRadius: Math.round(dimension * 0.3),
        ...(mark.background === null ? {} : { backgroundColor: mark.background }),
      }}
    >
      <AppText
        textRole={size === "lg" ? "label" : "caption"}
        className={cn("font-t3-medium", mark.foreground === null && "text-foreground-muted")}
        style={mark.foreground === null ? undefined : { color: mark.foreground }}
        numberOfLines={1}
      >
        {mark.text}
      </AppText>
    </View>
  );
}
