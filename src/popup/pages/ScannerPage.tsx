import { useState, useRef, useCallback, useEffect } from "react";

type RiskLevel = "safe" | "warning" | "danger";
type LogType = "ok" | "warn" | "danger";
type PipeState = "idle" | "active" | "done" | "error";

interface ScenarioSignal {
  posts?: number;
  reports?: number;
  answers?: number;
  findings: string;
  score: number;
}

interface Scenario {
  risk: RiskLevel;
  verdict: string;
  npuScore: number;
  heuristics: string[];
  reddit: ScenarioSignal;
  quora: ScenarioSignal;
  logs: [string, string, LogType][];
}

interface LogEntry {
  time: string;
  src: string;
  msg: string;
  type: LogType;
}

const SCENARIOS: Record<string, Scenario> = {
  paypa1: {
    risk: "danger",
    verdict: "High phishing risk — scam confirmed via community reports",
    npuScore: 0.94,
    heuristics: ["typosquatting", "suspicious_tld:tk", "redirect_param", "urgency_language"],
    reddit: { posts: 3, reports: 12, findings: "12 community reports in r/Scams and r/phishing. Domain flagged as credential harvester.", score: 0.91 },
    quora: { answers: 5, findings: "5 answers confirming phishing. Users report redirects to fake login pages.", score: 0.89 },
    logs: [
      ["npu", "Tokenizing URL for ScamLM-sim embedding...", "ok"],
      ["heur", "Typosquatting detected: paypa1 ~= paypal", "warn"],
      ["reddit", "Found 3 posts mentioning domain, 12 flagged reports", "danger"],
      ["quora", "5 answers reference this domain as active scam", "danger"],
      ["npu", "ScamLM phishing probability: 0.94", "danger"],
      ["npu", "Final verdict: DANGER — fused score 0.91", "danger"],
    ],
  },
  google: {
    risk: "safe",
    verdict: "Verified brand domain — no community risk signals",
    npuScore: 0.03,
    heuristics: ["known_brand:google", "https_verified"],
    reddit: { posts: 0, reports: 0, findings: "No scam reports found. Domain is a verified brand.", score: 0.02 },
    quora: { answers: 0, findings: "No adverse mentions. Community references are informational only.", score: 0.01 },
    logs: [
      ["heur", "Known brand match: google.com", "ok"],
      ["reddit", "Zero scam reports — domain trusted by community", "ok"],
      ["quora", "No adverse Quora mentions found", "ok"],
      ["npu", "Final verdict: SAFE — fused score 0.02", "ok"],
    ],
  },
  amazon: {
    risk: "danger",
    verdict: "Typosquat + community-confirmed scam domain",
    npuScore: 0.97,
    heuristics: ["typosquatting", "suspicious_tld:xyz", "free_gift_lure", "ip_redirect"],
    reddit: { posts: 7, reports: 31, findings: "31 reports across scam communities. Users report malware flow via fake gift page.", score: 0.96 },
    quora: { answers: 9, findings: "9 Quora answers warning users. Tagged as Amazon scam and gift card fraud.", score: 0.94 },
    logs: [
      ["heur", "Typosquatting: amaz0n ~= amazon", "warn"],
      ["heur", "Suspicious TLD .xyz flagged", "warn"],
      ["reddit", "HIGH ALERT: 31 community reports for this domain", "danger"],
      ["quora", "9 Quora answers: explicit scam warnings", "danger"],
      ["npu", "ScamLM phishing probability: 0.97", "danger"],
    ],
  },
};

function getScenario(url: string): Scenario {
  const lower = url.toLowerCase();
  if (lower.includes("paypa1")) return SCENARIOS.paypa1;
  if (lower.includes("google")) return SCENARIOS.google;
  if (lower.includes("amaz0n")) return SCENARIOS.amazon;
  return /^https:\/\//.test(lower) ? SCENARIOS.google : SCENARIOS.paypa1;
}

export default function ScannerPage({ onBack }: { onBack: () => void }) {
  const [url, setUrl] = useState("");
  const [scanning, setScanning] = useState(false);
  const [statusState, setStatusState] = useState<"idle" | "loading" | "ready">("idle");
  const [utilPct, setUtilPct] = useState(0);
  const [tput, setTput] = useState("0 inf/s");
  const [latency, setLatency] = useState("—");
  const [cores, setCores] = useState<("idle" | "active" | "hot")[]>(Array(16).fill("idle"));
  const [pipes, setPipes] = useState<PipeState[]>(Array(5).fill("idle") as PipeState[]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [result, setResult] = useState<Scenario | null>(null);
  const [confPct, setConfPct] = useState(0);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const addLog = useCallback((src: string, msg: string, type: LogType) => {
    const time = new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setLogs((prev) => [...prev, { time, src, msg, type }]);
  }, []);
  const updateCores = (active: number, hot: number) => {
    setCores(Array(16).fill(null).map((_, i) => (i < hot ? "hot" : i < active ? "active" : "idle")));
  };
  const setPipe = (idx: number, state: PipeState) => setPipes((prev) => prev.map((p, i) => (i === idx ? state : p)) as PipeState[]);

  const startScan = async () => {
    if (scanning || !url.trim()) return;
    setScanning(true);
    setStatusState("loading");
    setLogs([]);
    setPipes(Array(5).fill("idle") as PipeState[]);
    setResult(null);
    setConfPct(0);
    updateCores(0, 0);
    setUtilPct(0);
    setTput("0 inf/s");
    setLatency("—");

    const scen = getScenario(url);
    setPipe(0, "active");
    addLog("npu", `URL received: ${url.substring(0, 60)}`, "ok");
    updateCores(4, 0);
    setUtilPct(25);
    await sleep(500);
    setPipe(0, "done");

    setPipe(1, "active");
    updateCores(10, 2);
    setUtilPct(62);
    setTput("3 inf/s");
    for (const [src, msg, type] of scen.logs.filter((l) => l[0] === "reddit")) {
      addLog(src, msg, type);
      await sleep(280);
    }
    setPipe(1, "done");

    setPipe(2, "active");
    for (const [src, msg, type] of scen.logs.filter((l) => l[0] === "quora")) {
      addLog(src, msg, type);
      await sleep(260);
    }
    setPipe(2, "done");

    setPipe(3, "active");
    updateCores(16, 5);
    setUtilPct(100);
    setTput("11 inf/s");
    setLatency("18ms");
    for (const [src, msg, type] of scen.logs.filter((l) => l[0] === "npu")) {
      addLog(src, msg, type);
      await sleep(280);
    }
    setPipe(3, "done");

    setPipe(4, "active");
    updateCores(8, 1);
    setUtilPct(51);
    for (const [src, msg, type] of scen.logs.filter((l) => l[0] === "heur")) {
      addLog(src, msg, type);
      await sleep(220);
    }
    setPipe(4, "done");

    updateCores(3, 0);
    setUtilPct(18);
    setTput("1 inf/s");
    setStatusState("ready");
    setResult(scen);
    setTimeout(() => setConfPct(Math.round(scen.npuScore * 100)), 100);
    setScanning(false);
  };

  const quick = [
    { label: "paypa1-secure.tk", url: "http://paypa1-secure.tk/verify-account" },
    { label: "google.com", url: "https://accounts.google.com/signin" },
    { label: "amaz0n-deals.xyz", url: "http://amaz0n-deals.xyz/free-gift" },
  ];

  return (
    <div className="w-[380px] h-[600px] bg-background border-4 border-border flex flex-col font-mono text-foreground">
      <div className="bg-background border-b-2 border-border p-4 flex items-center gap-3">
        <button onClick={onBack} className="text-lg hover:bg-accent transition-colors px-2 py-1 border border-border rounded">←</button>
        <h2 className="text-lg font-bold font-['Syne']">Scanner</h2>
        <span className="ml-auto text-[10px] px-2 py-0.5 rounded bg-blue-700 text-blue-100">AMD XDNA NPU</span>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[#f8f9fa]">
        <div className="text-[11px] text-muted-foreground">Social Context Risk Engine • {statusState === "loading" ? "scanning..." : statusState}</div>
        <div className="flex gap-2">
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && startScan()}
            placeholder="Enter URL to scan"
            className="flex-1 text-xs px-3 py-2 border border-border bg-white"
          />
          <button onClick={startScan} disabled={scanning || !url.trim()} className="px-3 py-2 text-xs border-2 border-border bg-foreground text-background disabled:opacity-50">
            {scanning ? "..." : "Scan"}
          </button>
        </div>
        <div className="flex gap-1 flex-wrap">
          {quick.map((q) => (
            <button key={q.url} onClick={() => setUrl(q.url)} className="text-[10px] px-2 py-1 border border-border bg-white">
              {q.label}
            </button>
          ))}
        </div>
        <div className="border-2 border-border bg-white p-2 text-xs grid grid-cols-3 gap-2">
          <div>Util: <span className="font-bold">{utilPct}%</span></div>
          <div>Tput: <span className="font-bold">{tput}</span></div>
          <div>Lat: <span className="font-bold">{latency}</span></div>
        </div>
        <div className="grid grid-cols-16 gap-1 border-2 border-border bg-white p-2">
          {cores.map((state, i) => (
            <div key={i} className={`h-2 ${state === "hot" ? "bg-red-500" : state === "active" ? "bg-blue-500" : "bg-gray-300"}`} />
          ))}
        </div>
        <div className="border-2 border-border bg-white p-2 text-[10px] space-y-1">
          {["URL parse", "Reddit scan", "Quora scan", "NPU infer", "Score fuse"].map((name, i) => (
            <div key={name} className="flex items-center justify-between">
              <span>{name}</span>
              <span className={pipes[i] === "done" ? "text-green-700" : pipes[i] === "active" ? "text-blue-700" : "text-muted-foreground"}>{pipes[i]}</span>
            </div>
          ))}
        </div>
        <div className="border-2 border-border bg-white">
          <div className="text-[10px] border-b border-border px-2 py-1">Scan Log ({logs.length})</div>
          <div ref={logRef} className="p-2 text-[10px] h-32 overflow-y-auto">
            {logs.length === 0 ? <div className="text-muted-foreground">Awaiting scan...</div> : logs.map((l, idx) => (
              <div key={idx} className="mb-1">
                <span className="text-muted-foreground">{l.time}</span> <span>[{l.src}]</span> <span>{l.msg}</span>
              </div>
            ))}
          </div>
        </div>
        {result && (
          <div className="border-2 border-border bg-white p-3 space-y-2">
            <div className={`font-bold ${result.risk === "danger" ? "text-red-700" : result.risk === "warning" ? "text-amber-700" : "text-green-700"}`}>{result.verdict}</div>
            <div className="text-xs">Confidence: {confPct}%</div>
            <div className="h-2 bg-gray-200">
              <div className={`h-full ${result.risk === "danger" ? "bg-red-500" : result.risk === "warning" ? "bg-amber-500" : "bg-green-500"}`} style={{ width: `${confPct}%` }} />
            </div>
            <div className="text-[10px] text-muted-foreground">Heuristics: {result.heuristics.join(", ")}</div>
          </div>
        )}
      </div>
    </div>
  );
}
