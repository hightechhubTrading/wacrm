import type { Questions } from '@typesafe-ai/sdk';
import { askJev } from './client';
import type { SalesEvidence } from './sales';
import type { GenerateResult } from '../types';
import { PRODUCT_EDUCATION_REFERENCE } from '../product-education';
import { customerStatements } from './policy';

/** Dialogue quality must not be judged against an unrelated catalog/instruction dump.
 * Fact/action checks retain full approved facts, limitations and parsed-document evidence. */
export async function judgeSalesOutput(
  evidence: SalesEvidence,
  proposal: GenerateResult,
  questions: Questions
) {
  const statements = [
    ...customerStatements(evidence.messages),
    ...(evidence.memory?.statements.map((s) => s.text) ?? []),
  ];
  const full = {
    evidence: evidence.behaviorV2Enabled
      ? {
          ...evidence,
          knowledge: evidence.knowledge.filter(
            (k) => !k.includes('[knowledge_type=customer_guide]')
          ),
          products: evidence.products.map((p) => ({
            id: p.id,
            name: p.name,
            description: p.description,
            priceMin: p.priceMin,
            priceMax: p.priceMax,
            priceUnit: p.priceUnit,
            priceNotes: p.priceNotes,
            files: p.files,
            ...(p.catalog
              ? {
                  catalog: {
                    kind: p.catalog.kind,
                    aliases: p.catalog.aliases,
                    specifications: p.catalog.specifications,
                    limitations: p.catalog.limitations,
                    status: p.catalog.status,
                  },
                }
              : {}),
          })),
        }
      : evidence,
    proposal,
    generalProductKnowledge: {
      ...PRODUCT_EDUCATION_REFERENCE,
      guideExcerpts: evidence.behaviorV2Enabled
        ? evidence.knowledge.filter((k) =>
            k.includes('[knowledge_type=customer_guide]')
          )
        : [],
    },
    customerStatements: statements,
  };
  if (!evidence.behaviorV2Enabled) return askJev(full, questions);
  const dialogueIds = new Set([
    'responsive',
    'wrong_comparison',
    'answered_scope',
    'behavior',
    'requests',
    'empathy',
    'handoff_needed',
  ]);
  const provenanceIds = new Set([
    'scope',
    'documents',
    'completion',
    ...Object.keys(questions).filter((id) => id.startsWith('field_')),
  ]);
  const facts = Object.fromEntries(
    Object.entries(questions).filter(
      ([id]) => !dialogueIds.has(id) && !provenanceIds.has(id)
    )
  );
  const dialogue = Object.fromEntries(
    Object.entries(questions).filter(([id]) => dialogueIds.has(id))
  );
  const latestCustomerIndex = evidence.messages.findLastIndex(
    (m) => m.role === 'user'
  );
  const conversational = {
    evidence: {
      currentCustomerRequest:
        evidence.messages[latestCustomerIndex]?.content ?? null,
      precedingAssistantTurn:
        evidence.messages
          .slice(0, latestCustomerIndex)
          .findLast((m) => m.role === 'assistant')?.content ?? null,
      messages: evidence.messages,
      businessContext: evidence.businessContext,
      businessHours: evidence.businessHours,
      socialLinks: evidence.socialLinks,
      agentPhone: evidence.agentPhone,
      currency: evidence.currency,
      emotion: evidence.emotion,
      memory: {
        statements: evidence.memory?.statements ?? [],
        actions: evidence.memory?.actions ?? [],
      },
      products: evidence.products.map((p) => ({
        id: p.id,
        name: p.name,
        priceMin: p.priceMin,
        priceMax: p.priceMax,
        priceUnit: p.priceUnit,
        files: p.files.map((f) => ({
          id: f.id,
          label: f.label,
          mediaKind: f.mediaKind,
        })),
      })),
    },
    proposal,
    customerStatements: statements,
  };
  const provenance = Object.fromEntries(
    Object.entries(questions).filter(([id]) => provenanceIds.has(id))
  );
  const provenanceState = {
    proposal,
    customerStatements: statements,
    evidence: {
      messages: evidence.messages,
      memory: evidence.memory,
      collectFields: evidence.collectFields,
      products: evidence.products.map((p) => ({
        id: p.id,
        name: p.name,
        priceNotes: p.priceNotes,
        files: p.files,
      })),
      businessContext: evidence.businessContext,
    },
  };
  const [a, b, c] = await Promise.all([
    askJev(full, facts),
    askJev(conversational, dialogue),
    askJev(provenanceState, provenance),
  ]);
  return {
    model: a.model,
    answers: {
      ...Object.fromEntries(
        Object.keys(facts).map((id) => [id, a.answers[id]])
      ),
      ...Object.fromEntries(
        Object.keys(dialogue).map((id) => [id, b.answers[id]])
      ),
      ...Object.fromEntries(
        Object.keys(provenance).map((id) => [id, c.answers[id]])
      ),
    },
    usage: {
      input_tokens:
        a.usage.input_tokens + b.usage.input_tokens + c.usage.input_tokens,
      output_tokens:
        a.usage.output_tokens + b.usage.output_tokens + c.usage.output_tokens,
    },
  };
}
