import { selectReplyFallback } from './reply-fallback';
import { beforeAll, describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { loadAiConfig } from './config';
import { buildSystemPrompt } from './defaults';
import { generateReply } from './generate';
import { retrieveKnowledge } from './knowledge';
import { knowledgeQuery } from './query';
import { listProductsForPrompt } from './media-library';
import { productContext } from './product-context';
import { assessSalesInput, verifySalesOutput } from './typesafe/sales';
import { formatBusinessHours } from './business-hours';
import { turnBrief } from './conversation-behavior';
import type { AiConfig, ChatMessage } from './types';
import type { ProductPromptItem } from './media-library';
interface Fixture {
  id: string;
  split: 'development' | 'holdout';
  messages: ChatMessage[];
  expected: 'continue' | 'transfer';
  criterion: string;
}
const directory = process.env.AI_HISTORY_EVAL_DIR;
const fixtures: Fixture[] = directory
  ? JSON.parse(fs.readFileSync(path.join(directory, 'fixtures.json'), 'utf8'))
  : [];
const selected = fixtures.filter(
  (f) =>
    (!process.env.AI_HISTORY_SPLIT ||
      f.split === process.env.AI_HISTORY_SPLIT) &&
    (!process.env.AI_HISTORY_CASES ||
      process.env.AI_HISTORY_CASES.split(',').includes(f.id))
);
const results: object[] = [];
let generationCalls = 0;
const maxGenerations = Math.max(
  1,
  Math.min(300, Number(process.env.AI_HISTORY_MAX_GENERATIONS) || 24)
);
describe.runIf(process.env.AI_HISTORY_EVAL === 'true')(
  'Read-only historical behavior replay',
  () => {
    let config: AiConfig;
    let products: ProductPromptItem[];
    let account: Record<string, unknown>;
    let db: ReturnType<typeof createClient>;
    const accountId = process.env.AI_HISTORY_ACCOUNT_ID;
    beforeAll(async () => {
      if (!directory || !accountId)
        throw Error('Private fixture directory and account ID are required.');
      db = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { persistSession: false } }
      );
      const loaded = await loadAiConfig(db, accountId, {
        requireActive: false,
      });
      if (!loaded) throw Error('AI config unavailable');
      const override = JSON.parse(
        fs.readFileSync(path.join(directory, 'configuration.json'), 'utf8')
      );
      config = {
        ...loaded,
        ...override,
        behaviorV2Enabled: true,
        ...(process.env.AI_HISTORY_SNIPPET_ONLY === 'true'
          ? { embeddingsApiKey: null }
          : {}),
      };
      products = await listProductsForPrompt(db, accountId);
      const { data, error } = await db
        .from('accounts')
        .select('business_hours,timezone,default_currency,social_links')
        .eq('id', accountId)
        .single();
      if (error) throw Error('Account facts unavailable');
      account = data;
    }, 30000);
    it.concurrent.each(selected)(
      '$id ($split)',
      async (f) => {
        const started = Date.now();
        const messages = f.messages.slice(-40);
        const ctx = { accountId: accountId!, workflow: 'playground' as const }; // Deliberately no db: no audit/customer writes.
        const input = await assessSalesInput(ctx, messages, undefined, true);
        const knowledge = await retrieveKnowledge(
          db,
          accountId!,
          config,
          knowledgeQuery(messages, true)
        );
        const candidates = productContext(products, knowledge, messages);
        const systemPrompt =
          buildSystemPrompt({
            userPrompt: config.systemPrompt,
            companyFacts: config.companyFacts,
            behaviorV2Enabled: true,
            mode: 'auto_reply',
            knowledge,
            media: candidates,
            businessHours: formatBusinessHours(
              account.business_hours as Parameters<
                typeof formatBusinessHours
              >[0]
            ),
            socialLinks: account.social_links as Record<string, string>,
            timezone: account.timezone as string,
          }) +
          '\n' +
          turnBrief(messages) +
          '\n' +
          input.guidance;
        const salesEvidence = {
          intent: input.intent,
          messages,
          knowledge,
          products: candidates,
          collectFields: [],
          businessContext: config.companyFacts ?? null,
          behaviorV2Enabled: true,
          businessHours: formatBusinessHours(
            account.business_hours as Parameters<typeof formatBusinessHours>[0]
          ),
          socialLinks: account.social_links as Record<string, string>,
          currency: account.default_currency as string,
          emotion: input.emotion,
        };
        const drafts: object[] = [];
        const generate = async (extra = '') => {
          try {
            if (++generationCalls > maxGenerations)
              throw Object.assign(
                new Error('Evaluation generation budget reached'),
                { code: 'evaluation_budget' }
              );
            const r = await generateReply({
              config,
              systemPrompt: systemPrompt + extra,
              messages,
            });
            drafts.push({
              text: r.text,
              handoff: r.handoff,
              mediaId: r.mediaId,
              mediaIds: r.mediaIds,
            });
            return r;
          } catch (error) {
            const e = error as {
              name?: string;
              code?: string;
              status?: number;
            };
            drafts.push({
              generationFailed: true,
              code: e.code ?? e.name,
              status: e.status,
            });
            throw error;
          }
        };
        const initial =
          process.env.AI_HISTORY_SNIPPET_ONLY === 'true'
            ? await selectReplyFallback(salesEvidence)
            : await generate();
        if (!initial) throw Error('No useful approved snippet selected');
        const result = input.handoff
          ? { ...initial, text: '', handoff: true }
          : await verifySalesOutput(
              ctx,
              {
                intent: input.intent,
                messages,
                knowledge,
                products: candidates,
                collectFields: [],
                businessContext: config.companyFacts ?? null,
                behaviorV2Enabled: true,
                businessHours: formatBusinessHours(
                  account.business_hours as Parameters<
                    typeof formatBusinessHours
                  >[0]
                ),
                socialLinks: account.social_links as Record<string, string>,
                currency: account.default_currency as string,
                emotion: input.emotion,
              },
              initial,
              process.env.AI_HISTORY_SNIPPET_ONLY === 'true'
                ? undefined
                : (g) => generate('\nReply recovery:\n' + g)
            );
        const passed =
          f.expected === 'transfer'
            ? result.handoff
            : !result.handoff && !result.reviewRequired && !!result.text;
        results.push({
          id: f.id,
          split: f.split,
          expected: f.expected,
          criterion: f.criterion,
          passed,
          durationMs: Date.now() - started,
          result: {
            text: result.text,
            handoff: result.handoff,
            reviewRequired: result.reviewRequired,
            decision: result.routingDecision,
          },
          drafts,
        });
        fs.writeFileSync(
          path.join(
            directory!,
            'results-' +
              (process.env.AI_HISTORY_RUN_LABEL?.replace(
                /[^a-z0-9_-]/gi,
                ''
              ).slice(0, 40) ||
                process.env.AI_HISTORY_SPLIT ||
                'all') +
              '.json'
          ),
          JSON.stringify(results, null, 2),
          { mode: 0o600 }
        );
        expect(
          passed,
          JSON.stringify({
            id: f.id,
            decision: result.routingDecision,
            review: result.reviewRequired,
          })
        ).toBe(true);
      },
      120000
    );
  }
);
