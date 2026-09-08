import type { Database, Json } from './database.types.js';

export interface KnowledgeDocumentEntity {
  id: string;
  organization_id: string;
  collection: string;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
  embedding: number[] | null;
  token_count: number;
  created_at: string;
  updated_at: string;
}

export interface CreateDocumentInput {
  collection?: string;
  title: string;
  content: string;
  metadata?: Record<string, unknown>;
  embedding?: number[];
  token_count?: number;
}

export interface UpdateDocumentInput {
  collection?: string;
  title?: string;
  content?: string;
  metadata?: Record<string, unknown>;
  embedding?: number[];
  token_count?: number;
}

export interface SearchKnowledgeOptions {
  collection?: string;
  threshold?: number;
  limit?: number;
}

export interface SearchResult {
  id: string;
  collection: string;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
  similarity: number;
}

export class KnowledgeRepository {
  constructor(private readonly db: any) {}

  public static generateFallbackEmbedding(text: string, dimension = 64): number[] {
    const vector = new Array<number>(dimension).fill(0);
    if (!text || text.trim().length === 0) return vector;

    const normalized = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const tokens = normalized.match(/[\p{L}\p{N}]+/gu) || [];

    for (const token of tokens) {
      let hash = 0x811c9dc5;
      for (let i = 0; i < token.length; i++) {
        hash ^= token.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
      }
      const index = Math.abs(hash) % dimension;
      vector[index] = (vector[index] ?? 0) + 1.0;
    }

    let sumSquares = 0;
    for (let i = 0; i < dimension; i++) {
      const val = vector[i] ?? 0;
      sumSquares += val * val;
    }
    if (sumSquares === 0) return vector;

    const norm = Math.sqrt(sumSquares);
    for (let i = 0; i < dimension; i++) {
      vector[i] = Number(((vector[i] ?? 0) / norm).toFixed(6));
    }
    return vector;
  }

  public static cosineSimilarity(a: number[], b: number[]): number {
    if (!a || !b || a.length === 0 || a.length !== b.length) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      const valA = a[i] ?? 0;
      const valB = b[i] ?? 0;
      dot += valA * valB;
      normA += valA * valA;
      normB += valB * valB;
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  async createDocument(
    organizationId: string,
    input: CreateDocumentInput
  ): Promise<KnowledgeDocumentEntity> {
    const collection = input.collection || 'default';
    const embedding = input.embedding ?? KnowledgeRepository.generateFallbackEmbedding(input.content);
    const token_count = input.token_count ?? Math.max(1, Math.ceil(input.content.length / 4));

    if (typeof this.db.query === 'function' && typeof this.db.from !== 'function') {
      const res = await this.db.query(
        `insert into public.knowledge_documents (organization_id, collection, title, content, metadata, embedding, token_count)
         values ($1, $2, $3, $4, $5, $6, $7) returning *`,
        [organizationId, collection, input.title, input.content, JSON.stringify(input.metadata || {}), embedding, token_count]
      );
      const row = res.rows[0];
      return {
        ...row,
        metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata || {},
      };
    }

    const { data, error } = await this.db
      .from('knowledge_documents')
      .insert({
        organization_id: organizationId,
        collection,
        title: input.title,
        content: input.content,
        metadata: (input.metadata || {}) as Json,
        embedding,
        token_count,
      })
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to create knowledge document: ${error?.message || 'Unknown error'}`);
    }

    return {
      ...data,
      metadata: (data.metadata || {}) as Record<string, unknown>,
    };
  }

  async listDocuments(
    organizationId: string,
    collection?: string
  ): Promise<KnowledgeDocumentEntity[]> {
    if (typeof this.db.query === 'function' && typeof this.db.from !== 'function') {
      let sql = `select * from public.knowledge_documents where organization_id = $1`;
      const params: any[] = [organizationId];
      if (collection) {
        sql += ` and collection = $2`;
        params.push(collection);
      }
      sql += ` order by created_at desc`;
      const res = await this.db.query(sql, params);
      return res.rows.map((row: any) => ({
        ...row,
        metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata || {},
      }));
    }

    let query = this.db
      .from('knowledge_documents')
      .select('*')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false });

    if (collection) {
      query = query.eq('collection', collection);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to list knowledge documents: ${error.message}`);
    }

    return (data || []).map((row: any) => ({
      ...row,
      metadata: (row.metadata || {}) as Record<string, unknown>,
    }));
  }

  async getDocument(
    organizationId: string,
    id: string
  ): Promise<KnowledgeDocumentEntity | null> {
    if (typeof this.db.query === 'function' && typeof this.db.from !== 'function') {
      const res = await this.db.query(
        `select * from public.knowledge_documents where organization_id = $1 and id = $2`,
        [organizationId, id]
      );
      if (!res.rows.length) return null;
      const row = res.rows[0];
      return {
        ...row,
        metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata || {},
      };
    }

    const { data, error } = await this.db
      .from('knowledge_documents')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to get knowledge document: ${error.message}`);
    }
    if (!data) return null;

    return {
      ...data,
      metadata: (data.metadata || {}) as Record<string, unknown>,
    };
  }

  async updateDocument(
    organizationId: string,
    id: string,
    input: UpdateDocumentInput
  ): Promise<KnowledgeDocumentEntity> {
    if (typeof this.db.query === 'function' && typeof this.db.from !== 'function') {
      const sets: string[] = ['updated_at = now()'];
      const params: any[] = [organizationId, id];
      let idx = 3;
      if (input.collection !== undefined) {
        sets.push(`collection = $${idx++}`);
        params.push(input.collection);
      }
      if (input.title !== undefined) {
        sets.push(`title = $${idx++}`);
        params.push(input.title);
      }
      if (input.content !== undefined) {
        sets.push(`content = $${idx++}`);
        params.push(input.content);
        sets.push(`token_count = $${idx++}`);
        params.push(input.token_count ?? Math.max(1, Math.ceil(input.content.length / 4)));
        sets.push(`embedding = $${idx++}`);
        params.push(input.embedding ?? KnowledgeRepository.generateFallbackEmbedding(input.content));
      } else if (input.embedding !== undefined) {
        sets.push(`embedding = $${idx++}`);
        params.push(input.embedding);
      }
      if (input.metadata !== undefined) {
        sets.push(`metadata = $${idx++}`);
        params.push(JSON.stringify(input.metadata));
      }
      const res = await this.db.query(
        `update public.knowledge_documents set ${sets.join(', ')} where organization_id = $1 and id = $2 returning *`,
        params
      );
      const row = res.rows[0];
      return {
        ...row,
        metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata || {},
      };
    }

    const patch: Database['public']['Tables']['knowledge_documents']['Update'] = {
      updated_at: new Date().toISOString(),
    };
    if (input.collection !== undefined) patch.collection = input.collection;
    if (input.title !== undefined) patch.title = input.title;
    if (input.metadata !== undefined) patch.metadata = input.metadata as Json;

    if (input.content !== undefined) {
      patch.content = input.content;
      patch.token_count = input.token_count ?? Math.max(1, Math.ceil(input.content.length / 4));
      patch.embedding = input.embedding ?? KnowledgeRepository.generateFallbackEmbedding(input.content);
    } else if (input.embedding !== undefined) {
      patch.embedding = input.embedding;
    }

    const { data, error } = await this.db
      .from('knowledge_documents')
      .update(patch)
      .eq('organization_id', organizationId)
      .eq('id', id)
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to update knowledge document: ${error?.message || 'Unknown error'}`);
    }

    return {
      ...data,
      metadata: (data.metadata || {}) as Record<string, unknown>,
    };
  }

  async deleteDocument(organizationId: string, id: string): Promise<void> {
    if (typeof this.db.query === 'function' && typeof this.db.from !== 'function') {
      await this.db.query(
        `delete from public.knowledge_documents where organization_id = $1 and id = $2`,
        [organizationId, id]
      );
      return;
    }

    const { error } = await this.db
      .from('knowledge_documents')
      .delete()
      .eq('organization_id', organizationId)
      .eq('id', id);

    if (error) {
      throw new Error(`Failed to delete knowledge document: ${error.message}`);
    }
  }

  async search(
    organizationId: string,
    queryEmbedding: number[],
    options: SearchKnowledgeOptions = {}
  ): Promise<SearchResult[]> {
    const threshold = options.threshold ?? 0.5;
    const limit = options.limit ?? 5;

    // Try Postgres RPC or query first
    if (typeof this.db.query === 'function') {
      try {
        const res = await this.db.query(
          `select * from public.match_knowledge($1, $2, $3, $4, $5)`,
          [organizationId, queryEmbedding, options.collection || null, threshold, limit]
        );
        if (Array.isArray(res.rows) && res.rows.length > 0) {
          return res.rows.map((row: any) => ({
            id: row.id,
            collection: row.collection,
            title: row.title,
            content: row.content,
            metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata || {},
            similarity: Number(row.similarity),
          }));
        }
      } catch {
        // Fall back to in-memory cosine
      }
    } else if (typeof this.db.rpc === 'function') {
      try {
        const { data, error } = await this.db.rpc('match_knowledge', {
          p_org: organizationId,
          p_embedding: queryEmbedding,
          p_collection: options.collection || null,
          p_threshold: threshold,
          p_limit: limit,
        });

        if (!error && Array.isArray(data) && data.length > 0) {
          return data.map((row: any) => ({
            id: row.id,
            collection: row.collection,
            title: row.title,
            content: row.content,
            metadata: (row.metadata || {}) as Record<string, unknown>,
            similarity: Number(row.similarity),
          }));
        }
      } catch {
        // Fall back
      }
    }

    // In-memory fallback
    const docs = await this.listDocuments(organizationId, options.collection);
    const scored: SearchResult[] = [];

    for (const doc of docs) {
      if (!doc.embedding) continue;
      const sim = KnowledgeRepository.cosineSimilarity(doc.embedding, queryEmbedding);
      if (sim >= threshold) {
        scored.push({
          id: doc.id,
          collection: doc.collection,
          title: doc.title,
          content: doc.content,
          metadata: doc.metadata,
          similarity: sim,
        });
      }
    }

    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, limit);
  }

  async listCollections(organizationId: string): Promise<Array<{ collection: string; count: number }>> {
    const docs = await this.listDocuments(organizationId);
    const counts = new Map<string, number>();

    for (const doc of docs) {
      const coll = doc.collection || 'default';
      counts.set(coll, (counts.get(coll) || 0) + 1);
    }

    return Array.from(counts.entries()).map(([collection, count]) => ({
      collection,
      count,
    }));
  }
}
