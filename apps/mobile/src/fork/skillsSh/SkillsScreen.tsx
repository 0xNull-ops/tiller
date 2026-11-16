import type { StaticScreenProps } from "@react-navigation/native";
import { useState } from "react";
import { Alert, Linking, Modal, Pressable, TextInput, View } from "react-native";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, SkillsShPreview, SkillsShResult } from "@t3tools/contracts";
import { createSkillsShCommands } from "@t3tools/client-runtime/state/skillsSh";
import { connectionAtomRuntime } from "../../connection/runtime";
import { useAtomCommand } from "../../state/use-atom-command";
import { AppText as Text } from "../../components/ui/AppText";
import { ScreenContent } from "../../components/ui/ScreenContent";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { SettingsScreen } from "../../features/settings/components/SettingsScreen";
import { useSettingsEnvironmentFilter } from "../../features/settings/settings-environment-filter";

const commands = createSkillsShCommands(connectionAtomRuntime);
export function SkillsScreen(_props: StaticScreenProps<undefined>) {
  const { selectedTargets } = useSettingsEnvironmentFilter();
  return (
    <SettingsScreen title="Skills">
      <ScreenContent>
        <ScreenScrollView contentContainerClassName="gap-4 px-5 py-4">
          {selectedTargets.length ? (
            selectedTargets.map((target) => (
              <Skills
                key={target.environmentId}
                environmentId={target.environmentId}
                label={target.label}
              />
            ))
          ) : (
            <Text>Select a connected environment.</Text>
          )}
        </ScreenScrollView>
      </ScreenContent>
    </SettingsScreen>
  );
}
function Skills({ environmentId, label }: { environmentId: EnvironmentId; label: string }) {
  const search = useAtomCommand(commands.search);
  const preview = useAtomCommand(commands.preview);
  const install = useAtomCommand(commands.install);
  const canInstall = useAtomValue(commands.install.permissionAtom(environmentId));
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<readonly (typeof SkillsShResult.Type)[]>([]);
  const [selected, setSelected] = useState<typeof SkillsShPreview.Type | null>(null);
  const [name, setName] = useState("");
  const [project, setProject] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const doInstall = async () => {
    if (!selected || busy) return;
    setBusy(true);
    const result = await install({
      environmentId,
      input: {
        id: selected.id,
        sha: selected.sha,
        name,
        scope: project ? "project" : "global",
        ...(project ? { project } : {}),
      },
    }).catch(() => null);
    setBusy(false);
    if (result?._tag === "Success") {
      setMessage(`Installed ${result.value.name}`);
      setSelected(null);
    } else setMessage("Installation failed. Try a different name if it already exists.");
  };
  return (
    <View className="gap-3">
      <Text className="font-t3-semibold">{label}</Text>
      <TextInput
        accessibilityLabel="Search skills.sh"
        className="rounded-lg border border-border p-3 text-foreground"
        value={query}
        onChangeText={setQuery}
        placeholder="Search skills.sh"
      />
      <Pressable
        accessibilityRole="button"
        onPress={async () => {
          if (query.length < 2) return;
          const result = await search({ environmentId, input: { query } });
          if (result._tag === "Success") setResults(result.value.skills);
          else setMessage("skills.sh isn't reachable. Retry.");
        }}
      >
        <Text>Search</Text>
      </Pressable>
      {results.map((skill) => (
        <Pressable
          key={skill.id}
          accessibilityRole="button"
          onPress={async () => {
            if (skill.id.startsWith("site/")) {
              await Linking.openURL(`https://skills.sh/${skill.id}`);
              return;
            }
            const result = await preview({ environmentId, input: { id: skill.id } });
            if (result._tag === "Success") {
              setSelected(result.value);
              setName(result.value.name);
            }
          }}
        >
          <Text>
            {skill.name} · {skill.source} · {skill.installs} installs
          </Text>
        </Pressable>
      ))}
      <Modal
        visible={selected !== null}
        presentationStyle="pageSheet"
        animationType="slide"
        onRequestClose={() => {
          if (!busy) setSelected(null);
        }}
      >
        <ScreenScrollView contentContainerClassName="gap-4 px-5 py-6">
          {selected ? (
            <View className="gap-3">
              <Text className="font-t3-semibold">{selected.name}</Text>
              <Pressable onPress={() => Linking.openURL(`https://skills.sh/${selected.id}`)}>
                <Text>View on skills.sh</Text>
              </Pressable>
              <Pressable onPress={() => Linking.openURL(selected.sourceUrl)}>
                <Text>GitHub source · {selected.sha.slice(0, 12)}</Text>
              </Pressable>
              <Text>
                {selected.audit ? JSON.stringify(selected.audit, null, 2) : "No audit available"}
              </Text>
              {selected.files.some((file) =>
                /\.(sh|bash|py|js|ts|mjs|cjs|rb|ps1)$/i.test(file.path),
              ) ? (
                <Text>This skill includes scripts your agents may run.</Text>
              ) : null}
              <Text selectable>{selected.markdown}</Text>
              {selected.files.map((file) => (
                <Text key={file.path}>
                  {file.path} · {file.size} bytes
                </Text>
              ))}
              <TextInput
                accessibilityLabel="Install as"
                className="border border-border p-3 text-foreground"
                value={name}
                onChangeText={setName}
              />
              <Text>
                All projects by default. Enter an absolute project path for this project only.
              </Text>
              <TextInput
                accessibilityLabel="Project path (optional)"
                className="border border-border p-3 text-foreground"
                value={project}
                onChangeText={setProject}
                autoCapitalize="none"
              />
              <Pressable
                disabled={!canInstall || busy}
                accessibilityRole="button"
                onPress={() =>
                  Alert.alert(
                    "Install skill?",
                    `Install ${name} to ${project || "all projects"}?`,
                    [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Install",
                        onPress: () => {
                          void doInstall();
                        },
                      },
                    ],
                  )
                }
              >
                <Text>
                  {busy
                    ? "Installing…"
                    : canInstall
                      ? "Confirm install"
                      : "Requires settings write permission"}
                </Text>
              </Pressable>
              <Pressable onPress={() => setSelected(null)}>
                <Text>Close preview</Text>
              </Pressable>
            </View>
          ) : null}
          {message ? <Text>{message}</Text> : null}
        </ScreenScrollView>
      </Modal>
      {message ? <Text>{message}</Text> : null}
    </View>
  );
}
