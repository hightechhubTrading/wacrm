import type { AbstractIntlMessages } from 'next-intl';

// Layouts persist across client navigation. Each route has its own provider,
// so navigating from a small route never leaves the next one without messages.
export const routeMessageScopes = {
  'ad-conversions': ['AdConversions'],
  agents: ['SalesAssistance', 'Settings', 'Workspace'],
  automations: ['Automations', 'CustomFieldGroups'],
  broadcasts: ['Broadcasts', 'Contacts'],
  contacts: ['Contacts', 'CustomFieldGroups', 'Inbox'],
  dashboard: ['Dashboard', 'Inbox', 'Jobs'],
  flows: ['Flows'],
  inbox: [
    'Calling',
    'CustomFieldGroups',
    'Dashboard',
    'Inbox',
    'Jobs',
    'Pipelines',
    'QuotationWorkspace',
    'SalesAssistance',
    'Workspace',
  ],
  notifications: ['Workspace'],
  pipelines: [
    'CustomFieldGroups',
    'Jobs',
    'Pipelines',
    'QuotationWorkspace',
    'Workspace',
  ],
  quotations: ['Workspace', 'QuotationWorkspace'],
  settings: ['Calling', 'CustomFieldGroups', 'Settings'],
} as const;
export type MessageRoute = keyof typeof routeMessageScopes;

export function sharedMessages(
  messages: AbstractIntlMessages
): AbstractIntlMessages {
  return {
    Recovery: messages.Recovery,
    LoginPage: messages.LoginPage,
    Sidebar: messages.Sidebar,
    Header: messages.Header,
    ModeToggle: messages.ModeToggle,
    Calling: messages.Calling,
    Settings: {
      appearance: (messages.Settings as AbstractIntlMessages).appearance,
    },
  };
}

export function routeMessages(
  messages: AbstractIntlMessages,
  route: MessageRoute
): AbstractIntlMessages {
  return {
    ...sharedMessages(messages),
    ...Object.fromEntries(
      routeMessageScopes[route].map((key) => [key, messages[key]])
    ),
  };
}
