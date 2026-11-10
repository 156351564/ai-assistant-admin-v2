import type { Metadata } from "next";
import ChatBox from "@/components/ChatBox";

export const metadata: Metadata = {
  title: "流式对话",
  description: "SSE 流式输出演示：打字机效果、随时中断、首字延迟打点。",
};

export default function ChatPage() {
  return (
    <main className="min-h-screen bg-neutral-50 py-10">
      <ChatBox />
    </main>
  );
}
