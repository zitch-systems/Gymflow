// Wire types for /api/app/*. These mirror what the route handlers in
// app/api/app/ return; keep them in step with those files.

export type Gym = {
  id: string;
  name: string;
  slug: string;
  brand_color: string | null;
  logo_url: string | null;
  member_code: string | null;
};

export type Session = {
  access_token: string;
  refresh_token: string;
  expires_at: number | null;
  expires_in: number | null;
  token_type: string;
};

export type AuthResponse = {
  gym: Gym;
  user: { id: string; email: string; full_name?: string };
  session: Session | null;
  needs_email_confirmation?: boolean;
};

export type Subscription = {
  status: string | null;
  plan_name: string;
  start_date: string | null;
  end_date: string | null;
  days_left: number;
  progress_pct: number;
  pause_start: string | null;
  pause_end: string | null;
};

export type Home = {
  gym: Gym;
  member: { id: string; email: string | null; full_name: string | null; phone: string | null; joined_at: string | null };
  subscription: Subscription | null;
  stats: {
    streak: number;
    best_streak: number;
    visits_this_week: number;
    visits_this_month: number;
    classes_attended: number;
    avg_session_minutes: number;
    weekly_goal: number;
  };
  week: { date: string; done: boolean; today: boolean; future: boolean }[];
  next_class: { name: string; date: string | null; start_time: string | null; status: string | null } | null;
  recent_checkins: { checked_in_at: string | null; checked_out_at: string | null; method: string | null }[];
  unread_notifications: number;
};

export type Visit = {
  id: string;
  checked_in_at: string | null;
  checked_out_at: string | null;
  status: string | null;
  method: string | null;
};

export type CheckinState = { checked_in: boolean; checked_in_at: string | null; history: Visit[] };

export type Slot = {
  id: string;
  class_id: string | null;
  day_of_week: number;
  start_time: string;
  room: string | null;
  name: string;
  instructor: string | null;
  duration_minutes: number | null;
  capacity: number | null;
  next_date: string;
};

export type Booking = {
  id: string;
  class_schedule_id: string | null;
  booking_date: string | null;
  status: string | null;
  name: string;
  instructor: string | null;
  room: string | null;
  start_time: string | null;
  duration_minutes: number | null;
};

export type Classes = { today: string; schedule: Slot[]; bookings: Booking[] };

export type Wallet = {
  total_spent: number;
  this_month: number;
  months: { label: string; amount: number }[];
  subscription: { plan_name: string | null; end_date: string | null; days_left: number; status: string | null } | null;
  cards: {
    id: string; brand: string | null; last4: string | null;
    exp_month: string | number | null; exp_year: string | number | null;
    bank: string | null; is_default: boolean | null;
  }[];
  transactions: { id: string; amount: number; status: string | null; date: string | null; method: string }[];
};

export type Receipt = {
  id: string; amount: number; status: string | null; date: string | null;
  method: string; reference: string; plan: string; gym: string;
};

export type AppNotification = {
  id: string;
  title: string | null;
  body: string | null;
  type: string | null;
  sent_at: string | null;
  is_read: boolean | null;
  payment_id: string | null;
};

export type Inbox = { unread: number; notifications: AppNotification[] };

export type Plan = {
  id: string;
  name: string;
  price: number;
  description: string | null;
  duration_days: number | null;
  duration_months: number | null;
  trainer_addon: { available: boolean; price: number; total_with_trainer: number };
  is_current: boolean;
};

export type Plans = {
  plans: Plan[];
  current: { plan_name: string | null; end_date: string | null; days_left: number } | null;
};

export type ProfilePayload = {
  gym: Gym;
  profile: {
    id: string;
    email: string | null;
    full_name: string | null;
    phone: string | null;
    date_of_birth: string | null;
    gender: string | null;
    address: string | null;
    emergency_contact_name: string | null;
    emergency_contact_phone: string | null;
    notification_email: boolean;
    joined_at: string | null;
  };
  stats: { visits: number; classes_attended: number };
  membership: { status: string | null; end_date: string | null; auto_renew: boolean } | null;
  freeze_enabled: boolean;
};
