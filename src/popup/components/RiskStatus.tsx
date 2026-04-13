import { useEffect, useState } from "react";
import { Shield, AlertTriangle, AlertCircle } from "lucide-react";

type RiskLevel = "safe" | "warning" | "danger";

export function RiskStatus() {
  const [level, setLevel] = useState<RiskLevel>("safe");

  useEffect(() => {
    // Load current risk level on mount
    chrome.runtime.sendMessage({ type: "getRiskLevel" }).then((res) => {
      if (res?.level) setLevel(res.level);
    }).catch(() => {});

    // Listen for background updates
    const handler = (msg: Record<string, unknown>) => {
      if (msg.type === "riskUpdate" && msg.level) setLevel(msg.level as RiskLevel);
      if (msg.type === "mlRiskResult" && msg.level) setLevel(msg.level as RiskLevel);
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, []);

  const config = {
    safe: {
      Icon: Shield,
      label: "Low Risk",
      message: "You're browsing safely",
      color: "text-emerald-600",
      bg: "bg-emerald-50",
      border: "border-emerald-500",
    },
    warning: {
      Icon: AlertTriangle,
      label: "Caution",
      message: "Double-check before sharing info here",
      color: "text-amber-600",
      bg: "bg-amber-50",
      border: "border-amber-500",
    },
    danger: {
      Icon: AlertCircle,
      label: "High Risk",
      message: "This site looks dangerous!",
      color: "text-red-600",
      bg: "bg-red-50",
      border: "border-red-500",
    },
  }[level];

  const { Icon } = config;

  return (
    <div className={`border-2 border-border p-4 flex items-center gap-4 ${config.bg}`}>
      <div className={`size-12 border-2 ${config.border} flex items-center justify-center bg-white flex-shrink-0`}>
        <Icon className={`${config.color} size-6`} />
      </div>
      <div>
        <h2 className="text-[10px] text-muted-foreground uppercase font-mono tracking-widest font-bold mb-0.5">
          RISK STATUS
        </h2>
        <p className={`font-bold text-base font-['Syne'] ${config.color}`}>{config.label}</p>
        <p className="text-muted-foreground text-xs font-mono mt-0.5">{config.message}</p>
      </div>
    </div>
  );
}
