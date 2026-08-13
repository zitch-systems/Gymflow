// Provision the WhatsApp channel on Meta's side.
//
// Everything here is idempotent and safe to re-run. It exists because the
// alternative — clicking through Meta's Business Manager — leaves no record of
// what was configured, and the Flow JSON and template variable order have to
// stay in lockstep with the code that uses them (lib/whatsapp/flow-json.ts and
// lib/whatsapp/templates.ts are the source of truth; this uploads them).
//
// Usage:
//   node scripts/whatsapp-setup.mjs keys            generate an RSA keypair
//   node scripts/whatsapp-setup.mjs upload-key      send the public key to Meta
//   node scripts/whatsapp-setup.mjs flow            create/update + publish the Flow
//   node scripts/whatsapp-setup.mjs templates       submit message templates
//   node scripts/whatsapp-setup.mjs status          show what is configured
//   node scripts/whatsapp-setup.mjs all             upload-key + flow + templates
//
// Environment:
//   META_ACCESS_TOKEN or WHATSAPP_ACCESS_TOKEN   system-user token
//   META_WABA_ID                                 WhatsApp Business Account id
//   META_PHONE_NUMBER_ID or WHATSAPP_PHONE_NUMBER_ID
//   WHATSAPP_FLOW_PRIVATE_KEY / _PASSPHRASE      for upload-key
//   WHATSAPP_FLOW_ENDPOINT_URI                   https://<host>/api/whatsapp/flow

import { generateKeyPairSync, createPublicKey } from 'node:crypto';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GRAPH = `https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION || 'v25.0'}`;

const TOKEN = process.env.META_ACCESS_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN;
const WABA_ID = process.env.META_WABA_ID;
const PHONE_ID = process.env.META_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_NUMBER_ID;

function need(value, name) {
  if (!value) {
    console.error(`Missing ${name}.`);
    process.exit(1);
  }
  return value;
}

async function graph(path, init = {}) {
  const res = await fetch(`${GRAPH}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) {
    const detail = json?.error?.error_user_msg || json?.error?.message || text.slice(0, 400);
    throw new Error(`${res.status} ${path}: ${detail}`);
  }
  return json;
}

// The Flow JSON lives in TypeScript so the screen names are shared with the
// endpoint. Rather than add a build step for one file, pull the object literal
// out and evaluate it — it is a pure literal by construction.
async function loadFlowJson() {
  const src = readFileSync(join(ROOT, 'lib', 'whatsapp', 'flow-json.ts'), 'utf8');
  const start = src.indexOf('export const flowJson = {');
  if (start === -1) throw new Error('Could not find flowJson in lib/whatsapp/flow-json.ts');
  const open = src.indexOf('{', start);
  let depth = 0, end = -1;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end === -1) throw new Error('Unbalanced braces in flowJson');
  const literal = src.slice(open, end);
  // Resolve the SCREEN.* constants the literal references.
  const screens = { signIn: 'SIGN_IN', signUp: 'SIGN_UP', verifyEmail: 'VERIFY_EMAIL', done: 'DONE' };
  return new Function('SCREEN', `return ${literal};`)(screens);
}

async function loadTemplates() {
  const src = readFileSync(join(ROOT, 'lib', 'whatsapp', 'templates.ts'), 'utf8');
  const start = src.indexOf('export const TEMPLATES = {');
  const open = src.indexOf('{', start);
  let depth = 0, end = -1;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  const obj = new Function(`return ${src.slice(open, end)};`)();
  return Object.values(obj);
}

// ── Commands ───────────────────────────────────────────────────────────────

function cmdKeys() {
  // 2048-bit RSA is what Meta's Flow encryption expects. The passphrase is
  // required by Meta — an unencrypted private key is rejected on upload.
  const passphrase = process.env.WHATSAPP_FLOW_PRIVATE_KEY_PASSPHRASE;
  if (!passphrase) {
    console.error('Set WHATSAPP_FLOW_PRIVATE_KEY_PASSPHRASE first — Meta requires an encrypted private key.');
    process.exit(1);
  }
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase },
  });
  const dir = mkdtempSync(join(tmpdir(), 'gymflow-flow-keys-'));
  writeFileSync(join(dir, 'private.pem'), privateKey, { mode: 0o600 });
  writeFileSync(join(dir, 'public.pem'), publicKey, { mode: 0o600 });

  console.log(`Keys written to ${dir}\n`);
  console.log('Set these environment variables (note the escaped newlines):\n');
  console.log(`WHATSAPP_FLOW_PRIVATE_KEY="${privateKey.trim().replace(/\n/g, '\\n')}"`);
  console.log(`WHATSAPP_FLOW_PRIVATE_KEY_PASSPHRASE="${passphrase}"`);
  console.log('\nThen run: node scripts/whatsapp-setup.mjs upload-key');
}

async function cmdUploadKey() {
  need(TOKEN, 'META_ACCESS_TOKEN'); need(PHONE_ID, 'META_PHONE_NUMBER_ID');
  const pem = need(process.env.WHATSAPP_FLOW_PRIVATE_KEY, 'WHATSAPP_FLOW_PRIVATE_KEY');
  const passphrase = process.env.WHATSAPP_FLOW_PRIVATE_KEY_PASSPHRASE;
  const normalized = pem.includes('\\n') ? pem.replace(/\\n/g, '\n') : pem;

  // Derive the public key locally so the two can never drift apart.
  const publicKey = createPublicKey(passphrase ? { key: normalized, passphrase } : { key: normalized })
    .export({ type: 'spki', format: 'pem' }).toString();

  const body = new URLSearchParams({ business_public_key: publicKey });
  await graph(`/${PHONE_ID}/whatsapp_business_encryption`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  console.log('Public key uploaded.');

  const check = await graph(`/${PHONE_ID}/whatsapp_business_encryption`);
  console.log('Signature status:', check?.data?.[0]?.business_public_key_signature_status ?? 'unknown');
}

async function cmdFlow() {
  need(TOKEN, 'META_ACCESS_TOKEN'); need(WABA_ID, 'META_WABA_ID');
  const endpointUri = need(process.env.WHATSAPP_FLOW_ENDPOINT_URI, 'WHATSAPP_FLOW_ENDPOINT_URI');
  const flowJson = await loadFlowJson();
  const NAME = 'GymFlow Member Access';

  const existing = await graph(`/${WABA_ID}/flows?limit=100`);
  let flow = (existing.data ?? []).find((f) => f.name === NAME);

  if (!flow) {
    // A published Flow cannot be renamed or re-categorised, so create it with
    // its final identity.
    const created = await graph(`/${WABA_ID}/flows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: NAME,
        categories: ['SIGN_UP', 'SIGN_IN'],
        endpoint_uri: endpointUri,
      }),
    });
    flow = { id: created.id, status: 'DRAFT' };
    console.log(`Created Flow ${flow.id}`);
  } else {
    console.log(`Found Flow ${flow.id} (${flow.status})`);
    await graph(`/${flow.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint_uri: endpointUri }),
    });
  }

  // The JSON is uploaded as a file part, not a JSON body.
  const form = new FormData();
  form.append('name', 'flow.json');
  form.append('asset_type', 'FLOW_JSON');
  form.append('file', new Blob([JSON.stringify(flowJson)], { type: 'application/json' }), 'flow.json');
  const upload = await graph(`/${flow.id}/assets`, { method: 'POST', body: form });

  const errors = upload?.validation_errors ?? [];
  if (errors.length) {
    console.error('Flow JSON validation errors:');
    for (const e of errors) console.error(` - [${e.error}] ${e.message} ${e.pointers ? JSON.stringify(e.pointers) : ''}`);
    process.exit(1);
  }
  console.log('Flow JSON uploaded and valid.');

  if (flow.status !== 'PUBLISHED') {
    // Publishing runs Meta's health check against the endpoint, so the app must
    // already be deployed with the private key installed.
    await graph(`/${flow.id}/publish`, { method: 'POST' });
    console.log('Flow published.');
  } else {
    console.log('Flow already published; JSON updated in place.');
  }
  console.log(`\nSet WHATSAPP_FLOW_ID=${flow.id}`);
}

async function cmdTemplates() {
  need(TOKEN, 'META_ACCESS_TOKEN'); need(WABA_ID, 'META_WABA_ID');
  const templates = await loadTemplates();
  const existing = await graph(`/${WABA_ID}/message_templates?limit=200`);
  const byName = new Map((existing.data ?? []).map((t) => [t.name, t]));

  for (const tpl of templates) {
    const current = byName.get(tpl.name);
    if (current) {
      console.log(`- ${tpl.name}: already exists (${current.status})`);
      continue;
    }
    try {
      const res = await graph(`/${WABA_ID}/message_templates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: tpl.name,
          language: tpl.language,
          category: tpl.category,
          components: tpl.components,
        }),
      });
      console.log(`- ${tpl.name}: submitted (${res.status ?? 'PENDING'})`);
    } catch (e) {
      console.error(`- ${tpl.name}: FAILED — ${e.message}`);
    }
  }
  console.log('\nTemplates are reviewed by Meta; sends using a template fail until it is APPROVED.');
}

async function cmdStatus() {
  need(TOKEN, 'META_ACCESS_TOKEN'); need(WABA_ID, 'META_WABA_ID');
  const [waba, numbers, flows, templates] = await Promise.all([
    graph(`/${WABA_ID}?fields=name,account_review_status`),
    graph(`/${WABA_ID}/phone_numbers?fields=display_phone_number,verified_name,quality_rating,code_verification_status`),
    graph(`/${WABA_ID}/flows?limit=50`),
    graph(`/${WABA_ID}/message_templates?limit=100&fields=name,status,category`),
  ]);

  console.log(`WABA: ${waba.name} (${waba.account_review_status ?? 'unknown'})`);
  for (const n of numbers.data ?? []) {
    console.log(`  number ${n.display_phone_number} — ${n.verified_name}, quality ${n.quality_rating}, ${n.code_verification_status}`);
  }
  console.log(`Flows (${(flows.data ?? []).length}):`);
  for (const f of flows.data ?? []) console.log(`  ${f.id} ${f.name} — ${f.status}`);
  console.log(`Templates (${(templates.data ?? []).length}):`);
  for (const t of templates.data ?? []) console.log(`  ${t.name} — ${t.status} (${t.category})`);

  if (PHONE_ID) {
    try {
      const enc = await graph(`/${PHONE_ID}/whatsapp_business_encryption`);
      console.log(`Flow public key: ${enc?.data?.[0]?.business_public_key_signature_status ?? 'not set'}`);
    } catch {
      console.log('Flow public key: not set');
    }
  }
}

const command = process.argv[2] ?? 'status';
const run = {
  keys: cmdKeys,
  'upload-key': cmdUploadKey,
  flow: cmdFlow,
  templates: cmdTemplates,
  status: cmdStatus,
  all: async () => { await cmdUploadKey(); await cmdFlow(); await cmdTemplates(); },
}[command];

if (!run) {
  console.error(`Unknown command "${command}". Try: keys | upload-key | flow | templates | status | all`);
  process.exit(1);
}

try {
  await run();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
