import { RiskIndicator } from "./components/RiskStatus";
import { XPProgressBar } from "./components/XPBar";
import { BadgeGrid, Badge } from "./components/Badges";
import { QuickTips } from "./components/QuickTips";
import { PanicButton } from "./components/PanicButton";

export default function Popup() {
    const dummyBadges: Badge[] = [
        { id: '1', name: "Phish Spotter", icon: 'eye', earned: true, description: "Identified a phishing attempt." },
        { id: '2', name: "Password Pro", icon: 'lock', earned: true, description: "Enabled 2FA on main accounts." },
        { id: '3', name: "First Steps", icon: 'award', earned: true, description: "Completed the hygiene starter guide." },
        { id: '4', name: "Security Ace", icon: 'shield', earned: false, description: "Achieved max account security score." },
        { id: '5', name: "Quick Learner", icon: 'zap', earned: false, description: "Aced the security quiz." },
        { id: '6', name: "Keymaster", icon: 'key', earned: false, description: "Uses a password manager." },
    ];

    const dummyTips = [
        { id: '1', text: "Always verify the sender before clicking email links.", type: 'info' as const },
        { id: '2', text: "Great job keeping your extensions updated!", type: 'success' as const }
    ];

    const handlePanic = () => {
        alert("Panic button clicked! Executing guided recovery.");
    };

    return (
        <div className="w-[380px] h-[600px] bg-background border-4 border-border relative overflow-hidden flex flex-col font-mono text-foreground font-medium">

            {/* Header */}
            <div className="bg-background border-b-2 border-border p-4 flex-shrink-0 flex items-start justify-between">
                <div>
                    <h1 className="text-xl font-bold font-['Syne']">
                        AI Hygiene Companion
                    </h1>
                    <p className="text-[10px] text-muted-foreground mt-1">
                        Browser Extension v1.0
                    </p>
                </div>

                <div className="size-8 border-2 border-border flex items-center justify-center text-muted-foreground cursor-pointer hover:bg-accent transition-colors">
                    ⚙
                </div>
            </div>

            {/* Main Content - Scrollable Region */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-4 bg-[#f8f9fa]">
                <RiskIndicator level="safe" />

                <XPProgressBar currentXP={350} maxXP={500} level={2} />

                <BadgeGrid badges={dummyBadges} />

                <QuickTips tips={dummyTips} />

                {/* Panic Button Area */}
                <div className="pt-2">
                    <PanicButton onClick={handlePanic} />
                </div>
            </div>

            {/* Footer */}
            <div className="bg-background border-t-2 border-border p-2">
                <button className="w-full flex justify-center items-center gap-2 hover:bg-accent transition-colors py-2 text-xs font-mono">
                    <span>🔌</span> Browser Extension Popup
                </button>
            </div>
        </div>
    );
}