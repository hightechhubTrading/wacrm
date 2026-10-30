import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { routeMessages, type MessageRoute } from './message-scopes';

export async function RouteMessages({
  route,
  children,
}: {
  route: MessageRoute;
  children: ReactNode;
}) {
  return (
    <NextIntlClientProvider
      messages={routeMessages(await getMessages(), route)}
    >
      {children}
    </NextIntlClientProvider>
  );
}
