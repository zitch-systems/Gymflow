# GymFlow — Gym Management Platform

Modern gym management for Nigerian fitness businesses. Built with Supabase + Cloudflare Pages + Paystack.

## 🚀 Quick Deploy

This repo is wired to **Cloudflare Pages** via GitHub. Every push to `main` auto-deploys.

**Live site:** https://gymflow-amt.pages.dev/

## ⚠️ Required Supabase Setup

Before signups work, you MUST enable signups in Supabase:

1. Go to **Supabase Dashboard → Authentication → Providers → Email**
2. Set:
   - ✅ "Enable Email provider" = ON
   - ✅ "Enable signups" = ON
   - ✅ "Confirm email" = OFF (for testing)
3. Click **Save**

Without this, all `auth.signUp()` calls return **401 Unauthorized**.

## 📋 Migrations

Run these in order in Supabase SQL editor:
1. `00_helpers.sql` through `05_test_accounts.sql` (initial setup)
2. `06_schema_fixes.sql` (column additions, pricing_plans view)
3. `08_rls_final_fix.sql` (RLS policies for profiles/gyms/business_hours)
4. `09_enable_signups.sql` (auto-create profile trigger)

## 🏗 Stack

- **Frontend:** HTML + vanilla JS + Tailwind CSS
- **Backend:** Supabase (PostgreSQL + Auth + RLS)
- **Payments:** Paystack
- **Hosting:** Cloudflare Pages (drag-and-drop or Git-connected)
- **Errors:** Built-in client_errors logging

## 🧪 Quality

- 2,000+ automated tests across 56 suites
- 83% pass rate on latest QA run
- Multi-gym data isolation verified
- 5 user roles (member/staff/owner/instructor/superadmin)

## 📞 Contact

41 Ogudu Road, Lagos | 08166938327 | hello@gymflow.ng
