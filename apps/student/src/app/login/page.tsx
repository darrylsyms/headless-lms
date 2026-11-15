import { Suspense } from "react";
import type { Metadata } from "next";
import { LoginView } from "./login-view";

export const metadata: Metadata = { title: "Sign in — Headless LMS" };

export default function LoginPage() {
  return (
    <Suspense>
      <LoginView stagingWordPress={process.env.NODE_ENV === "development" && process.env.FRETWISE_STAGING_WORDPRESS_SSO === "1"} />
    </Suspense>
  );
}
