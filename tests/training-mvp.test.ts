import { describe, expect, it } from 'vitest';
import { asUser, testDatabase } from './helpers/database.js';
import { KnowledgeRepository } from '../packages/db/src/knowledge-repository.js';
import { createSdrTemplate, makeNode } from '../packages/flow/src/templates.js';
import { runPlayground } from '../packages/flow/src/playground.js';
import { MockLLMProvider } from '../packages/flow/src/services/llm.js';

describe('Treinar meu SDR', () => {
  it('mantém rascunhos fora da busca e sincroniza aprovação, revisão e arquivamento', async () => {
    const db = await testDatabase();
    const owner = '00000000-0000-0000-0000-0000000000c1';
    const stranger = '00000000-0000-0000-0000-0000000000c2';
    await db.query('insert into auth.users(id,email) values($1,$2),($3,$4)', [owner, 'owner-training@test.com', stranger, 'stranger-training@test.com']);
    const org = await asUser(db, owner, async () => (await db.query<{ create_organization: string }>("select public.create_organization('Loja Exemplo')")).rows[0].create_organization);
    const profile = await asUser(db, owner, async () => (await db.query<{ id: string }>(
      "insert into public.organization_training_profiles(organization_id,company,sales,created_by) values($1,'{\"name\":\"Loja Exemplo\"}','{}',$2) returning id", [org, owner],
    )).rows[0].id);
    await expect(asUser(db, stranger, async () => db.query('select public.approve_training_profile($1)', [org]))).rejects.toThrow();
    await asUser(db, owner, async () => db.query('select public.approve_training_profile($1)', [org]));
    expect((await db.query('select status from public.organization_training_profiles where id=$1', [profile])).rows[0].status).toBe('approved');
    const fact = await asUser(db, owner, async () => (await db.query<{ id: string }>(
      "insert into public.training_facts(organization_id,profile_id,category,question,answer,created_by) values($1,$2,'pricing','Qual o preço?','R$ 49 por mês',$3) returning id", [org, profile, owner],
    )).rows[0].id);
    expect((await db.query('select * from public.knowledge_documents where organization_id=$1', [org])).rows).toHaveLength(0);
    await expect(asUser(db, stranger, async () => db.query('select public.approve_training_fact($1,$2,$3)', [org, fact, [1, 0]]))).rejects.toThrow();
    await asUser(db, owner, async () => db.query('select public.approve_training_fact($1,$2,$3)', [org, fact, KnowledgeRepository.generateFallbackEmbedding('R$ 49 por mês')]));
    expect((await db.query('select * from public.knowledge_documents where organization_id=$1', [org])).rows).toHaveLength(1);
    const embedding = KnowledgeRepository.generateFallbackEmbedding('R$ 49 por mês');
    const outsiderHits = await asUser(db, stranger, async () => db.query('select * from public.match_knowledge($1,$2,$3,$4,$5)', [org, embedding, null, 0, 5]));
    expect(outsiderHits.rows).toHaveLength(0);
    await asUser(db, owner, async () => db.query("select public.revise_training_fact($1,$2,'pricing','Qual o preço?','R$ 59 por mês')", [org, fact]));
    expect((await db.query('select * from public.knowledge_documents where organization_id=$1', [org])).rows).toHaveLength(0);
    await asUser(db, owner, async () => db.query('select public.approve_training_fact($1,$2,$3)', [org, fact, KnowledgeRepository.generateFallbackEmbedding('R$ 59 por mês')]));
    await asUser(db, owner, async () => db.query('select public.archive_training_fact($1,$2)', [org, fact]));
    expect((await db.query('select * from public.knowledge_documents where organization_id=$1', [org])).rows).toHaveLength(0);
  });

  it('inclui conhecimento antes da decisão no novo template SDR', () => {
    const graph = createSdrTemplate();
    expect(graph.edges).toContainEqual(expect.objectContaining({ source: 'memory', target: 'knowledge' }));
    expect(graph.edges).toContainEqual(expect.objectContaining({ source: 'knowledge', target: 'decide' }));
  });

  it('leva as instruções aprovadas ao agente e respeita RAG desligado', async () => {
    const graph = {
      schemaVersion: 1 as const,
      nodes: [makeNode('trigger.message_received', 'start'), makeNode('context.knowledge', 'knowledge'), makeNode('agent.decide', 'decide'), makeNode('output.end', 'end')],
      edges: [
        { id: 'a', source: 'start', sourcePort: 'next', target: 'knowledge' },
        { id: 'b', source: 'knowledge', sourcePort: 'next', target: 'decide' },
        { id: 'c', source: 'decide', sourcePort: 'next', target: 'end' },
      ],
    };
    const mock = new MockLLMProvider();
    let system = '';
    let searches = 0;
    const result = await runPlayground({
      graph,
      organizationId: '00000000-0000-0000-0000-0000000000c1',
      message: 'Qual o preço?',
      variables: { agentSystemPrompt: 'Empresa: Loja Exemplo', agentRagEnabled: false },
      services: {
        llm: { ...mock, decide: async request => { system = request.system || ''; return mock.decide(request); } },
        db: {
          async updateLead() {}, async updateConversation() {},
          async saveMessage() { return { id: 'test' }; }, async syncDeal() { return { id: 'test' }; },
          async searchKnowledge() { searches++; return ['Preço inventado']; },
        },
      },
    });
    expect(result.status).toBe('completed');
    expect(system).toContain('Empresa: Loja Exemplo');
    expect(searches).toBe(0);
    expect(result.knowledgeUsed).toEqual([]);
  });
});
