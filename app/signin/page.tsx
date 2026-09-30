import { redirect } from "next/navigation";
import { authMode } from "../../lib/auth-mode";
import SignIn from "./signin";

export const dynamic = "force-dynamic";

export default function Page() {
  if (authMode() === "anon") redirect("/");
  return <SignIn providerName={process.env.OIDC_IDP_DISPLAY_NAME || "OpenID"} />;
}
