// src/popup/pages/Onboarding.tsx
// 4-step onboarding wizard for first-time users

import { useState, useEffect } from "react";

const steps = [
  {
    title: "Welcome to AI Hygiene Companion",
    content:
      "We'll help you browse safely and learn digital hygiene skills through gamification.",
    icon: "🛡️",
  },
  {
    title: "How It Works",
    content:
      "We analyze websites in real-time using AI and warn you about potential phishing threats. Green means safe, yellow means caution, red means danger.",
    icon: "🔍",
  },
  {
    title: "Earn Rewards",
    content:
      "Safe browsing earns XP and badges. Level up to unlock new titles and track your progress over time.",
    icon: "🏆",
  },
  {
    title: "Panic Button",
    content:
      "If you think you've made a mistake (clicked a suspicious link, entered info on a sketchy site), click the red 'I Think I Messed Up' button for guided recovery steps.",
    icon: "🆘",
  },
];

interface OnboardingPageProps {
  onComplete: () => void;
}

export function OnboardingPage({ onComplete }: OnboardingPageProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    // Check if user has already completed onboarding
    chrome.storage.local.get(["onboardingCompleted"]).then((result) => {
      if (result.onboardingCompleted) {
        onComplete();
      }
    });
  }, [onComplete]);

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      setCompleted(true);
      chrome.storage.local.set({ onboardingCompleted: true });
      onComplete();
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleSkip = () => {
    chrome.storage.local.set({ onboardingCompleted: true });
    onComplete();
  };

  if (completed) {
    return null;
  }

  const step = steps[currentStep];

  return (
    <div className="w-[380px] h-[600px] bg-background border-4 border-border flex flex-col font-mono text-foreground overflow-hidden">
      {/* Progress Indicator */}
      <div className="bg-background border-b-2 border-border p-4">
        <div className="flex items-center gap-2">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`h-2 flex-1 rounded-full transition-colors ${
                i <= currentStep ? "bg-primary" : "bg-muted"
              }`}
            />
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-2 text-center">
          Step {currentStep + 1} of {steps.length}
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col items-center justify-center p-8 bg-[#f8f9fa]">
        <div className="text-6xl mb-6">{step.icon}</div>
        <h2 className="text-xl font-bold font-['Syne'] text-center mb-4">{step.title}</h2>
        <p className="text-sm text-muted-foreground text-center leading-relaxed">
          {step.content}
        </p>
      </div>

      {/* Navigation */}
      <div className="bg-background border-t-2 border-border p-4 space-y-3">
        <button
          onClick={handleNext}
          className="w-full bg-foreground text-background border-2 border-border px-4 py-3 text-sm font-bold font-['Syne'] hover:opacity-80 transition-opacity"
        >
          {currentStep === steps.length - 1 ? "Get Started" : "Next"}
        </button>

        <div className="flex gap-3">
          {currentStep > 0 && (
            <button
              onClick={handlePrev}
              className="flex-1 bg-secondary text-secondary-foreground border-2 border-border px-4 py-3 text-sm font-medium hover:bg-secondary/80 transition-colors"
            >
              Previous
            </button>
          )}
          <button
            onClick={handleSkip}
            className="flex-1 text-muted-foreground border-2 border-border px-4 py-3 text-sm font-medium hover:bg-accent transition-colors"
          >
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}
