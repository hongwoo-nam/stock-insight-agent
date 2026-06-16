"use client";

import { useState } from "react";
import { FloatingButton } from "@/components/chat/FloatingButton";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { DashboardContent } from "@/components/layout/DashboardContent";
import { Navbar } from "@/components/layout/Navbar";

export default function Home() {
  const [chatOpen, setChatOpen] = useState(false);
  const [voiceType] = useState<"male" | "female">("male");

  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <DashboardContent />
      <FloatingButton onClick={() => setChatOpen(!chatOpen)} isOpen={chatOpen} />
      <ChatPanel
        isOpen={chatOpen}
        onClose={() => setChatOpen(false)}
        voiceType={voiceType}
      />
    </div>
  );
}
