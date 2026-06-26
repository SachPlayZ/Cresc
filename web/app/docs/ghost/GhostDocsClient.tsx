"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Check,
  Copy,
  ChevronLeft,
  ChevronRight,
  Info,
  AlertTriangle,
  X,
  ArrowRight,
  Sparkles,
  Layers,
  Key,
  CheckCircle2,
  FileCode,
  Play
} from "lucide-react";

interface StepData {
  id: number;
  title: string;
  shortTitle: string;
  image?: string | string[];
  imageAlt?: string | string[];
  content: React.ReactNode;
}

export default function GhostDocsClient() {
  const [activeStep, setActiveStep] = useState(0);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [appUrl, setAppUrl] = useState("https://cresc.vercel.app");

  useEffect(() => {
    if (typeof window !== "undefined") {
      const origin = window.location.origin;
      setTimeout(() => {
        setAppUrl(origin);
      }, 0);
    }
  }, []);

  const steps: StepData[] = [
    {
      id: 1,
      title: "Create your Cresc Wallet",
      shortTitle: "Cresc Wallet",
      content: (
        <div className="space-y-4">
          <p className="text-muted-foreground text-base leading-relaxed">
            Visit the{" "}
            <Link
              href="/ghost-onboard"
              className="text-primary hover:underline font-semibold inline-flex items-center gap-1"
            >
              Ghost Onboarding <ArrowRight className="w-3.5 h-3.5" />
            </Link>{" "}
            page in Cresc and create your creator wallet.
          </p>
          <div className="bg-muted/30 border border-border/60 rounded-xl p-6 space-y-4">
            <h4 className="font-heading font-semibold text-sm text-foreground flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#C6F84E]" />
              Onboarding Checklist
            </h4>
            <ol className="space-y-3 font-sans text-sm text-muted-foreground">
              <li className="flex items-start gap-3">
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[#C6F84E]/10 text-[#C6F84E] font-mono text-xs font-bold mt-0.5 shrink-0">1</span>
                <span>Enter your display name.</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[#C6F84E]/10 text-[#C6F84E] font-mono text-xs font-bold mt-0.5 shrink-0">2</span>
                <span>Initialize the browser session.</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[#C6F84E]/10 text-[#C6F84E] font-mono text-xs font-bold mt-0.5 shrink-0">3</span>
                <span>Sign in with Google.</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[#C6F84E]/10 text-[#C6F84E] font-mono text-xs font-bold mt-0.5 shrink-0">4</span>
                <span>Complete the Circle wallet challenge.</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[#C6F84E]/10 text-[#C6F84E] font-mono text-xs font-bold mt-0.5 shrink-0">5</span>
                <span>Create your Arc Testnet wallet.</span>
              </li>
            </ol>
          </div>
          
          <Callout type="info">
            This wallet is where your x402 nanopayments will be received. It is built using Circle User Controlled Wallets, providing custody directly on the Arc Testnet.
          </Callout>
        </div>
      )
    },
    {
      id: 2,
      title: "Open Ghost Integrations",
      shortTitle: "Ghost Integrations",
      image: "/step2.png",
      imageAlt: "Ghost Integrations Settings page screenshot",
      content: (
        <div className="space-y-4">
          <p className="text-muted-foreground text-base leading-relaxed">
            Inside your Ghost Admin dashboard, navigate to your integration settings:
          </p>
          <div className="bg-muted/40 border border-border/80 rounded-xl p-4 my-2 font-mono text-sm inline-block">
            <span className="text-muted-foreground">Settings</span>
            <span className="mx-2 text-[#9B86FF]">→</span>
            <span className="text-muted-foreground">Advanced</span>
            <span className="mx-2 text-[#9B86FF]">→</span>
            <span className="text-foreground font-semibold">Integrations</span>
          </div>
          <p className="text-muted-foreground text-base leading-relaxed">
            Scroll down to the bottom of the page and click the <strong className="text-foreground">Add custom integration</strong> button.
          </p>
          <Callout type="info">
            This integration lets Cresc securely communicate with your Ghost publication for post sync and webhook management.
          </Callout>
        </div>
      )
    },
    {
      id: 3,
      title: "Create Custom Integration & Copy API Keys",
      shortTitle: "API Keys",
      image: ["/step3.png", "/step4.png"],
      imageAlt: ["Add integration modal screenshot", "Ghost integration API details screenshot"],
      content: (
        <div className="space-y-6">
          <div className="space-y-3">
            <h3 className="font-heading font-semibold text-lg text-foreground flex items-center gap-2">
              <Layers className="w-5 h-5 text-[#9B86FF]" />
              Create the Integration
            </h3>
            <p className="text-muted-foreground text-base leading-relaxed">
              Name the custom integration:
            </p>
            <div className="bg-muted/30 border border-border/60 rounded-xl p-3 my-2 font-mono text-sm inline-flex items-center gap-3">
              <span className="text-[#C6F84E] font-bold">Cresc</span>
              <CopyButton text="Cresc" />
            </div>
            <p className="text-muted-foreground text-sm">
              Press the <strong className="text-foreground">Add</strong> button to save the integration.
            </p>
          </div>

          <div className="border-t border-border/50 pt-6 space-y-3">
            <h3 className="font-heading font-semibold text-lg text-foreground flex items-center gap-2">
              <Key className="w-5 h-5 text-[#9B86FF]" />
              Copy the Required Information
            </h3>
            <p className="text-muted-foreground text-base leading-relaxed">
              Open the integration you just created and copy the following values:
            </p>
            <ul className="list-disc pl-5 space-y-1 text-sm text-muted-foreground">
              <li>API URL</li>
              <li>Admin API Key</li>
            </ul>
            <p className="text-muted-foreground text-sm leading-relaxed mt-2">
              The Admin API Key is a long string that looks like <code className="bg-muted/40 px-1.5 py-0.5 rounded font-mono text-foreground text-xs">id:secret</code>. Paste both values into the final step of the Cresc onboarding dashboard.
            </p>
            
            <Callout type="warning">
              Never expose your Admin API Key publicly. Treat it as a secret password.
            </Callout>

            <div className="bg-muted/30 border border-border/60 rounded-xl p-5 mt-4 space-y-2">
              <h4 className="font-heading font-semibold text-sm text-foreground flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#86D6A8]" />
                What happens next?
              </h4>
              <p className="text-muted-foreground text-xs leading-relaxed">
                Once verified, Cresc will validate your Ghost site URL, sync existing posts, and generate a webhook secret along with your custom HTML/JS injection snippet.
              </p>
            </div>
          </div>
        </div>
      )
    },
    {
      id: 4,
      title: "Add the Ghost Webhook",
      shortTitle: "Add Webhook",
      image: "/step5.png",
      imageAlt: "Add webhook configuration screenshot",
      content: (
        <div className="space-y-4">
          <p className="text-muted-foreground text-base leading-relaxed">
            Navigate back to your custom <strong className="text-foreground">Cresc</strong> integration in Ghost Admin, and click <strong className="text-foreground">Add webhook</strong>.
          </p>
          <p className="text-muted-foreground text-sm leading-relaxed">
            If your Ghost version restricts each webhook to a single event, you will need to add <strong>three</strong> separate webhooks with the following trigger events:
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 py-2">
            {["Post published", "Post updated", "Post deleted"].map((evt) => (
              <div key={evt} className="bg-muted/30 border border-border/50 rounded-lg p-2.5 text-center font-[#C6F84E] font-semibold font-mono">
                {evt}
              </div>
            ))}
          </div>

          <div className="space-y-2 mt-4">
            <label className="text-xs font-mono text-muted-foreground uppercase tracking-wider block font-mono">Target URL</label>
            <CodeBlock value={`${appUrl}/api/ghost/sync?site=YOUR_CREATOR_ID`} />
          </div>

          <Callout type="warning">
            Always use the webhook secret generated by Cresc during onboarding. Do not invent this value—Cresc uses it to verify signature headers and authenticate requests from Ghost.
          </Callout>
        </div>
      )
    },
    {
      id: 5,
      title: "Open Ghost Code Injection",
      shortTitle: "Code Injection",
      image: "/step6.png",
      imageAlt: "Ghost code injection settings screenshot",
      content: (
        <div className="space-y-4">
          <p className="text-muted-foreground text-base leading-relaxed">
            In your Ghost Admin dashboard, navigate to the code injection tab:
          </p>
          <div className="bg-muted/40 border border-border/80 rounded-xl p-4 my-2 font-mono text-sm inline-block">
            <span className="text-muted-foreground">Settings</span>
            <span className="mx-2 text-[#9B86FF]">→</span>
            <span className="text-muted-foreground">Advanced</span>
            <span className="mx-2 text-[#9B86FF]">→</span>
            <span className="text-foreground font-semibold">Code Injection</span>
          </div>
          <p className="text-muted-foreground text-base leading-relaxed">
            Keep this tab open. Later in this guide, you will paste the Cresc snippet into the <strong className="text-foreground">Site Footer</strong> editor box.
          </p>
        </div>
      )
    },
    {
      id: 6,
      title: "Paste the Cresc Script",
      shortTitle: "Inject Script",
      image: "/step7.png",
      imageAlt: "Code Injection Footer snippet settings screenshot",
      content: (
        <div className="space-y-4">
          <p className="text-muted-foreground text-base leading-relaxed">
            Navigate back to <strong className="text-foreground">Settings → Advanced → Code Injection</strong>.
          </p>
          <p className="text-muted-foreground text-base leading-relaxed">
            Scroll down to the <strong className="text-foreground">Site Footer</strong> field and paste the custom script tag generated during onboarding:
          </p>
          
          <div className="my-3 space-y-1">
            <CodeBlock value={`<script
  src="${appUrl}/cresc-ghost.js"
  data-site="YOUR_CREATOR_ID">
</script>`} />
          </div>

          <p className="text-muted-foreground text-sm">
            If you are doing manual setup, replace <code className="bg-muted/40 px-1 py-0.5 rounded font-mono text-foreground text-xs">YOUR_CREATOR_ID</code> with your active creator address. During onboarding, this is prefilled automatically.
          </p>

          <Callout type="warning">
            Paste the script into <strong>Site Footer</strong>. Do not paste it into the Site Header, as it needs to run after the page elements have loaded.
          </Callout>
        </div>
      )
    },
    {
      id: 7,
      title: "Publish or Update a Post",
      shortTitle: "Go Live!",
      content: (
        <div className="space-y-4">
          <p className="text-muted-foreground text-base leading-relaxed">
            Publish a new Ghost post or trigger an edit on an existing one to test the integration.
          </p>
          
          <div className="bg-muted/30 border border-border/60 rounded-xl p-6 space-y-4">
            <h4 className="font-heading font-semibold text-sm text-[#86D6A8] flex items-center gap-2">
              <Play className="w-4 h-4 fill-current text-[#86D6A8]" />
              How the Flow Works
            </h4>
            <ul className="space-y-3 text-sm text-muted-foreground">
              <li className="flex items-start gap-3">
                <span className="w-1.5 h-1.5 rounded-full bg-[#86D6A8] mt-2 shrink-0" />
                <span>Ghost fires a webhook to Cresc containing the post update.</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="w-1.5 h-1.5 rounded-full bg-[#86D6A8] mt-2 shrink-0" />
                <span>Cresc syncs the post data and inserts it into our catalog.</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="w-1.5 h-1.5 rounded-full bg-[#86D6A8] mt-2 shrink-0" />
                <span>The autonomous AI agent reviews the post and sets the initial price.</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="w-1.5 h-1.5 rounded-full bg-[#86D6A8] mt-2 shrink-0" />
                <span>The footer script dynamically intercepts the content view and renders the unlock action overlay.</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="w-1.5 h-1.5 rounded-full bg-[#86D6A8] mt-2 shrink-0" />
                <span>Readers instantly pay and unlock the content using secure, low-fee x402 nanopayments.</span>
              </li>
            </ul>
          </div>

          <div className="bg-[#86D6A8]/5 border border-[#86D6A8]/20 rounded-xl p-6 text-center space-y-3">
            <span className="text-3xl">🎉</span>
            <h3 className="font-heading font-bold text-lg text-[#86D6A8]">You are all set!</h3>
            <p className="text-muted-foreground text-sm max-w-md mx-auto leading-relaxed">
              Your Ghost publication is now successfully connected to the Cresc protocol. Your content is now monetized in real time.
            </p>
            <div className="pt-2">
              <Link href="/ghost-onboard" style={{ textDecoration: "none" }}>
                <button className="cresc-btn-accent px-6 py-2.5 rounded-lg text-sm font-bold shadow-md hover:opacity-90 transition-opacity">
                  Go to Onboarding Dashboard
                </button>
              </Link>
            </div>
          </div>
        </div>
      )
    }
  ];

  const handlePrev = () => {
    if (activeStep > 0) setActiveStep(activeStep - 1);
  };

  const handleNext = () => {
    if (activeStep < steps.length - 1) setActiveStep(activeStep + 1);
  };

  const activeStepData = steps[activeStep];

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-8 py-10">
      {/* Top Header */}
      <div className="mb-12 text-center md:text-left">
        <div
          className="inline-flex items-center gap-1.5 font-mono text-xs tracking-widest uppercase px-3.5 py-1.5 rounded-full border border-border/80 bg-[#1A1430]/60 text-violet-400 mb-4"
        >
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#C6F84E]" />
          Setup Manual
        </div>
        <h1 className="font-heading font-extrabold text-4xl sm:text-5xl leading-tight tracking-tight text-foreground">
          Connect Ghost to Cresc
        </h1>
        <p className="text-muted-foreground text-base sm:text-lg max-w-2xl mt-3 leading-relaxed">
          Connect your Ghost publication to Cresc in a few minutes. This guide walks you through creating your wallet, connecting your Ghost site, syncing posts, and enabling Cresc&apos;s AI-powered paywall.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Navigation Stepper Timeline */}
        <div className="lg:col-span-4 space-y-4 lg:sticky lg:top-24">
          {/* Mobile Stepper Header */}
          <div className="flex lg:hidden overflow-x-auto gap-2.5 pb-3 border-b border-border/40 scrollbar-none">
            {steps.map((step, idx) => {
              const isActive = idx === activeStep;
              const isCompleted = idx < activeStep;
              return (
                <button
                  key={step.id}
                  onClick={() => setActiveStep(idx)}
                  className={`px-3 py-2 rounded-lg text-xs font-mono font-bold shrink-0 transition-all ${
                    isActive
                      ? "bg-[#C6F84E] text-[#1B2400] shadow-sm"
                      : isCompleted
                      ? "bg-violet-950/20 border border-violet-900/30 text-[#9B86FF]"
                      : "bg-[#1A1430]/60 border border-border/30 text-muted-foreground"
                  }`}
                >
                  Step {idx + 1}
                </button>
              );
            })}
          </div>

          {/* Desktop Stepper Sidebar */}
          <div className="hidden lg:block space-y-2">
            <h3 className="text-xs font-mono uppercase text-muted-foreground tracking-wider mb-4 px-2">
              Setup Steps
            </h3>
            <div className="relative border-l border-border/45 ml-4 pl-6 space-y-4 py-2">
              {steps.map((step, idx) => {
                const isActive = idx === activeStep;
                const isCompleted = idx < activeStep;

                return (
                  <button
                    key={step.id}
                    onClick={() => setActiveStep(idx)}
                    className="group relative flex flex-col items-start w-full text-left focus:outline-none transition-all py-1.5"
                  >
                    {/* Circle Pin */}
                    <span
                      className={`absolute -left-[31px] top-2.5 flex items-center justify-center w-4 h-4 rounded-full border text-[9px] font-bold font-mono transition-all duration-300 ${
                        isActive
                          ? "bg-[#C6F84E] border-[#C6F84E] text-[#1B2400] scale-125 shadow-md shadow-[#C6F84E]/10"
                          : isCompleted
                          ? "bg-[#9B86FF] border-[#9B86FF] text-[#15101F]"
                          : "bg-[#1A1430] border-border group-hover:border-muted-foreground"
                      }`}
                    >
                      {isCompleted ? <Check className="w-2.5 h-2.5 stroke-[3]" /> : idx + 1}
                    </span>

                    <span
                      className={`font-heading font-semibold text-sm transition-colors ${
                        isActive
                          ? "text-[#C6F84E]"
                          : isCompleted
                          ? "text-[#9B86FF]"
                          : "text-muted-foreground group-hover:text-foreground"
                      }`}
                    >
                      {step.shortTitle}
                    </span>
                    <span className="text-xs text-dim mt-0.5 line-clamp-1 max-w-[220px]">
                      {step.title}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Main Content Stepper Card */}
        <div className="lg:col-span-8 space-y-6">
          <div className="bg-[#1A1430]/60 border border-border/70 rounded-2xl p-6 sm:p-8 shadow-xl backdrop-blur-md relative overflow-hidden">
            <div
              className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-violet-500/10 to-transparent pointer-events-none"
            />
            
            {/* Top Indicator */}
            <div className="flex justify-between items-center mb-6 border-b border-border/40 pb-4">
              <span className="font-mono text-xs text-dim font-semibold uppercase tracking-wider">
                Step 0{activeStepData.id} of 0{steps.length}
              </span>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/40 border border-border/50 px-2.5 py-1 rounded-full font-semibold">
                <span className={`w-2 h-2 rounded-full ${activeStep === steps.length - 1 ? 'bg-green-400' : 'bg-amber-400 animate-pulse'}`} />
                {activeStep === steps.length - 1 ? "Connected" : "In Progress"}
              </span>
            </div>

            {/* Title */}
            <h2 className="font-heading font-extrabold text-2xl sm:text-3xl text-foreground mb-6 tracking-tight">
              {activeStepData.title}
            </h2>

            {/* Stepper Images (if available) */}
            {activeStepData.image && (
              <div className="mb-6 space-y-4">
                {Array.isArray(activeStepData.image) ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {activeStepData.image.map((img, index) => (
                      <div
                        key={img}
                        onClick={() => setLightboxImage(img)}
                        className="group relative cursor-zoom-in rounded-xl border border-border/80 overflow-hidden bg-muted/20 hover:border-border transition-all duration-300 shadow-md hover:scale-[1.01]"
                      >
                        <img
                          src={img}
                          alt={
                            Array.isArray(activeStepData.imageAlt)
                              ? activeStepData.imageAlt[index]
                              : "Screenshot"
                          }
                          className="w-full h-auto object-cover max-h-56"
                        />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <span className="text-white text-xs font-mono font-bold bg-[#15101F]/80 border border-border/80 px-2.5 py-1 rounded-full backdrop-blur">
                            Click to expand
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div
                    onClick={() => setLightboxImage(activeStepData.image as string)}
                    className="group relative cursor-zoom-in rounded-xl border border-border/80 overflow-hidden bg-muted/20 hover:border-border transition-all duration-300 shadow-md hover:scale-[1.01]"
                  >
                    <img
                      src={activeStepData.image}
                      alt={activeStepData.imageAlt as string || "Step Screenshot"}
                      className="w-full h-auto object-cover max-h-96"
                    />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <span className="text-white text-xs font-mono font-bold bg-[#15101F]/80 border border-border/80 px-2.5 py-1 rounded-full backdrop-blur">
                        Click to expand
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Stepper Description Content */}
            <div className="prose prose-invert max-w-none text-muted-foreground leading-relaxed text-sm sm:text-base">
              {activeStepData.content}
            </div>

            {/* Buttons Controls */}
            <div className="flex justify-between items-center mt-10 pt-6 border-t border-border/40">
              <button
                onClick={handlePrev}
                disabled={activeStep === 0}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl border border-border text-foreground hover:bg-muted/30 hover:border-muted-foreground disabled:opacity-30 disabled:hover:bg-transparent disabled:pointer-events-none transition-all cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
                Previous Step
              </button>

              {activeStep < steps.length - 1 ? (
                <button
                  onClick={handleNext}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-bold rounded-xl bg-[#C6F84E] text-[#1B2400] shadow-md hover:opacity-90 hover:scale-[1.01] active:scale-100 transition-all font-sans cursor-pointer"
                >
                  Next Step
                  <ChevronRight className="w-4 h-4" />
                </button>
              ) : (
                <Link href="/" className="no-underline">
                  <button
                    className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-bold rounded-xl bg-violet-600 text-white shadow-md hover:bg-violet-700 hover:scale-[1.01] active:scale-100 transition-all font-sans cursor-pointer"
                  >
                    Finish Setup
                    <CheckCircle2 className="w-4 h-4 text-emerald-300" />
                  </button>
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Lightbox Modal overlay */}
      {lightboxImage && (
        <div
          onClick={() => setLightboxImage(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-[cresc-termin_0.2s_ease-out_forwards] cursor-zoom-out"
        >
          <button
            onClick={() => setLightboxImage(null)}
            className="absolute top-4 right-4 text-white hover:text-red-400 p-2 focus:outline-none transition-colors cursor-pointer"
          >
            <X className="w-6 h-6" />
          </button>
          <div className="relative max-w-5xl max-h-[85vh] overflow-hidden rounded-xl border border-white/10 shadow-2xl">
            <img
              src={lightboxImage}
              alt="Expanded step screenshot"
              className="w-full h-auto max-h-[85vh] object-contain"
            />
          </div>
        </div>
      )}
    </div>
  );
}

/* Helper Custom Callout Box Component */
function Callout({ type, children }: { type: "info" | "warning"; children: React.ReactNode }) {
  const isWarning = type === "warning";
  return (
    <div
      className={`border-l-4 rounded-r-xl p-4 my-4 flex gap-3.5 items-start ${
        isWarning
          ? "bg-amber-950/10 border-amber-500/80 text-amber-200/90"
          : "bg-violet-950/15 border-[#9B86FF] text-violet-200/90"
      }`}
    >
      {isWarning ? (
        <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
      ) : (
        <Info className="w-5 h-5 text-[#9B86FF] shrink-0 mt-0.5" />
      )}
      <div className="text-xs sm:text-sm leading-relaxed">{children}</div>
    </div>
  );
}

/* Helper Copy Text Button Component */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error("Failed to copy text: ", e);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold focus:outline-none transition-all cursor-pointer ${
        copied
          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
          : "bg-muted hover:bg-muted-foreground/20 text-muted-foreground border border-border/80"
      }`}
    >
      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

/* Custom Styled Code Block with copy-on-hover button */
function CodeBlock({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error("Failed to copy code: ", e);
    }
  };

  return (
    <div className="relative group rounded-xl border border-border/70 bg-[#15101F] overflow-hidden my-3 font-mono text-xs">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/40 bg-muted/20">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
          <FileCode className="w-3.5 h-3.5 text-[#9B86FF]" />
          Code snippet
        </span>
        <button
          onClick={handleCopy}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold transition-all cursor-pointer ${
            copied
              ? "bg-emerald-500/20 text-[#86D6A8]"
              : "bg-muted/40 hover:bg-muted/80 text-muted-foreground hover:text-foreground border border-border/50"
          }`}
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-[#86D6A8]" />
              Copied!
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              Copy Code
            </>
          )}
        </button>
      </div>
      <pre className="p-4 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed text-slate-300 font-mono select-all">
        <code>{value}</code>
      </pre>
    </div>
  );
}
