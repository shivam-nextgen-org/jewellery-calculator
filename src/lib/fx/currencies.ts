/** Supported display currencies (extend here only). */
export const SUPPORTED_CURRENCIES = [
  "INR",
  "USD",
  "EUR",
  "GBP",
  "AED",
  "CAD",
  "AUD",
  "CHF",
  "JPY",
  "SGD",
  "NZD",
  "HKD",
  "SAR",
  "QAR",
  "KWD",
] as const;

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export type CurrencyMeta = {
  code: SupportedCurrency;
  symbol: string;
  /** Fraction digits for display (JPY typically 0). */
  fractionDigits: number;
};

export const CURRENCY_META: Record<SupportedCurrency, CurrencyMeta> = {
  INR: { code: "INR", symbol: "₹", fractionDigits: 2 },
  USD: { code: "USD", symbol: "$", fractionDigits: 2 },
  EUR: { code: "EUR", symbol: "€", fractionDigits: 2 },
  GBP: { code: "GBP", symbol: "£", fractionDigits: 2 },
  AED: { code: "AED", symbol: "د.إ", fractionDigits: 2 },
  CAD: { code: "CAD", symbol: "C$", fractionDigits: 2 },
  AUD: { code: "AUD", symbol: "A$", fractionDigits: 2 },
  CHF: { code: "CHF", symbol: "CHF", fractionDigits: 2 },
  JPY: { code: "JPY", symbol: "¥", fractionDigits: 0 },
  SGD: { code: "SGD", symbol: "S$", fractionDigits: 2 },
  NZD: { code: "NZD", symbol: "NZ$", fractionDigits: 2 },
  HKD: { code: "HKD", symbol: "HK$", fractionDigits: 2 },
  SAR: { code: "SAR", symbol: "SAR", fractionDigits: 2 },
  QAR: { code: "QAR", symbol: "QAR", fractionDigits: 2 },
  KWD: { code: "KWD", symbol: "KD", fractionDigits: 3 },
};

export function isSupportedCurrency(value: string): value is SupportedCurrency {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}
