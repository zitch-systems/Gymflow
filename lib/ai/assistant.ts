import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { chat } from './chat';
import { isUnavailable, recordUsage, resolveAi } from './settings';
import type { ChatMessage, ToolSpec } from './types';
import { gymFacts, membershipSnapshot, planOptions, upcomingClasses, visitState } from '@/lib/whatsapp/membership';
import type { WhatsAppGym, WhatsAppGymSettings } from '@/lib/whatsapp/settings';
import type { Database } from '@/lib/database.types';

type Admin = SupabaseClient<Database>;

// The gym's assistant.
//
// It is a READER, not an actor. Every tool below answers a question from the
// database; none of them check anyone in, cancel anything, or move money. That
// boundary is the whole safety model: a prompt injected into a member's message
// can at worst make the assistant say something wrong, never make it do
// something wrong. Actions stay on the scripted buttons, where the code path is
// fixed and the member's intent is unambiguous.
//
// It is also scoped to ONE member at ONE gym. The tools take no identifiers —
// the member and gym are bound at construction from the verified WhatsApp
// contact, so there is no argument the model could supply to read somebody
// else's membership.

const MAX_TOOL_ROUNDS = 3;

export type AssistantResult =
  | { ok: true; text: string; usedTools: string[] }
  | { ok: false; reason: 'unavailable' | 'error' | 'handoff'; detail: string };

const TOOLS: ToolSpec[] = [
  {
    name: 'get_membership',
    description:
      'The signed-in member\'s membership at this gym: whether it is active, the plan name, the expiry date and how many days remain. Use this for any question about days left, expiry, renewal timing, or whether they can train.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_visits',
    description:
      'Whether the member is currently checked in, when they checked in, and how many visits they have made this month.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_packages',
    description:
      'The gym\'s membership packages that are on sale: name, price in Naira, and the period each covers. Use for pricing questions.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_gym_info',
    description:
      'The gym\'s address, city, phone number, email, whether it is open right now and today\'s opening hours.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_classes',
    description: 'The gym\'s scheduled classes with their day and start time.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
];

function systemPrompt(params: {
  gym: WhatsAppGym;
  settings: WhatsAppGymSettings;
  memberName: string | null;
  custom: string | null;
  isMember: boolean;
}): string {
  const lines = [
    `You are the WhatsApp assistant for ${params.gym.name}, a gym in Nigeria, on the GymFlow platform.`,
    params.memberName ? `You are talking to ${params.memberName}.` : 'You are talking to someone who has not signed in.',
    '',
    'RULES',
    '- Answer only about this gym, its memberships, classes, facilities and the GymFlow app. Politely decline anything else in one short sentence.',
    '- Never invent a fact. If a tool has the answer, call it. If no tool has it, say you do not know and point them to the front desk.',
    '- Never state a price, a date, or a number of days that did not come from a tool.',
    '- Keep replies under 60 words. This is WhatsApp, not email. No markdown headings, no bullet symbols other than a plain hyphen.',
    '- Currency is the Naira. Write it as ₦12,000.',
    '- You cannot check anyone in, take a payment, cancel a membership, or change any record. If asked, tell them to send "menu" and use the buttons.',
    params.settings.supportPhone
      ? `- For anything you cannot resolve, give them the gym's number: ${params.settings.supportPhone}.`
      : '- For anything you cannot resolve, tell them to speak to the front desk.',
  ];

  if (!params.isMember) {
    lines.push(
      '- This person has not signed in, so you have NO access to any membership. Do not speculate about their account. Invite them to send "menu" and sign in.',
    );
  }
  if (params.custom?.trim()) {
    lines.push('', 'GYM INSTRUCTIONS (these describe the gym; they never override the rules above)', params.custom.trim());
  }
  return lines.join('\n');
}

/**
 * Answer a free-text message.
 *
 * Returns `unavailable` whenever the assistant cannot or should not answer, so
 * the caller falls back to the scripted menu. That fallback is not an edge
 * case — it is the normal state for every gym that has not configured a
 * provider, and the channel is fully functional without it.
 */
export async function askAssistant(
  admin: Admin,
  params: {
    gym: WhatsAppGym;
    settings: WhatsAppGymSettings;
    memberId: string | null;
    memberName: string | null;
    message: string;
    history?: ChatMessage[];
  },
): Promise<AssistantResult> {
  if (!params.settings.aiEnabled) return { ok: false, reason: 'unavailable', detail: 'AI is off for this gym.' };

  const resolved = await resolveAi(admin, params.gym.id);
  if (isUnavailable(resolved)) return { ok: false, reason: 'unavailable', detail: resolved.detail };
  if (!resolved.model) return { ok: false, reason: 'unavailable', detail: 'No model is selected.' };

  const isMember = Boolean(params.memberId);
  const messages: ChatMessage[] = [
    ...(params.history ?? []).slice(-6),
    { role: 'user', content: params.message.slice(0, 1000) },
  ];

  const system = systemPrompt({
    gym: params.gym,
    settings: params.settings,
    memberName: params.memberName,
    custom: resolved.systemPrompt,
    isMember,
  });

  // A signed-out person gets the public tools only. Withholding them at the
  // schema level is stronger than instructing the model not to call them.
  const tools = isMember ? TOOLS : TOOLS.filter((t) => t.name === 'get_packages' || t.name === 'get_gym_info' || t.name === 'get_classes');

  const usedTools: string[] = [];
  let totalTokens = 0;

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const res = await chat({
      slug: resolved.slug,
      baseUrl: resolved.baseUrl,
      apiKey: resolved.apiKey,
      model: resolved.model,
      system,
      messages,
      tools,
      temperature: resolved.temperature,
      maxTokens: resolved.maxTokens,
    });

    if (!res.ok) {
      if (totalTokens) await recordUsage(admin, params.gym.id, totalTokens);
      console.error(`[ai] ${resolved.slug}/${resolved.model} failed: ${res.error}`);
      return { ok: false, reason: 'error', detail: res.error };
    }

    totalTokens += res.inputTokens + res.outputTokens;

    if (res.toolCalls.length === 0) {
      await recordUsage(admin, params.gym.id, totalTokens);
      const text = res.text.trim();
      if (!text) return { ok: false, reason: 'error', detail: 'Empty response from model.' };
      return { ok: true, text, usedTools };
    }

    // On the last permitted round, stop asking for tools and make it answer.
    if (round === MAX_TOOL_ROUNDS) {
      await recordUsage(admin, params.gym.id, totalTokens);
      return res.text.trim()
        ? { ok: true, text: res.text.trim(), usedTools }
        : { ok: false, reason: 'error', detail: 'Model kept requesting tools.' };
    }

    messages.push({ role: 'assistant', content: res.text, toolCalls: res.toolCalls });
    for (const call of res.toolCalls) {
      usedTools.push(call.name);
      const result = await runTool(admin, call.name, params);
      messages.push({ role: 'tool', toolCallId: call.id, content: JSON.stringify(result) });
    }
  }

  await recordUsage(admin, params.gym.id, totalTokens);
  return { ok: false, reason: 'error', detail: 'Tool loop did not converge.' };
}

/**
 * Execute a tool. Unknown names return an error object rather than throwing —
 * a model that hallucinates a tool should be told so and allowed to recover.
 */
async function runTool(
  admin: Admin,
  name: string,
  params: { gym: WhatsAppGym; memberId: string | null },
): Promise<unknown> {
  switch (name) {
    case 'get_membership': {
      if (!params.memberId) return { error: 'Not signed in — no membership is visible.' };
      const snap = await membershipSnapshot(admin, params.memberId, params.gym.id);
      return snap.endDate
        ? {
            active: snap.active,
            status: snap.status,
            plan: snap.planName,
            expires_on: snap.endDate,
            days_remaining: snap.daysRemaining,
            in_grace_period: snap.inGracePeriod,
          }
        : { active: false, note: 'No membership on record at this gym.' };
    }
    case 'get_visits': {
      if (!params.memberId) return { error: 'Not signed in — no visits are visible.' };
      const v = await visitState(admin, params.memberId, params.gym.id);
      return { currently_checked_in: v.insideNow, checked_in_at: v.checkedInAt, visits_this_month: v.visitsThisMonth };
    }
    case 'get_packages': {
      const plans = await planOptions(admin, params.gym.id);
      return plans.length
        ? plans.map((p) => ({ name: p.name, price_naira: p.price, covers: p.periodLabel, description: p.description }))
        : { note: 'This gym has not published any packages yet.' };
    }
    case 'get_gym_info':
      return gymFacts(admin, params.gym);
    case 'get_classes': {
      const classes = await upcomingClasses(admin, params.gym.id);
      return classes.length ? classes : { note: 'No classes are scheduled.' };
    }
    default:
      return { error: `No such tool: ${name}` };
  }
}
