import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocaleId } from '@/lib/locales';

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value;

  const locale = isLocaleId(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;

  let messages;
  try {
    messages = (await import(`../../messages/${locale}.json`)).default;
  } catch {
    // Fallback to the default language if the dictionary for the requested locale doesn't exist yet
    messages = (await import(`../../messages/${DEFAULT_LOCALE}.json`)).default;
  }

  return {
    locale,
    messages,
  };
});
