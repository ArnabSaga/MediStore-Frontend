import { AiChatWidget } from '@/components/ai/ai-chat-widget';
import { Footer } from '@/components/layout/Footer';
import { Navbar } from '@/components/layout/Navbar';

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <main className="mx-auto w-full max-w-6xl px-4 py-8">{children}</main>
      <Footer />
      <AiChatWidget />
    </div>
  );
}
