// src/popup/components/ThreatList.tsx
// Displays active threats detected by ML models for the current tab.
// Updates in real-time via background message broadcasts.

import { useEffect, useState } from "react";
import { AlertTriangle, Shield, Cpu, Loader2 } from "lucide-react";

interface ThreatListProps {
  /** Initial threat list (pre-populated from background on mount) */
  initialThreats?: string[];
}

type ThreatTag = {
  label: string;
  severity: "high" | "medium" | "info";
};

function classifyThreat(threat: string): ThreatTag {
  const l = threat.toLowerCase();
  if (l.includes("phishing") || l.includes("dangerous") || l.includes("credential")) {
    return { label: threat, severity: "high" };
  }
  if (l.includes("deceptive") || l.includes("suspicious") || l.includes("external form") || l.includes("pii")) {
    return { label: threat, severity: "medium" };
  }
  return { label: threat, severity: "info" };
}

const severityStyle: Record<string, string> = {
  high: "bg-red-100 text-red-800 border-red-300",
  medium: "bg-amber-100 text-amber-800 border-amber-300",
  info: "bg-blue-50 text-blue-800 border-blue-200",
};

export function ThreatList({ initialThreats = [] }: ThreatListProps) {
  const [threats, setThreats] = useState<string[]>(initialThreats);
  const [mlScanning, setMlScanning] = useState(false);
  const [mlScore, setMlScore] = useState<number | null>(null);
  const [modelName, setModelName] = useState<string>("");

  useEffect(() => {
    const handler = (msg: Record<string, unknown>) => {
      if (msg.type === "threatUpdate" && Array.isArray(msg.threats)) {
        setThreats(msg.threats as string[]);
      }
      if (msg.type === "mlRiskResult") {
        if (typeof msg.mlScorePct === "number") setMlScore(msg.mlScorePct);
        if (typeof msg.modelVersion === "string") setModelName(msg.modelVersion);
        // Merge threat list if present
        if (Array.isArray(msg.threats)) setThreats(msg.threats as string[]);
      }
      if (msg.type === "mlScanStart") setMlScanning(true);
      if (msg.type === "mlScanDone") setMlScanning(false);
      // PII threat injection
      if (msg.type === "piiDetected") {
        setThreats(prev => {
          const tag = `PII Detected in Form`;
          return prev.includes(tag) ? prev : [...prev, tag];
        });
      }
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, []);

  const taggedThreats = threats.map(classifyThreat);

  return (
    <div className="border-2 border-border bg-background p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-[10px] text-muted-foreground uppercase font-mono tracking-widest font-bold">
            Detected Threats
          </h2>
        </div>
        {/* Scanning indicator */}
        <div className="flex items-center gap-1.5">
          {mlScanning ? (
            <>
              <Loader2 className="size-3 text-amber-500 animate-spin" />
              <span className="text-[9px] font-mono text-amber-600 font-bold">SCANNING</span>
            </>
          ) : (
            <>
              <div className="size-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[9px] font-mono text-emerald-600 font-bold">MODELS ACTIVE</span>
            </>
          )}
        </div>
      </div>

      {/* Model info pill */}
      {modelName && (
        <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground font-mono">
          <Cpu className="size-2.5" />
          <span className="truncate">{modelName}</span>
          {mlScore !== null && (
            <span className="ml-auto font-bold text-foreground">{mlScore}% confidence</span>
          )}
        </div>
      )}

      {/* Threat tags */}
      {taggedThreats.length === 0 ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Shield className="size-4 text-emerald-500" />
          <span>No threats detected on this page</span>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {taggedThreats.map((t, i) => (
            <span
              key={i}
              className={`inline-flex items-center gap-1 text-[10px] font-bold border px-2 py-0.5 rounded-sm ${severityStyle[t.severity]}`}
            >
              {t.severity !== "info" && <AlertTriangle className="size-2.5 flex-shrink-0" />}
              {t.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
