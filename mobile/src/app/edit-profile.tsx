import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen } from '@/components/screen';
import { Body, Button, ErrorState, Field, Loading, Notice } from '@/components/ui';
import { useResource } from '@/hooks/use-resource';
import { api } from '@/api/client';
import { space } from '@/theme';
import type { ProfilePayload } from '@/api/types';

type Form = {
  full_name: string; phone: string; date_of_birth: string; gender: string;
  address: string; emergency_contact_name: string; emergency_contact_phone: string;
};

// Editing the details the gym holds. Validation is the server's (PATCH
// /api/app/profile), which is also what the web edit form posts against — the
// app shows whatever sentence comes back rather than keeping its own copy of
// the rules.
export default function EditProfileScreen() {
  const { data, error, loading } = useResource<ProfilePayload>('/api/app/profile');

  if (loading && !data) return <Screen><Loading /></Screen>;
  if (error && !data) return <Screen><ErrorState message={error} /></Screen>;
  if (!data) return <Screen><ErrorState message="Could not load your details." /></Screen>;

  // The form is a separate component seeded from props, so its state is
  // initialised once, on mount, from data that already exists. Filling it from
  // an effect instead would overwrite whatever the member is halfway through
  // typing every time the screen refetched.
  return <ProfileForm initial={toForm(data)} />;
}

function toForm(data: ProfilePayload): Form {
  const p = data.profile;
  return {
    full_name: p.full_name ?? '',
    phone: p.phone ?? '',
    date_of_birth: p.date_of_birth ?? '',
    gender: p.gender ?? '',
    address: p.address ?? '',
    emergency_contact_name: p.emergency_contact_name ?? '',
    emergency_contact_phone: p.emergency_contact_phone ?? '',
  };
}

function ProfileForm({ initial }: { initial: Form }) {
  const router = useRouter();
  const [form, setForm] = useState<Form>(initial);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const field = (key: keyof Form) => ({
    value: form[key],
    onChangeText: (t: string) => setForm((f) => ({ ...f, [key]: t })),
    editable: !busy,
  });

  const save = async () => {
    setBusy(true);
    setErrorMessage(null);
    try {
      await api.patch('/api/app/profile', form);
      // Back to the profile, which refetches on focus and shows the new details.
      router.back();
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : 'Could not save your details.');
      setBusy(false);
    }
  };

  return (
    <Screen>
      {errorMessage ? <Notice message={errorMessage} /> : null}

      <Field label="Full name" placeholder="Ada Obi" autoCapitalize="words" {...field('full_name')} />
      <Field label="Phone" placeholder="0803 123 4567" keyboardType="phone-pad" {...field('phone')} />
      <Field label="Date of birth" placeholder="YYYY-MM-DD" autoCapitalize="none" {...field('date_of_birth')} />
      <Field label="Gender" placeholder="Optional" autoCapitalize="words" {...field('gender')} />
      <Field label="Address" placeholder="Optional" multiline {...field('address')} />

      <View style={{ marginTop: space.sm }}>
        <Body tone="secondary" size={13} weight="700" style={{ marginBottom: space.md }}>Emergency contact</Body>
        <Field label="Name" placeholder="Who should we call?" autoCapitalize="words" {...field('emergency_contact_name')} />
        <Field label="Phone" placeholder="0803 123 4567" keyboardType="phone-pad" {...field('emergency_contact_phone')} />
      </View>

      <Button label="Save changes" onPress={save} loading={busy} />
      <Button label="Cancel" variant="ghost" onPress={() => router.back()} style={{ marginTop: space.sm }} />

      <Body tone="muted" size={11.5} style={{ marginTop: space.xl, textAlign: 'center', lineHeight: 17 }}>
        Your email address is your sign-in — to change it, contact your gym.
      </Body>
    </Screen>
  );
}
