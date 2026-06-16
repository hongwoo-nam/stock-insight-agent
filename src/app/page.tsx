"use client";

import { useState, useEffect } from "react";
import { FloatingButton } from "@/components/chat/FloatingButton";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { DashboardContent } from "@/components/layout/DashboardContent";
import { Navbar } from "@/components/layout/Navbar";

export default function Home() {
  const [chatOpen, setChatOpen] = useState(false);
  const [voiceType] = useState<"male" | "female">("male");
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const msg = (e as CustomEvent<string>).detail;
      setPendingMessage(msg);
      setChatOpen(true);
    };
    window.addEventListener("openChatWithMessage", handler);
    return () => window.removeEventListener("openChatWithMessage", handler);
  }, []);

  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <DashboardContent />
      <FloatingButton onClick={() => setChatOpen(!chatOpen)} isOpen={chatOpen} />
      <ChatPanel
        isOpen={chatOpen}
        onClose={() => setChatOpen(false)}
        voiceType={voiceType}
        initialMessage={pendingMessage}
        onInitialMessageSent={() => setPendingMessage(null)}
      />
    </div>
  );
}
