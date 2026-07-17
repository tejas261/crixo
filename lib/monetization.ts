// Monetization kill switch — one server-owned flag that turns off ads AND
// ad-free purchases everywhere (web + mobile follow via /api/ads/config).
//
// Semantics: monetization is ON unless MONETIZATION_ENABLED is exactly
// 'false'. A missing var or any other value means on, so existing deploys
// without the var keep their current behaviour.
//
// Scope: gates the ads config and NEW purchase orders only. /api/payments/
// confirm, the webhook, /pay/[orderId] and the public order endpoint stay
// functional so in-flight orders still credit after the switch flips off.

export function monetizationEnabled(): boolean {
  return process.env.MONETIZATION_ENABLED !== 'false';
}
