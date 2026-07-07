"use client";

import { useRouter } from "next/navigation";
import { useCookies } from "react-cookie";

export function LogoutButton() {
  const router = useRouter();
  const [, , removeCookie] = useCookies(["circle_user_token", "circle_enc_key"]);

  async function handleLogout() {
    await fetch("/api/creator/logout", { method: "POST" });
    localStorage.removeItem("cresc_creator_id");
    localStorage.removeItem("cresc_ucw_wallet");
    // Cresc's own session (cresc_session, cleared above) is a separate layer from
    // Circle's wallet-signing session — without this, a fresh /ghost-onboard or /login
    // attempt right after logout still reads the *previous* account's Google/Circle
    // session as valid (shared cookie names, path: '/'), showing "already signed in"
    // for an identity that isn't the one being logged into now.
    removeCookie("circle_user_token", { path: "/" });
    removeCookie("circle_enc_key", { path: "/" });
    router.push("/");
  }

  return (
    <button
      onClick={handleLogout}
      className="font-sans text-xs text-muted-foreground hover:text-foreground transition-colors bg-transparent border-none"
    >
      Log out
    </button>
  );
}
