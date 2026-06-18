import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { defineChain } from "viem";

// Arc Testnet — chain ID 5042002, native gas token is USDC (18-decimal representation)
export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://arc-testnet.drpc.org"] },
  },
  blockExplorers: {
    default: { name: "ArcScan", url: "https://testnet.arcscan.app" },
  },
  testnet: true,
});

export const wagmiConfig = getDefaultConfig({
  appName: "Cresc",
  // Real WalletConnect project ID required for QR-code modal; MetaMask injected works without it.
  // Fallback prevents build-time crash when env var is absent.
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "00000000000000000000000000000001",
  chains: [arcTestnet],
  ssr: true,
});
