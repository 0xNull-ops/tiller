import { useState, type ComponentProps } from "react";
import { WelcomePage } from "../../components/onboarding/WelcomePage";
import { useClientSettings } from "../../hooks/useSettings";
import { completeOnboarding } from "../../onboarding/firstRun";
import { WelcomeScreen } from "./WelcomeScreen";

export function LaunchWelcomePage(props: ComponentProps<typeof WelcomePage>) {
  const completed = useClientSettings((settings) => settings.onboardingCompletedAt !== null);
  const [welcomeOpen, setWelcomeOpen] = useState(!completed);
  if (!welcomeOpen) return <WelcomePage {...props} />;
  return (
    <WelcomeScreen
      onBegin={() => setWelcomeOpen(false)}
      onSkip={() =>
        completeOnboarding().then(
          async () => {
            await props.onDone();
            return true;
          },
          () => false,
        )
      }
    />
  );
}
