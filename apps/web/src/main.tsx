import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Link, Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { Workflow, Settings2, Moon, Sun, Blocks, ArrowUpRight, MessageSquare, BarChart3, Radio, BookOpen } from 'lucide-react';
import { Builder } from './builder/Builder';
import { SessionProvider, Settings } from './session';
import { ConnectionsPage } from './connections/ConnectionsPage';
import { KnowledgePage } from './knowledge/KnowledgePage';
import { InboxPage } from './inbox/InboxPage';
import { DashboardPage } from './metrics/DashboardPage';
import './styles.css';

function App() {
  const [dark,setDark] = useState(() => { try { return localStorage.getItem('sdr-flow:theme') === 'dark'; } catch { return false; } });
  React.useEffect(() => { document.documentElement.className = dark ? 'dark' : 'light'; try { localStorage.setItem('sdr-flow:theme',dark ? 'dark' : 'light'); } catch { /* Theme still works without storage. */ } },[dark]);
  return <SessionProvider><BrowserRouter><div className="app-shell"><nav className="app-sidebar" aria-label="Navegação principal"><Link className="brand" to="/flows/new" title="SDR Flow"><Workflow size={27}/></Link><div className="sidebar-links"><NavLink to="/flows/new" aria-label="Construtor" title="Construtor"><Workflow size={21}/><span>Fluxos</span></NavLink><NavLink to="/connections" aria-label="Conexões" title="Conexões"><Radio size={21}/><span>Conexões</span></NavLink><NavLink to="/knowledge" aria-label="Base de Conhecimento" title="Base de Conhecimento"><BookOpen size={21}/><span>Conhecimento</span></NavLink><NavLink to="/inbox" aria-label="Inbox" title="Inbox"><MessageSquare size={21}/><span>Inbox</span></NavLink><NavLink to="/dashboard" aria-label="Painel de Indicadores" title="Painel"><BarChart3 size={21}/><span>Painel</span></NavLink><NavLink to="/templates" aria-label="Biblioteca" title="Biblioteca"><Blocks size={21}/><span>Modelos</span></NavLink></div><div className="sidebar-bottom"><button onClick={() => setDark(!dark)} aria-label={dark ? 'Ativar tema claro' : 'Ativar tema escuro'} title="Alternar tema">{dark ? <Sun size={20}/> : <Moon size={20}/>}</button><NavLink to="/settings" title="Configurações" aria-label="Configurações"><Settings2 size={21}/></NavLink><span className="avatar">SF</span></div></nav><main><Routes><Route path="/flows/new" element={<Builder/>}/><Route path="/connections" element={<ConnectionsPage/>}/><Route path="/knowledge" element={<KnowledgePage/>}/><Route path="/inbox" element={<InboxPage/>}/><Route path="/dashboard" element={<DashboardPage/>}/><Route path="/templates" element={<div className="page-content"><span className="eyebrow">BIBLIOTECA</span><h1>Comece com um caminho pronto</h1><p className="muted">Modelos editáveis para desenhar o atendimento da sua operação.</p><Link className="template-card" to="/flows/new"><Workflow size={32}/><h2>Qualificação SDR</h2><p>Modo teste, guardas, memória comercial, decisão, CRM e encaminhamento humano.</p><span>Abra o construtor e escolha “Usar modelo SDR”. <ArrowUpRight size={15}/></span></Link></div>}/><Route path="/settings" element={<Settings/>}/><Route path="*" element={<Navigate to="/flows/new" replace/>}/></Routes></main></div></BrowserRouter></SessionProvider>;
}
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
