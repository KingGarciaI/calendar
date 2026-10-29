import { AssistantPanel } from "@/components/assistant/assistant-panel";

export const metadata = { title: "Assistant" };

export default function AssistantPage() {
  return (
    <div className="mx-auto flex h-[calc(100dvh-56px-64px-env(safe-area-inset-bottom))] w-full max-w-[760px] flex-col md:h-[calc(100dvh-56px)]">
      <AssistantPanel />
    </div>
  );
}
