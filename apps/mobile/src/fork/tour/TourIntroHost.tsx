import { useEffect } from "react";
import { Modal, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { TOUR_INTRO_CARDS } from "./tourIntroStore";
import { tourIntroStore, useTourIntro } from "./tourIntro";

/** Mounted once at the app root: the first-open intro and "Replay intro" from Settings. */
export function TourIntroHost() {
  const { open, index } = useTourIntro();
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Offers the intro once per launch on a device that has not seen it, from device storage.
  useEffect(() => {
    void tourIntroStore.offerIfNew();
  }, []);
  const card = TOUR_INTRO_CARDS[index];
  if (card === undefined) return null;
  const last = index + 1 >= TOUR_INTRO_CARDS.length;
  return (
    <Modal
      visible={open}
      presentationStyle="pageSheet"
      animationType="slide"
      onRequestClose={tourIntroStore.skip}
    >
      <View className="flex-1 justify-between bg-screen px-6 pb-10 pt-8">
        <View className="gap-3">
          <Text className="text-foreground-muted">
            {index + 1} of {TOUR_INTRO_CARDS.length}
          </Text>
          <Text className="font-t3-semibold text-2xl text-foreground">{card.title}</Text>
          <Text className="text-foreground-muted">{card.body}</Text>
        </View>
        <View className="gap-3">
          <Button
            tone="primary"
            fullWidth
            label={last ? "Done" : "Next"}
            onPress={tourIntroStore.next}
          />
          <View className="flex-row justify-between">
            <Button tone="text" label="Skip" onPress={tourIntroStore.skip} />
            {index > 0 ? <Button tone="text" label="Back" onPress={tourIntroStore.back} /> : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}
