"use client";

import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/creator/logout", { method: "POST" });
    localStorage.removeItem("cresc_creator_id");
    localStorage.removeItem("cresc_ucw_wallet");
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
