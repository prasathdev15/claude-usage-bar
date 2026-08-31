#!/usr/bin/env node
//
// <xbar/swiftbar plugin>
// <xbar.title>Claude Usage Bar</xbar.title>
// <xbar.version>v1.0</xbar.version>
// <xbar.author>Prasath</xbar.author>
// <xbar.desc>Shows your Claude Code local token usage and (if the Claude desktop app is installed) your account's 5-hour/weekly plan-limit percentage, right in the menu bar.</xbar.desc>
// <xbar.dependencies>node</xbar.dependencies>
//
// SwiftBar/xbar plugin: Claude Code token usage + Claude plan-limit %, read entirely from local files.
// Nothing here calls any network API — everything is parsed from files already on disk.
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(os.homedir(), '.claude', 'projects');

// $ per million tokens: [input, output, cacheWrite, cacheRead]
// Source: anthropic.com/pricing — update these if Anthropic changes list pricing.
const PRICING = [
  { match: /opus/i, input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  { match: /haiku/i, input: 0.8, output: 4, cacheWrite: 1.0, cacheRead: 0.08 },
  { match: /sonnet/i, input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
];
const DEFAULT_PRICE = PRICING[2];

function priceFor(model) {
  return PRICING.find((p) => p.match.test(model || '')) || DEFAULT_PRICE;
}

function costOf(usage, model) {
  const p = priceFor(model);
  const inTok = usage.input_tokens || 0;
  const outTok = usage.output_tokens || 0;
  const cw = usage.cache_creation_input_tokens || 0;
  const cr = usage.cache_read_input_tokens || 0;
  return (inTok * p.input + outTok * p.output + cw * p.cacheWrite + cr * p.cacheRead) / 1e6;
}

function tokensOf(usage) {
  return (
    (usage.input_tokens || 0) +
    (usage.output_tokens || 0) +
    (usage.cache_creation_input_tokens || 0) +
    (usage.cache_read_input_tokens || 0)
  );
}

function findJsonlFiles(dir) {
  let out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out = out.concat(findJsonlFiles(full));
    else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(full);
  }
  return out;
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function fmtUSD(n) {
  return '$' + n.toFixed(2);
}

function fmtTok(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(n);
}

function bar(pct, slots = 10) {
  const p = Math.max(0, Math.min(100, pct || 0));
  const filled = Math.round((p / 100) * slots);
  return '█'.repeat(filled) + '░'.repeat(slots - filled);
}

// Reads the same local cache the Claude desktop app uses to render its own
// Settings -> Usage "Current session" bar. This is an undocumented, private
// file (not a public API) and may change format in any future app update.
function readPlanUsage() {
  const file = path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'plan-usage-history.json');
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const samples = data.samples || [];
    if (!samples.length) return null;
    const last = samples[samples.length - 1];
    return {
      fh: (last.u && last.u.fh) || 0,
      sd: (last.u && last.u.sd) || 0,
      ageMin: (Date.now() - last.t) / 60000,
    };
  } catch {
    return null;
  }
}

const now = new Date();
const todayStart = startOfDay(now);
const weekStart = new Date(todayStart.getTime() - 6 * 86400000);
const planUsage = readPlanUsage();

let todayCost = 0, todayTok = 0;
let weekCost = 0, weekTok = 0;
let allCost = 0, allTok = 0;
const byModelToday = new Map();
const byProjectToday = new Map();

const files = findJsonlFiles(ROOT);
for (const file of files) {
  let content;
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  const lines = content.split('\n');
  for (const line of lines) {
    if (!line) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (obj.type !== 'assistant' || !obj.message || !obj.message.usage) continue;
    const usage = obj.message.usage;
    const model = obj.message.model || 'unknown';
    const ts = obj.timestamp ? new Date(obj.timestamp) : null;
    const tok = tokensOf(usage);
    const cost = costOf(usage, model);

    allCost += cost;
    allTok += tok;

    if (ts) {
      if (ts >= weekStart) {
        weekCost += cost;
        weekTok += tok;
      }
      if (ts >= todayStart) {
        todayCost += cost;
        todayTok += tok;

        const m = byModelToday.get(model) || { cost: 0, tok: 0 };
        m.cost += cost;
        m.tok += tok;
        byModelToday.set(model, m);

        const proj = path.basename(obj.cwd || 'unknown');
        const pEntry = byProjectToday.get(proj) || { cost: 0, tok: 0 };
        pEntry.cost += cost;
        pEntry.tok += tok;
        byProjectToday.set(proj, pEntry);
      }
    }
  }
}

// Menu bar title — lead with the real plan % (from your account), tokens second.
// The $ estimate is NOT real billing on a Pro/Max plan, so it's kept out of the title.
const titlePrefix = planUsage ? `5h ${planUsage.fh}%` : `${fmtTok(todayTok)} tok`;
console.log(`🧠 ${titlePrefix} | dropdown=true`);
console.log('---');

if (files.length === 0) {
  console.log('No Claude Code logs found yet. | size=13');
  console.log(`--Expected at: ${ROOT}`);
  console.log('--Run `claude` in a project directory to get started.');
  console.log('---');
}

if (planUsage) {
  console.log('Plan usage limits (from your account) | size=13');
  const fhColor = planUsage.fh >= 80 ? 'red' : planUsage.fh >= 50 ? 'orange' : 'green';
  const sdColor = planUsage.sd >= 80 ? 'red' : planUsage.sd >= 50 ? 'orange' : 'green';
  console.log(`--Current session (5h): ${bar(planUsage.fh)} ${planUsage.fh}% used | color=${fhColor} font=Menlo`);
  console.log(`--This week: ${bar(planUsage.sd)} ${planUsage.sd}% used | color=${sdColor} font=Menlo`);
  if (planUsage.ageMin > 20) {
    console.log(`--(stale, ${Math.round(planUsage.ageMin)}m old — open Claude desktop app to refresh) | color=gray size=11`);
  }
  console.log('---');
} else {
  console.log('Plan usage limits: unavailable | size=13 color=gray');
  console.log('--Install/open the Claude desktop app at least once to enable this section. | color=gray size=11');
  console.log('---');
}

console.log(`Local token counts (Claude Code logs) | size=13`);
console.log(`Today: ${fmtTok(todayTok)} tok`);
console.log(`Last 7 days: ${fmtTok(weekTok)} tok`);
console.log(`All-time: ${fmtTok(allTok)} tok`);
console.log('---');
console.log(`Hypothetical API-rate cost | size=12`);
console.log(`--Today: ~${fmtUSD(todayCost)}`);
console.log(`--Last 7 days: ~${fmtUSD(weekCost)}`);
console.log(`--All-time: ~${fmtUSD(allCost)}`);
console.log(`--Not your real usage-credit spend — Pro/Max session usage under the plan limit costs $0. This is just token-count × public API list price, for scale only. | color=gray size=11`);
console.log('---');

if (byModelToday.size) {
  console.log('By model (today):');
  for (const [model, v] of [...byModelToday.entries()].sort((a, b) => b[1].tok - a[1].tok)) {
    console.log(`--${model}: ${fmtTok(v.tok)} tok (~${fmtUSD(v.cost)})`);
  }
  console.log('---');
}

if (byProjectToday.size) {
  console.log('By project (today):');
  for (const [proj, v] of [...byProjectToday.entries()].sort((a, b) => b[1].tok - a[1].tok)) {
    console.log(`--${proj}: ${fmtTok(v.tok)} tok (~${fmtUSD(v.cost)})`);
  }
  console.log('---');
}

console.log('Refresh | refresh=true');
console.log('Open logs folder | shell=open param1=' + ROOT + ' terminal=false');
