// The Flow JSON published to Meta.
//
// Kept in source (rather than pasted into Meta's builder) so it is reviewable,
// diffable, and deployable by script — scripts/whatsapp-flow.mjs uploads this
// exact object.
//
// SCOPE. This Flow does one thing: credentials. Sign in, sign up, and the
// one-time email verification that follows a sign-up. Everything else the
// channel offers — check-in, remaining days, packages, payment — is delivered
// as ordinary interactive messages, because a list of buttons in the thread is
// both simpler and more reliable than a form, and none of it needs a password
// field. A password does, which is precisely what a Flow is for: the input is
// masked, it never appears in the chat transcript, and it travels end-to-end
// encrypted to our endpoint instead of sitting in a message body forever.
//
// SCREENS
//   SIGN_IN       email + password
//   SIGN_UP       gym code + name + email + password + confirm password
//   VERIFY_EMAIL  the six-digit code emailed on sign-up
//   DONE          terminal
//
// Every screen carries an `error` string it renders when non-empty. Meta's
// inline `error_messages` mechanism only attaches to a named form field, and
// most of what can go wrong here is about the submission as a whole ("that gym
// code doesn't exist", "that email is already registered"), so a single visible
// line is both simpler and clearer.

export const FLOW_NAME = 'GymFlow Member Access';

export const FLOW_CATEGORIES = ['SIGN_UP', 'SIGN_IN'] as const;

export const SCREEN = {
  signIn: 'SIGN_IN',
  signUp: 'SIGN_UP',
  verifyEmail: 'VERIFY_EMAIL',
  done: 'DONE',
} as const;

export const flowJson = {
  version: '7.1',
  // Must match FLOW_DATA_API_VERSION in flow-crypto.ts — this is what makes the
  // Flow talk to our endpoint instead of running entirely on-device.
  data_api_version: '3.0',
  routing_model: {
    [SCREEN.signIn]: [SCREEN.signUp, SCREEN.verifyEmail, SCREEN.done],
    [SCREEN.signUp]: [SCREEN.signIn, SCREEN.verifyEmail],
    [SCREEN.verifyEmail]: [SCREEN.done],
    [SCREEN.done]: [],
  },
  screens: [
    {
      id: SCREEN.signIn,
      title: 'Sign in',
      data: {
        gym_name: { type: 'string', __example__: 'your gym' },
        error: { type: 'string', __example__: '' },
      },
      layout: {
        type: 'SingleColumnLayout',
        children: [
          {
            type: 'TextHeading',
            text: 'Sign in to ${data.gym_name}',
          },
          {
            type: 'TextBody',
            text: 'Use the same email and password you use in the GymFlow app.',
          },
          {
            type: 'TextBody',
            text: '${data.error}',
            visible: '${data.error != ""}',
          },
          {
            type: 'Form',
            name: 'signin_form',
            children: [
              {
                type: 'TextInput',
                name: 'email',
                label: 'Email address',
                'input-type': 'email',
                required: true,
              },
              {
                type: 'TextInput',
                name: 'password',
                label: 'Password',
                'input-type': 'password',
                required: true,
              },
              {
                type: 'EmbeddedLink',
                text: 'New here? Create an account',
                'on-click-action': {
                  name: 'navigate',
                  next: { type: 'screen', name: SCREEN.signUp },
                  payload: {},
                },
              },
              {
                type: 'Footer',
                label: 'Sign in',
                'on-click-action': {
                  name: 'data_exchange',
                  payload: {
                    intent: 'signin',
                    email: '${form.email}',
                    password: '${form.password}',
                  },
                },
              },
            ],
          },
        ],
      },
    },
    {
      id: SCREEN.signUp,
      title: 'Create account',
      data: {
        gym_code: { type: 'string', __example__: '' },
        error: { type: 'string', __example__: '' },
      },
      layout: {
        type: 'SingleColumnLayout',
        children: [
          {
            type: 'TextHeading',
            text: 'Create your GymFlow account',
          },
          {
            type: 'TextBody',
            text: 'One account works here, in the GymFlow app, and on the web.',
          },
          {
            type: 'TextBody',
            text: '${data.error}',
            visible: '${data.error != ""}',
          },
          {
            type: 'Form',
            name: 'signup_form',
            children: [
              {
                type: 'TextInput',
                name: 'gym_code',
                label: 'Gym code',
                'helper-text': 'Ask your gym, or check your invite',
                'input-type': 'text',
                required: true,
                'init-value': '${data.gym_code}',
              },
              {
                type: 'TextInput',
                name: 'full_name',
                label: 'Full name',
                'input-type': 'text',
                required: true,
              },
              {
                type: 'TextInput',
                name: 'email',
                label: 'Email address',
                'helper-text': 'We send a 6-digit code here to confirm it',
                'input-type': 'email',
                required: true,
              },
              {
                type: 'TextInput',
                name: 'password',
                label: 'Password',
                'helper-text': 'At least 8 characters',
                'input-type': 'password',
                required: true,
              },
              {
                type: 'TextInput',
                name: 'confirm_password',
                label: 'Confirm password',
                'input-type': 'password',
                required: true,
              },
              {
                type: 'EmbeddedLink',
                text: 'Already have an account? Sign in',
                'on-click-action': {
                  name: 'navigate',
                  next: { type: 'screen', name: SCREEN.signIn },
                  payload: {},
                },
              },
              {
                type: 'Footer',
                label: 'Create account',
                'on-click-action': {
                  name: 'data_exchange',
                  payload: {
                    intent: 'signup',
                    gym_code: '${form.gym_code}',
                    full_name: '${form.full_name}',
                    email: '${form.email}',
                    password: '${form.password}',
                    confirm_password: '${form.confirm_password}',
                  },
                },
              },
            ],
          },
        ],
      },
    },
    {
      id: SCREEN.verifyEmail,
      title: 'Confirm your email',
      data: {
        email: { type: 'string', __example__: 'you@example.com' },
        error: { type: 'string', __example__: '' },
        notice: { type: 'string', __example__: '' },
      },
      layout: {
        type: 'SingleColumnLayout',
        children: [
          {
            type: 'TextHeading',
            text: 'Check your email',
          },
          {
            type: 'TextBody',
            text: 'We sent a 6-digit code to ${data.email}. It expires in 15 minutes.',
          },
          {
            type: 'TextBody',
            text: '${data.notice}',
            visible: '${data.notice != ""}',
          },
          {
            type: 'TextBody',
            text: '${data.error}',
            visible: '${data.error != ""}',
          },
          {
            type: 'Form',
            name: 'verify_form',
            children: [
              {
                type: 'TextInput',
                name: 'code',
                label: '6-digit code',
                'input-type': 'passcode',
                required: true,
              },
              {
                type: 'EmbeddedLink',
                text: 'Send a new code',
                'on-click-action': {
                  name: 'data_exchange',
                  payload: { intent: 'resend_code' },
                },
              },
              {
                type: 'Footer',
                label: 'Confirm email',
                'on-click-action': {
                  name: 'data_exchange',
                  payload: { intent: 'verify_email', code: '${form.code}' },
                },
              },
            ],
          },
        ],
      },
    },
    {
      id: SCREEN.done,
      title: 'All set',
      terminal: true,
      success: true,
      data: {
        headline: { type: 'string', __example__: "You're in" },
        detail: { type: 'string', __example__: 'Your membership is active.' },
      },
      layout: {
        type: 'SingleColumnLayout',
        children: [
          { type: 'TextHeading', text: '${data.headline}' },
          { type: 'TextBody', text: '${data.detail}' },
          {
            type: 'Form',
            name: 'done_form',
            children: [
              {
                type: 'Footer',
                label: 'Back to chat',
                'on-click-action': {
                  name: 'complete',
                  payload: {},
                },
              },
            ],
          },
        ],
      },
    },
  ],
} as const;

export type FlowIntent = 'signin' | 'signup' | 'verify_email' | 'resend_code';
