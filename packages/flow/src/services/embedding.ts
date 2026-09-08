export interface EmbeddingOptions {
  provider?: 'local' | 'openai' | 'gemini';
  apiKey?: string;
  dimension?: number;
}

export class EmbeddingService {
  public static readonly DEFAULT_DIMENSION = 64;

  /**
   * Generates an embedding vector for the provided text.
   * If an API key is provided and provider is openai, it calls OpenAI's embeddings API.
   * Otherwise, it generates a deterministic unit-normalized hash-based vector for local/test execution.
   */
  public static async generateEmbedding(
    text: string,
    options: EmbeddingOptions = {}
  ): Promise<number[]> {
    const provider = options.provider || 'local';
    const dim = options.dimension || EmbeddingService.DEFAULT_DIMENSION;

    if (provider === 'openai' && options.apiKey) {
      try {
        const response = await fetch('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${options.apiKey}`,
          },
          body: JSON.stringify({
            input: text,
            model: 'text-embedding-3-small',
            dimensions: dim,
          }),
        });
        if (response.ok) {
          const json = await response.json();
          if (json.data?.[0]?.embedding) {
            return json.data[0].embedding;
          }
        }
      } catch {
        // Fall back to local hash embedding on network failure
      }
    }

    return EmbeddingService.generateLocalEmbedding(text, dim);
  }

  /**
   * Deterministic unit-normalized token-hash embedding.
   * Enables fast, offline semantic test suites without external API keys.
   */
  public static generateLocalEmbedding(text: string, dimension = EmbeddingService.DEFAULT_DIMENSION): number[] {
    const vector = new Array<number>(dimension).fill(0);
    if (!text || text.trim().length === 0) {
      return vector;
    }

    // Tokenize words and character 3-grams
    const normalized = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const tokens = normalized.match(/[\p{L}\p{N}]+/gu) || [];

    for (const token of tokens) {
      // Word hash
      const wordHash = EmbeddingService.fnv1a(token);
      const index = Math.abs(wordHash) % dimension;
      vector[index] = (vector[index] ?? 0) + 1.0;

      // Character n-grams for typo resilience
      for (let i = 0; i <= token.length - 3; i++) {
        const gram = token.substring(i, i + 3);
        const gramHash = EmbeddingService.fnv1a(gram);
        const gramIndex = Math.abs(gramHash) % dimension;
        vector[gramIndex] = (vector[gramIndex] ?? 0) + 0.3;
      }
    }

    // L2 Normalize
    let sumSquares = 0;
    for (let i = 0; i < dimension; i++) {
      const v = vector[i] ?? 0;
      sumSquares += v * v;
    }

    if (sumSquares === 0) return vector;

    const norm = Math.sqrt(sumSquares);
    for (let i = 0; i < dimension; i++) {
      vector[i] = Number(((vector[i] ?? 0) / norm).toFixed(6));
    }

    return vector;
  }

  /**
   * Cosine similarity between two vectors in JS/TS.
   */
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

  /**
   * Fast token count estimator (~4 characters per token).
   */
  public static estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.max(1, Math.ceil(text.length / 4));
  }

  private static fnv1a(str: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return hash;
  }
}
