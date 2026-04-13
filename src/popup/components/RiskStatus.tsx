// src/popup/components/RiskStatus.tsx
// Risk status card — shows current level, ML score, and scanning indicator.

import { useEffect, useState } from "react";
import { Shield, AlertTriangle, AlertCircle, Loader2 } from "lucide-react";

type RiskLevel = "safe" | "warning" | "danger";

export function RiskStatus() {
  const [level, setLevel] = useState<RiskLevel>("safe");
  const [mlScorePct, setMlScorePct] = useState<number | null>(null);
  const [mlScanning, setMlScanning] = useState(false);

  useEffect(() => {
    // Load current risk level on mount
    chrome.runtime.sendMessage({ type: "getRiskLevel" }).then((res) => {
      if (res?.level) setLevel(res.level);
    }).catch(() => {});

    const handler = (msg: Record<string, unknown>) => {
      if (msg.type === "riskUpdate" && msg.level) setLevel(msg.level as RiskLevel);
      if (msg.type === "mlRiskResult") {
        if (msg.level) setLevel(msg.level as RiskLevel);
        if (typeof msg.mlScorePct === "number") setMlScorePct(msg.mlScorePct);
      }
      if (msg.type === "mlScanStart") setMlScanning(true);
      if (msg.type === "mlScanDone") setMlScanning(false);
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
      scoreBg: "bg-emerald-100 text-emerald-700",
    },
    warning: {
      Icon: AlertTriangle,
      label: "Caution",
      message: "Double-check before sharing info here",
      color: "text-amber-600",
      bg: "bg-amber-50",
      border: "border-amber-500",
      scoreBg: "bg-amber-100 text-amber-700",
    },
    danger: {
      Icon: AlertCircle,
      label: "High Risk",
      message: "This site looks dangerous!",
      color: "text-red-600",
      bg: "bg-red-50",
      border: "border-red-500",
      scoreBg: "bg-red-100 text-red-700",
    },
  }[level];

  const { Icon } = config;

  return (
    <div className={`border-2 border-border p-4 flex items-center gap-4 ${config.bg}`}>
      {/* Icon */}
      <div className={`size-12 border-2 ${config.border} flex items-center justify-center bg-white flex-shrink-0 relative`}>
        <Icon className={`${config.color} size-6`} />
        {/* Scanning dot overlay */}
        {mlScanning && (
          <span className="absolute -top-1 -right-1 size-3 flex items-center justify-center">
            <Loader2 className="size-3 text-amber-500 animate-spin" />
          </span>
        )}
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <h2 className="text-[10px] text-muted-foreground uppercase font-mono tracking-widest font-bold mb-0.5">
          RISK STATUS
        </h2>
        <div className="flex items-baseline gap-2 flex-wrap">
          <p className={`font-bold text-base font-['Syne'] ${config.color}`}>{config.label}</p>
          {mlScorePct !== null && (
            <span className={`text-[10px] font-mono font-bold px-1.5 py-0 rounded ${config.scoreBg}`}>
              {mlScorePct}%
            </span>
          )}
        </div>
        <p className="text-muted-foreground text-xs font-mono mt-0.5">
          {mlScanning ? "On-device models scanning…" : config.message}
        </p>
      </div>
    </div>
  );
}
