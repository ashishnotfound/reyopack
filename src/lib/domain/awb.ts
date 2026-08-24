const AMAZON_ORDER_ID_PATTERN = /^\d{3}-\d{7}-\d{7}$/;

export function normalizeBarcode(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\u0000-\u001f\u007f\s]+/g, '')
    .trim()
    .toUpperCase();
}

export function normalizeAwb(value: string): string {
  const normalized = normalizeBarcode(value);
  if (normalized.length < 4 || normalized.length > 128) {
    throw new Error('Barcode must be between 4 and 128 characters.');
  }
  return normalized;
}

export function isAmazonOrderId(value: string): boolean {
  return AMAZON_ORDER_ID_PATTERN.test(normalizeBarcode(value));
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
