const AU_LOCALE = "en-AU";

function toValidDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDateAu(
  value: string | Date | null | undefined,
  options?: Intl.DateTimeFormatOptions,
  fallback = "-"
): string {
  const date = toValidDate(value);
  if (!date) return fallback;
  return date.toLocaleDateString(AU_LOCALE, options);
}

export function formatDateTimeAu(
  value: string | Date | null | undefined,
  options?: Intl.DateTimeFormatOptions,
  fallback = "-"
): string {
  const date = toValidDate(value);
  if (!date) return fallback;
  return date.toLocaleString(AU_LOCALE, options);
}
