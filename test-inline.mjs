import { analyzeUrl } from './src/lib/risk-detection.ts';

const r = analyzeUrl("https://google.com");
console.log("google.com:", JSON.stringify(r));
console.log("Expected: score < 15, Actual:", r.score);
