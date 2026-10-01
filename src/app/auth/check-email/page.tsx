import type { Metadata } from "next";
import { ConfirmEmail } from "@/components/auth/confirm-email";

export const metadata: Metadata = { title: "Check your email" };

export default async function CheckEmailPage({
  searchParams,
}: PageProps<"/auth/check-email">) {
  const { email, code } = await searchParams;
  const address = typeof email === "string" && email.includes("@") ? email : null;
  const authCode = typeof code === "string" && code.length > 0 ? code : null;

  return <ConfirmEmail code={authCode} address={address} />;
}
