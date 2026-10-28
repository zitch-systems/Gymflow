import assert from 'node:assert/strict';
import fs from 'node:fs';
import { harness, ApiError } from './screen-harness.mjs';
const gym = { id: 'gym', name: 'Test Gym', slug: 'test', member_code: 'TEST01' };
const sub = { id: 'sub', status: 'active', display_state: 'active', plan_name: 'Monthly', start_date: '2026-10-01', end_date: '2026-11-30', days_left: 33, progress_pct: 50, auto_renew: true };
const receipt = { id: 'receipt', amount: 10000, gross_amount: 10000, refunded_amount: 0, refund_state: 'none', status: 'successful', status_label: 'Successful', date: '2026-10-01', method: 'Card', reference: 'test-reference', plan: 'Monthly', gym: 'Test Gym' };
const profile = { gym, profile: { id: 'member', full_name: 'Test Member', email: 'test@example.invalid', joined_at: '2026-10-01', phone: null }, stats: { visits: 2, classes_attended: 1 }, membership: sub, freeze_enabled: true, whatsapp_url: 'https://wa.me/2349169582776?text=TEST01' };
const member = { gym, today: '2026-10-28', subscription: sub, freeze: { enabled: true, can_request: true, unavailable_reason: null } };
const fixtures = {
  '(tabs)/index.tsx': { gym, member: profile.profile, subscription: sub, stats: { streak: 1, best_streak: 2, visits_this_week: 2, visits_this_month: 2, classes_attended: 1, avg_session_minutes: 45, weekly_goal: 3 }, week: [], next_class: null, recent_checkins: [], unread_notifications: 1 },
  '(tabs)/classes.tsx': { today: '2026-10-28', schedule: [{ id: 'slot', day_of_week: 3, start_time: '18:00', name: 'Yoga', next_date: '2026-10-28', instructor: 'Coach' }], bookings: [] },
  '(tabs)/checkin.tsx': { checked_in: false, checked_in_at: null, history: [] },
  '(tabs)/wallet.tsx': { subscription: sub, total_spent: 10000, this_month: 10000, months: [{ label: 'Oct', amount: 10000 }], cards: [], transactions: [receipt] },
  '(tabs)/profile.tsx': profile, 'edit-profile.tsx': profile,
  'notifications.tsx': { unread: 1, notifications: [{ id: 'notification', title: 'Receipt ready', body: 'Full notification body', type: 'receipt', is_read: false, sent_at: '2026-10-28', payment_id: 'receipt' }] },
  'receipt/[id].tsx': { receipt },
  'renew.tsx': { current: sub, plans: [{ id: 'plan', name: 'Monthly', price: 10000, duration_months: 1, trainer_addon: { available: true, price: 5000, total_with_trainer: 15000 } }] },
  'waiver.tsx': { gym, document: { id: 'waiver', title: 'Gym waiver', content: 'Exact gym terms', revision: 'revision', version: '1' }, accepted: false, signedAt: null },
  'membership.tsx': member,
  'account-deletion.tsx': { request: null, processing_days: 30, message: 'Review before proceeding.' },
};
const routes = fs.readdirSync(new URL('../src/app/', import.meta.url), { recursive: true }).filter(f => f.endsWith('.tsx')).sort();
let checks = 0;
for (const route of routes) {
  const h = harness(route, fixtures[route] ?? null); assert.ok(h.render(), `${route} renders`); checks++; h.dispose();
  if (!fixtures[route]) continue;
  for (const mode of ['loading', 'error', 'stale']) {
    const resource = mode === 'loading' ? { data: null, loading: true } : mode === 'error' ? { data: null, error: 'Network unavailable' } : { stale: true, offline: true };
    const t = harness(route, fixtures[route], { resource }); t.render();
    const expected = { loading: 'Loading', error: 'ErrorState', stale: 'StaleDataNotice' }[mode];
    assert.ok(t.nodes(n => n.type === expected).length, `${route}: ${mode}`);
    if (mode === 'error') { t.nodes(n => n.type === expected)[0].props.onRetry(); assert.equal(t.refreshes, 1); }
    checks++; t.dispose();
  }
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
let h = harness('(auth)/gym.tsx', null); h.render(); await h.button('Continue').props.onPress(); h.render(); assert.ok(h.nodes(n => n.type === 'Notice').length); h.field('Gym code').props.onChangeText('test01'); h.render(); await h.button('Continue').props.onPress(); assert.equal(h.navigation[0][1].params.code, 'TEST01'); checks++;
let signed = 0;
h = harness('(auth)/sign-in.tsx', null, { auth: { signIn: async () => { signed++; } } }); h.render(); h.field('Email').props.onChangeText('member@example.invalid'); h.field('Password').props.onChangeText('test-only'); h.render(); await h.button('Sign in').props.onPress(); assert.equal(signed, 1); checks++;
h = harness('(auth)/sign-up.tsx', null, { auth: { signUp: async () => 'confirmation-required' } }); h.render(); for (const [label,value] of [['Full name','Test Member'],['Email','member@example.invalid'],['Password','test-only']]) h.field(label).props.onChangeText(value); h.render(); await h.button('Create account').props.onPress(); h.render(); assert.ok(h.button('Back to sign in')); checks++;
h = harness('(tabs)/classes.tsx', fixtures['(tabs)/classes.tsx'], { api: async () => { throw new ApiError('Read the waiver', 403, 'waiver_required'); } }); h.render(); h.button('Book').props.onPress(); await flush(); h.render(); assert.ok(h.button('Review gym waiver')); checks++;
h = harness('(tabs)/checkin.tsx', fixtures['(tabs)/checkin.tsx'], { api: async () => ({ ok: true, checked_in: true }) }); h.render(); await h.button('Scan to check in').props.onPress(); assert.equal(h.alerts[0][0], 'Camera access is off'); h.button('Or tap to self check-in').props.onPress(); await flush(); assert.equal(h.state.data.checked_in, true); checks++;
h = harness('(tabs)/profile.tsx', profile); h.render(); h.row('Manage membership').props.onPress(); h.row('Waiver & documents').props.onPress(); assert.deepEqual(h.navigation.map(n => n[1]), ['/membership','/waiver']); checks++;
let complete;
h = harness('edit-profile.tsx', profile, { api: () => new Promise(resolve => { complete = resolve; }) }); h.render(); const save = h.button('Save changes').props.onPress; const saving = save(); await save(); assert.equal(h.calls.length, 1); complete({ ok: true }); await saving; assert.deepEqual(h.navigation, [['back']]); checks++;
h = harness('notifications.tsx', fixtures['notifications.tsx']); h.render(); h.row('Receipt ready').props.onPress(); await flush(); assert.equal(h.alerts[0][1], 'Full notification body'); assert.equal(h.state.data.unread, 0); checks++;
h = harness('receipt/[id].tsx', { receipt }); h.render(); await h.button('Share receipt').props.onPress(); assert.equal(h.calls[0].method, 'share'); assert.match(h.calls[0].body.message, /test-reference/); checks++;
h = harness('renew.tsx', fixtures['renew.tsx'], { api: async () => ({ ok: true, authorization_url: 'https://checkout.paystack.com/test', reference: 'ref' }) }); h.render(); h.nodes(n => n.props?.accessibilityRole === 'radio')[0].props.onPress(); h.render(); await h.button('Pay ₦10,000').props.onPress(); h.render(); assert.match(h.nodes(n => n.type === 'Notice')[0].props.message, /Checkout closed/); checks++;
h = harness('renew.tsx', fixtures['renew.tsx'], { resource: { stale: true } }); h.render(); h.nodes(n => n.props?.accessibilityRole === 'radio')[0].props.onPress(); h.render(); await h.button('Pay ₦10,000').props.onPress(); assert.equal(h.calls.length, 0); checks++;
const recurringPlans = structuredClone(fixtures['renew.tsx']); recurringPlans.current.auto_renew = false; recurringPlans.plans[0].auto_renew_available = true;
h = harness('renew.tsx', recurringPlans, { api: async () => ({ ok: true, authorization_url: 'https://checkout.paystack.com/test', reference: 'ref' }) }); h.render(); h.nodes(n => n.props?.accessibilityRole === 'radio')[0].props.onPress(); h.render(); const optIn = h.nodes(n => n.props?.accessibilityLabel === 'Agree to automatic renewal')[0]; assert.equal(optIn.props.value, false); optIn.props.onValueChange(true); h.render(); await h.button('Start auto-renew · ₦10,000').props.onPress(); assert.equal(h.calls[0].body.auto_renew_confirmed, true); checks++;
h = harness('renew.tsx', recurringPlans); h.render(); h.nodes(n => n.props?.accessibilityRole === 'radio')[0].props.onPress(); h.render(); h.nodes(n => n.props?.accessibilityLabel === 'Agree to automatic renewal')[0].props.onValueChange(true); h.render(); h.nodes(n => n.props?.accessibilityLabel === 'Add a private trainer')[0].props.onValueChange(true); h.render(); assert.equal(h.nodes(n => n.props?.accessibilityLabel === 'Agree to automatic renewal')[0].props.value, false); checks++;
h = harness('pay/callback.tsx', null, { params: { status: 'success' } }); h.render(); assert.ok(h.button('View membership plans')); assert.equal(h.calls.length, 0); checks++;
h = harness('membership.tsx', member); h.render(); h.button('Turn off auto-renew').props.onPress(); assert.equal(h.calls.length, 0); h.alerts[0][2][1].onPress(); await flush(); assert.equal(h.calls[0].body.confirmed, true); assert.equal(h.state.data.subscription.auto_renew, false); checks++;
h = harness('membership.tsx', member, { api: () => new Promise(resolve => { complete = resolve; }) }); h.render(); h.field('Resume on').props.onChangeText('2026-11-05'); h.render(); const freeze = h.button('Request freeze').props.onPress; const pending = freeze(); await freeze(); assert.equal(h.calls.length, 1); complete({ ok: true, message: 'Freeze requested' }); await pending; h.render(); assert.equal(h.button('Request freeze'), undefined); checks++;
h = harness('membership.tsx', member, { resource: { stale: true } }); h.render(); h.button('Turn off auto-renew').props.onPress(); assert.equal(h.alerts.length, 0); checks++;
h = harness('account-deletion.tsx', fixtures['account-deletion.tsx']); h.render(); h.button('Request account deletion').props.onPress(); assert.equal(h.calls.length, 0); assert.equal(h.alerts.length, 0); h.field('Type DELETE to confirm').props.onChangeText('DELETE'); h.render(); h.button('Request account deletion').props.onPress(); assert.equal(h.calls.length, 0); assert.equal(h.alerts[0][0], 'Submit account deletion request?'); checks++;
console.log(`${checks} native component checks passed across all ${routes.length} route/layout files. Native APIs and backend calls are mocked; device visuals and provider delivery are separate acceptance checks.`);
