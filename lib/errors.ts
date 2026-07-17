// Typed error shared by the store and the accounts/payments layer: routes map
// .status to the HTTP response code. Lives in its own module (not lib/store.ts)
// so lib/accounts.ts can throw it without a store<->accounts import cycle.
export class StoreError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'StoreError';
    this.status = status;
  }
}
