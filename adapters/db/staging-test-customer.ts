export function stagingTestCustomer(subject: string): { customerId: number; fixtureEmail?: string } | null {
  if (!/^[1-9]\d*$/.test(subject)) {return null;}
  const customerId = Number(subject);
  if (!Number.isSafeInteger(customerId) || customerId > 2147483647) {return null;}
  if (customerId === 23003227) {return { customerId };}
  if (customerId === 23003226) {return { customerId, fixtureEmail: "fretwise-local-sso-test@example.invalid" };}
  const configuredId = process.env.FRETWISE_STAGING_NEW_CUSTOMER_ID;
  const email = process.env.FRETWISE_STAGING_NEW_CUSTOMER_EMAIL?.trim().toLowerCase() ?? "";
  if (process.env.NODE_ENV === "production" || subject !== configuredId || !/^[^\s@]+@[^\s@]+\.(test|invalid)$/.test(email)) {return null;}
  return { customerId, fixtureEmail: email };
}
