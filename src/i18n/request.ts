import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocaleId } from '@/lib/locales';

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value;
  const envLocale = process.env.NEXT_PUBLIC_APP_LOCALE;

  const locale = isLocaleId(cookieLocale)
    ? cookieLocale
    : isLocaleId(envLocale)
      ? envLocale
      : DEFAULT_LOCALE;

  let messages;
  try {
    messages = (await import(`../../messages/${locale}.json`)).default;
  } catch (error) {
    // Fallback to English if the dictionary for the requested locale doesn't exist yet
    messages = (await import(`../../messages/${DEFAULT_LOCALE}.json`)).default;
  }

  return {
    locale,
    messages
  };
});
