import { useState } from "react";
import { TextInput, View } from "react-native";
import { AppText } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ErrorBanner } from "../../components/ui/ErrorBanner";
import { Sheet } from "../../components/ui/Sheet";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";

export function CredentialUnlockSheet({
  busy,
  error,
  onSubmit,
  onClose,
}: {
  readonly busy: boolean;
  readonly error: string | null;
  readonly onSubmit: (pin: string) => Promise<void>;
  readonly onClose: () => void;
}) {
  const [pin, setPin] = useState("");
  const submit = () => {
    if (busy || !pin) return;
    void onSubmit(pin);
    setPin("");
  };
  return (
    <Sheet title="Unlock credentials" onClose={onClose}>
      <ScreenScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-4 p-5"
      >
        <AppText>Enter the credential PIN for this environment.</AppText>
        <TextInput
          accessibilityLabel="Credential PIN"
          secureTextEntry
          keyboardType="number-pad"
          autoComplete="off"
          autoCorrect={false}
          maxLength={128}
          value={pin}
          onChangeText={setPin}
          editable={!busy}
          onSubmitEditing={submit}
          className="rounded-xl border border-border p-3 text-foreground"
        />
        {error ? <ErrorBanner message={error} /> : null}
        <View className="flex-row gap-2">
          <Button label="Unlock" tone="primary" disabled={busy || !pin} onPress={submit} />
          <Button label="Cancel" disabled={busy} onPress={onClose} />
        </View>
      </ScreenScrollView>
    </Sheet>
  );
}
