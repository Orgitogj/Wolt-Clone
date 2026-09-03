export const currencySymbol = (code: string | undefined): string => {
  switch (code) {
    case 'EUR':
      return '€';
    case 'USD':
      return '$';
    case 'GBP':
      return '£';
    default:
      return code ?? '';
  }
};

export const formatMoney = (amount: number | null | undefined, code: string | undefined): string =>
  `${Number(amount ?? 0).toFixed(2)} ${currencySymbol(code)}`.trim();
