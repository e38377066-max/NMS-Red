import { FormEvent, useState } from "react";
import { BotMessageSquare, CheckCircle2, Loader2, Send, Sparkles, TriangleAlert } from "lucide-react";
import { useAiChat } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  context?: string | null;
};

const SUGGESTIONS = [
  "¿Qué equipos están fuera de línea y por dónde debería empezar?",
  "Analiza los riesgos actuales de mi red.",
  "¿Qué debo revisar si varios clientes pierden conexión?",
];

export default function Ai() {
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const chat = useAiChat();

  const sendMessage = (event?: FormEvent) => {
    event?.preventDefault();
    const content = message.trim();
    if (!content || chat.isPending) return;

    const userMessage: ChatMessage = {
      id: `${Date.now()}-user`,
      role: "user",
      content,
    };
    setMessages((current) => [...current, userMessage]);
    setMessage("");
    chat.mutate(
      { data: { message: content } },
      {
        onSuccess: (response) => {
          setMessages((current) => [
            ...current,
            {
              id: `${Date.now()}-assistant`,
              role: "assistant",
              content: response.reply,
              context: response.context,
            },
          ]);
        },
        onError: (error) => {
          setMessages((current) => [
            ...current,
            {
              id: `${Date.now()}-error`,
              role: "assistant",
              content: error instanceof Error ? error.message : "No se pudo consultar el diagnóstico.",
            },
          ]);
        },
      },
    );
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight">
          <BotMessageSquare className="h-8 w-8 text-primary" />
          Diagnóstico asistido
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Consulta el estado actual de equipos, clientes, alertas y servidores antes de tomar una acción.
        </p>
      </div>

      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="flex gap-3 p-4 text-sm">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-yellow-400" />
          <p className="text-muted-foreground">
            El asistente recomienda pasos y no ejecuta cambios directamente. Confirma siempre cualquier modificación en el equipo.
          </p>
        </CardContent>
      </Card>

      <Card className="flex min-h-[560px] flex-col bg-card/50">
        <CardHeader className="border-b border-border/40">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" />
            Asistente de red
            <Badge variant="outline" className="ml-auto border-emerald-500/30 text-emerald-400">
              Contexto en vivo
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-4 p-4">
          <div className="flex-1 space-y-4 overflow-y-auto pr-1">
            {messages.length === 0 ? (
              <div className="flex h-full min-h-[260px] flex-col items-center justify-center text-center">
                <div className="mb-4 rounded-full border border-primary/20 bg-primary/10 p-4">
                  <BotMessageSquare className="h-8 w-8 text-primary" />
                </div>
                <h2 className="text-lg font-semibold">¿Qué quieres investigar?</h2>
                <p className="mt-1 max-w-md text-sm text-muted-foreground">
                  Puedo relacionar alertas, equipos fuera de línea, clientes y nodos para ayudarte a encontrar la causa.
                </p>
                <div className="mt-5 grid w-full max-w-xl gap-2 md:grid-cols-3">
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => setMessage(suggestion)}
                      className="rounded-md border border-border bg-background/50 p-3 text-left text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((item) => (
                <div key={item.id} className={`flex ${item.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] rounded-lg border p-3 text-sm ${item.role === "user" ? "border-primary/30 bg-primary/10" : "border-border bg-background/60"}`}>
                    <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {item.role === "user" ? "Tú" : "Asistente"}
                      {item.role === "assistant" && <CheckCircle2 className="h-3 w-3 text-emerald-400" />}
                    </div>
                    <p className="whitespace-pre-wrap leading-6">{item.content}</p>
                    {item.context && <p className="mt-3 border-t border-border/50 pt-2 text-xs text-muted-foreground">{item.context}</p>}
                  </div>
                </div>
              ))
            )}
            {chat.isPending && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                Analizando el estado de la red...
              </div>
            )}
          </div>

          <form onSubmit={sendMessage} className="flex gap-2 border-t border-border/40 pt-4">
            <Textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Describe el problema o pregunta por un equipo..."
              rows={2}
              className="min-h-[64px] resize-none"
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  sendMessage();
                }
              }}
            />
            <Button type="submit" size="icon" className="h-12 w-12 shrink-0 self-end" disabled={!message.trim() || chat.isPending} aria-label="Enviar pregunta">
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}