import React, { useState } from 'react';
import { Bot, Send, User, Sparkles, MessageSquare, AlertCircle } from 'lucide-react';
import { Modal, Button, Badge } from '../components/ui';
import type { Agent } from './types';

interface AgentPlaygroundModalProps {
  isOpen: boolean;
  onClose: () => void;
  agent: Agent | null;
}

export function AgentPlaygroundModal({
  isOpen,
  onClose,
  agent,
}: AgentPlaygroundModalProps) {
  const [messages, setMessages] = useState<
    Array<{ role: 'user' | 'assistant'; content: string; time: string }>
  >([
    {
      role: 'assistant',
      content:
        'Olá! Sou o assistente virtual da VidaCard. Como posso te ajudar hoje?',
      time: 'Agora',
    },
  ]);
  const [input, setInput] = useState('');
  const [simulating, setSimulating] = useState(false);

  if (!agent) return null;

  const handleSend = () => {
    if (!input.trim() || simulating) return;
    const userText = input.trim();
    setInput('');

    const userMsg = {
      role: 'user' as const,
      content: userText,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setSimulating(true);

    // Simulação visual de resposta do agente
    setTimeout(() => {
      let reply = 'Entendido! Nós oferecemos planos individuais e familiares com consultas a partir de R$ 35,00 e ampla rede credenciada. Quantas pessoas fariam parte do plano com você?';
      if (userText.toLowerCase().includes('preço') || userText.toLowerCase().includes('valor')) {
        reply = 'Nossos planos iniciam em apenas R$ 29,90 por mês com cobertura ambulatorial e descontos em farmácias. Gostaria que eu simulasse os valores para a sua família?';
      } else if (userText.toLowerCase().includes('humano') || userText.toLowerCase().includes('atendente')) {
        reply = 'Com certeza! Estou transferindo seu atendimento para um de nossos especialistas humanos. Um instante!';
      }

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: reply,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
      setSimulating(false);
    }, 900);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      maxWidth="lg"
      title={
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5 text-brand" />
          <span>Simulação de Conversa: {agent.name}</span>
        </div>
      }
      description={
        <div className="flex items-center gap-2 mt-1">
          <Badge variant="outline" size="sm">
            {agent.model}
          </Badge>
          <span className="text-[11px] text-content-muted">
            Ambiente de teste para validação de tom de voz e respostas
          </span>
        </div>
      }
    >
      <div className="flex flex-col h-[420px]">
        {/* Chat area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-canvas/60 rounded-xl border border-border">
          {messages.map((m, idx) => {
            const isUser = m.role === 'user';
            return (
              <div
                key={idx}
                className={`flex gap-2.5 max-w-[85%] ${
                  isUser ? 'ml-auto flex-row-reverse' : 'mr-auto'
                }`}
              >
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-xs ${
                    isUser
                      ? 'bg-brand text-canvas font-bold'
                      : 'bg-surface-elevated text-brand border border-border'
                  }`}
                >
                  {isUser ? <User size={13} /> : <Bot size={13} />}
                </div>
                <div
                  className={`p-3 rounded-2xl text-xs leading-relaxed ${
                    isUser
                      ? 'bg-brand text-canvas font-medium rounded-tr-xs'
                      : 'bg-surface border border-border text-content rounded-tl-xs shadow-xs'
                  }`}
                >
                  <p className="m-0 whitespace-pre-wrap">{m.content}</p>
                  <span
                    className={`text-[9px] mt-1 block text-right opacity-70 ${
                      isUser ? 'text-canvas' : 'text-content-muted'
                    }`}
                  >
                    {m.time}
                  </span>
                </div>
              </div>
            );
          })}

          {simulating && (
            <div className="flex items-center gap-2 text-xs text-content-muted">
              <Bot size={14} className="text-brand animate-pulse" />
              <span className="italic">O agente está digitando…</span>
            </div>
          )}
        </div>

        {/* Input area */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="flex items-center gap-2 mt-3"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Digite uma mensagem como se fosse o cliente no WhatsApp..."
            className="flex-1 bg-surface text-content border border-border rounded-xl text-xs px-3.5 py-2.5 outline-none focus:border-brand focus:ring-1 focus:ring-brand"
          />
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={!input.trim() || simulating}
          >
            <Send size={14} />
          </Button>
        </form>
      </div>
    </Modal>
  );
}
