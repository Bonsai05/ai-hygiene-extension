import { analyzeUrl } from './src/lib/risk-detection.ts';
import { TYPOSQUAT_PATTERNS, KNOWN_BRANDS } from './src/lib/constants.ts';

console.log("TYPOSQUAT_PATTERNS:", TYPOSQUAT_PATTERNS);
console.log("KNOWN_BRANDS:", KNOWN_BRANDS);

console.log("\nTesting detectTyposquatting logic:");
const hostname = "google.com";
console.log("hostname:", hostname);
console.log("hostname.toLowerCase():", hostname.toLowerCase());
console.log("TYPOSQUAT_PATTERNS[0].test('google.com'):", TYPOSQUAT_PATTERNS[0].test("google.com"));
console.log("TYPOSQUAT_PATTERNS[0].test('g00gle.com'):", TYPOSQUAT_PATTERNS[0].test("g00gle.com"));
console.log("TYPOSQUAT_PATTERNS.some(p => p.test('google.com')):", TYPOSQUAT_PATTERNS.some(p => p.test("google.com")));

console.log("\nActual analyzeUrl result:");
const r = analyzeUrl("https://google.com");
console.log("google.com:", JSON.stringify(r, null, 2));
