/**
 * Builds bounded, provider-neutral context for AI chat responses.
 *
 * Responsibilities:
 * - Load the unlocked idea and its relevant generated outputs.
 * - Load recent completed conversation messages.
 * - Preserve the newest conversational turns when the context budget is hit.
 * - Resolve short follow-up requests against the latest assistant answer.
 * - Build a natural, expert software-engineering assistant instruction.
 * - Persist CHAT_RESPONSE prompt history without delaying the response.
 *
 * @author Eman
 */

import { Injectable, NotFoundException } from '@nestjs/common';
import {
  ChatMessageStatus,
  ChatSender,
  GeneratedOutputStatus,
  Prisma,
  PromptType,
} from '@prisma/client';
import { createHash } from 'crypto';

import { PrismaService } from '../../prisma/prisma.service';
import { PromptHistoryService } from '../../prompts/services/prompt-history.service';
import {
  AI_CHAT_MAX_CONTEXT_MESSAGES,
  AI_CHAT_MAX_HISTORY_CONTEXT_CHARACTERS,
  AI_CHAT_MAX_IDEA_CONTEXT_CHARACTERS,
} from '../constants/ai-chat.constants';
import type { AiChatContext } from '../types/chat-context.type';

/**
 * Approximation used only for routing and prompt-history metadata.
 */
const APPROXIMATE_CHARACTERS_PER_TOKEN = 4;

type ChatHistoryItem = {
  readonly sender: ChatSender;
  readonly message: string;
};

/**
 * Detects the dominant writing system of the latest user turn.
 *
 * This is intentionally deterministic so language detection never adds an
 * additional AI request before the actual chat response.
 */
function detectLatestMessageLanguage(
  message: string,
): 'Arabic' | 'English' | null {
  const arabicCharacters = (message.match(/[\u0600-\u06FF]/g) ?? []).length;
  const latinCharacters = (message.match(/[A-Za-z]/g) ?? []).length;

  if (arabicCharacters === 0 && latinCharacters === 0) {
    return null;
  }

  return arabicCharacters > latinCharacters ? 'Arabic' : 'English';
}

/**
 * Stable source template used to identify chat-prompt versions.
 */
const AI_CHAT_PROMPT_TEMPLATE = [
  'SYSTEM_INSTRUCTION',
  '<idea_context>{{ideaContext}}</idea_context>',
  '<recent_conversation>{{recentConversation}}</recent_conversation>',
  '<turn_guidance>{{turnGuidance}}</turn_guidance>',
  '<latest_user_message>{{latestUserMessage}}</latest_user_message>',
].join('\n');

/**
 * System instruction applied to every idea-chat operation.
 *
 * The previous prompt over-constrained the model with "use only supplied
 * context". That made answers sound like a rigid report generator and caused
 * follow-up turns such as "Explain more" to restart the same architecture.
 *
 * Project context is now authoritative for project-specific facts while the
 * model may use normal software-engineering knowledge to reason, explain,
 * compare, and design.
 */
const AI_CHAT_SYSTEM_INSTRUCTION = [
  'You are Voxidence, an expert software-engineering partner embedded inside one project workspace.',
  'Act like a strong conversational assistant, not a rigid report template or documentation generator.',
  'Do not introduce yourself with phrases such as "As Voxidence" unless the user explicitly asks who you are.',
  'Treat the conversation as continuous. Resolve pronouns, short follow-ups, and requests such as "Explain more", "continue", "why", "اشرح أكثر", or "كمل" from the most recent relevant turns.',
  'When the latest message is a follow-up, continue or deepen the previous answer instead of restarting it, repeating the project title, or re-listing sections already explained.',
  'Answer the latest request first. Do not restate the user message before answering.',

  // Grounding rules.
  'Treat only the <confirmed_project_facts> section as authoritative evidence for established project-specific facts.',
  'Treat <generated_project_material> as supporting material that may contain proposals, inferred details, or generated recommendations. Never silently promote generated material to a confirmed implementation decision.',
  'Recent ASSISTANT messages are conversational context, not evidence. A claim does not become a project fact merely because an earlier assistant response stated it.',
  'When a detail is not confirmed by <confirmed_project_facts>, do not describe it with definitive language such as "the system uses", "the project has", "it monitors", "it stores", or "it exposes".',
  'If you introduce a useful but unconfirmed implementation detail, clearly frame it as a recommendation or possibility using language such as "could", "a practical option is", "one design would be", or "if you choose to implement it".',
  'Never invent named modules, API routes, vendors, libraries, database tables, browser-extension behavior, DOM inspection, network interception, pilot durations, regional rules, or authentication mechanisms unless they are present in confirmed project facts or the user explicitly asks you to propose them.',
  'Do not infer one technology from another. PostgreSQL does not imply TypeORM, NestJS does not imply a particular ORM or endpoint structure, and OAuth does not imply Auth0 unless the confirmed context says so.',
  'Never describe a supported authentication alternative as a bypass. Prefer documented alternative, supported login path, recovery path, or compatible authentication method.',

  // General reasoning quality.
  'You MAY use general software-engineering knowledge to explain concepts, evaluate tradeoffs, recommend architecture, compare alternatives, or propose implementation approaches.',
  'Keep a clear distinction between what the project already establishes and what you are recommending.',
  'If a project-specific fact is missing and the answer genuinely needs it, either ask one focused question or state one concise labeled assumption. Do not fabricate the missing detail.',
  'Prefer concrete reasoning, interactions, tradeoffs, data flow, failure modes, implementation decisions, and examples over generic textbook definitions.',
  'For architecture questions, explain how components communicate and why the boundaries exist; do not merely define each technology.',
  'For coding questions, give practical implementation guidance and code-level decisions when useful.',

  // Database-design quality.
  'When the user asks for a database design, schema, tables, entities, columns, fields, relationships, ERD, or storage model, provide a practical implementation-level proposal rather than only three high-level example tables.',
  'For database-design answers, first identify the minimum useful domain entities from the confirmed idea requirements, then add supporting/reference entities only when they solve a real persistence or normalization need.',
  'For each proposed table, explain its purpose and include the important columns with sensible PostgreSQL data types, primary keys, foreign keys, nullability when relevant, defaults when useful, and notable UNIQUE or CHECK constraints.',
  'Explain the relationships using explicit cardinality such as one-to-many, many-to-one, one-to-one, or many-to-many, and state where the foreign key lives.',
  'Include the most useful indexes for realistic query patterns, especially foreign keys, status/time filters, lookup keys, and frequently queried combinations. Do not suggest indexes blindly.',
  'Prefer normalized relational columns for stable queryable facts. Use JSONB only for genuinely variable metadata or provider-specific payloads, and explain why JSONB is appropriate when recommending it.',
  'Separate reference knowledge, such as target applications, identity providers, regional constraints, and recovery paths, from user diagnostic events when that separation makes the design clearer and less repetitive.',
  'For privacy-sensitive ideas, identify fields that should deliberately NOT be stored, such as passwords, private credentials, session tokens, cookies, raw authorization headers, or unnecessary identifiers.',
  'If outcome or feedback tracking is useful, model it separately from the diagnostic event when multiple recommendations or follow-up attempts may occur.',
  'Do not force a one-to-one relationship unless the domain truly guarantees one record. Prefer a one-to-many relationship when a diagnostic session may produce multiple findings, recommendations, or feedback attempts.',
  'When the user asks specifically "what are the tables and what is in each table", give a compact but complete table-by-table schema instead of repeating only prose from the previous answer.',
  'If an ORM was not confirmed by project context, describe the schema in PostgreSQL terms and optionally say that the chosen NestJS data layer can map to it; do not assume TypeORM, Prisma, Sequelize, or another ORM.',

  // Response length without making chat slow.
  'Do not force every answer into a short fixed word range.',
  'For simple questions, be concise and direct.',
  'For ordinary technical questions, provide enough detail to fully answer the request without unnecessary padding.',
  'For database design, system architecture, detailed analysis, or an explicit request to explain more, a fuller answer is expected. Roughly 600-1000 words is acceptable when that depth is useful and the current response budget allows it.',
  'Do not stop a useful technical explanation early merely to satisfy a preferred word range.',
  'Do not create extra provider calls or multi-response continuations just to make an answer longer; finish within the current single streamed response budget.',

  // Style and language.
  'Use natural conversational prose. Use headings, bullets, or a compact schema table only when they genuinely improve readability.',
  'For a short follow-up such as "Explain more", prefer a natural continuation of the previous explanation rather than opening a new formal report.',
  'Avoid repetitive conclusions, repeated disclaimers, repeated safety statements, and filler.',
  'Do not append the project title or idea title alone as a decorative footer at the end of the answer.',
  'Do not intentionally stop in the middle of a sentence, list, section, or explanation.',
  'Reply in the language of the latest user message unless the user explicitly requests another language.',
  'When replying in Arabic, write fluent natural Arabic, proofread spelling, and use precise Arabic technical terminology. Keep English technical names only when they are standard or clearer, and avoid awkward literal translation.',
].join(' ');

/**
 * Service responsible for rendering bounded AI chat prompts.
 */
@Injectable()
export class AiChatContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly promptHistoryService: PromptHistoryService,
  ) {}

  /**
   * Builds and records one complete AI chat context.
   *
   * @param userId Authenticated user identifier.
   * @param sessionId Chat-session identifier.
   * @param latestUserMessageId Persisted latest user-message identifier.
   * @param latestUserMessage Latest normalized user message.
   */
  async buildContext(
    userId: string,
    sessionId: string,
    latestUserMessageId: string,
    latestUserMessage: string,
  ): Promise<AiChatContext> {
    const [session, history] = await Promise.all([
      this.prisma.chatSession.findFirst({
        where: {
          id: sessionId,
          userId,
          deletedAt: null,
          idea: {
            deletedAt: null,
          },
        },
        select: {
          id: true,
          ideaId: true,
          idea: {
            select: {
              title: true,
              selectedRegion: true,
              limitedAbstract: true,
              partialAbstract: true,
              fullAbstract: true,
              problemStatement: true,
              objectives: true,
              targetUsers: true,
              domain: {
                select: {
                  name: true,
                },
              },
              businessModels: {
                orderBy: [
                  { isCurrent: 'desc' },
                  { version: 'desc' },
                ],
                take: 1,
                select: {
                  content: true,
                  version: true,
                  businessModelTemplate: {
                    select: {
                      name: true,
                      key: true,
                    },
                  },
                },
              },
              generatedOutputs: {
                where: {
                  status: GeneratedOutputStatus.COMPLETED,
                },
                orderBy: [
                  { sequence: 'asc' },
                  { outputKey: 'asc' },
                ],
                take: 2,
                select: {
                  outputKey: true,
                  title: true,
                  content: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.chatMessage.findMany({
        where: {
          sessionId,
          id: {
            not: latestUserMessageId,
          },
          deletedAt: null,
          status: ChatMessageStatus.COMPLETED,
        },
        orderBy: [
          { createdAt: 'desc' },
          { id: 'desc' },
        ],
        take: AI_CHAT_MAX_CONTEXT_MESSAGES,
        select: {
          sender: true,
          message: true,
        },
      }),
    ]);

    if (!session) {
      throw new NotFoundException('AI chat session was not found.');
    }

    const ideaContext = this.truncateHead(
      this.renderIdeaContext(session.idea),
      AI_CHAT_MAX_IDEA_CONTEXT_CHARACTERS,
    );

    const recentConversation = this.renderRecentConversation(history);

    const detectedLanguage = detectLatestMessageLanguage(latestUserMessage);

    const turnLanguageInstruction = detectedLanguage
      ? `The latest user message is primarily ${detectedLanguage}. Answer this turn entirely in ${detectedLanguage} unless the user explicitly asks for a different language. Do not choose the reply language from older conversation history.`
      : 'Match the language of the latest user message for this turn.';

    const turnGuidance = this.buildTurnGuidance(
      latestUserMessage,
      history,
    );

    const systemInstruction = [
      AI_CHAT_SYSTEM_INSTRUCTION,
      turnLanguageInstruction,
      turnGuidance,
    ].join(' ');

    const userPrompt = [
      '<idea_context>',
      ideaContext,
      '</idea_context>',
      '',
      '<recent_conversation>',
      recentConversation || 'No previous completed messages.',
      '</recent_conversation>',
      '',
      '<turn_guidance>',
      turnGuidance,
      '</turn_guidance>',
      '',
      '<latest_user_message>',
      latestUserMessage.trim(),
      '</latest_user_message>',
    ].join('\n');

    const estimatedInputTokens = Math.ceil(
      `${systemInstruction}\n${userPrompt}`.length /
        APPROXIMATE_CHARACTERS_PER_TOKEN,
    );

    /*
     * Prompt-history persistence is observability work and must not make the
     * user wait before the provider request starts.
     */
    void this.promptHistoryService
      .savePrompt({
        userId,
        ideaId: session.ideaId,
        promptType: PromptType.CHAT_RESPONSE,
        promptText: `${systemInstruction}\n\n${userPrompt}`,
        templateHash: createHash('sha256')
          .update(AI_CHAT_PROMPT_TEMPLATE)
          .digest('hex'),
        estimatedInputTokens,
      })
      .catch(() => undefined);

    return {
      userId,
      sessionId,
      ideaId: session.ideaId,
      systemInstruction,
      userPrompt,
      estimatedInputTokens,
    };
  }

  /**
   * Produces per-turn conversational guidance.
   *
   * Terse follow-up messages are intentionally recognized without another
   * model call. This fixes the common behavior where "Explain more" caused the
   * assistant to regenerate the original answer from the beginning.
   */
  private buildTurnGuidance(
    latestUserMessage: string,
    history: readonly ChatHistoryItem[],
  ): string {
    const normalized = latestUserMessage
      .trim()
      .toLocaleLowerCase()
      .replace(/\s+/g, ' ');

    const hasAssistantHistory = history.some(
      (message) => message.sender === ChatSender.AI,
    );

    const followUpPatterns = [
      /^explain more[.!?]*$/,
      /^more[.!?]*$/,
      /^more detail(?:s)?[.!?]*$/,
      /^go deeper[.!?]*$/,
      /^continue[.!?]*$/,
      /^keep going[.!?]*$/,
      /^elaborate[.!?]*$/,
      /^why[.!?]*$/,
      /^how so[.!?]*$/,
      /^اشرح أكثر[.!؟]*$/,
      /^اشرح اكتر+[.!؟]*$/,
      /^وضح أكثر[.!؟]*$/,
      /^وضح اكتر+[.!؟]*$/,
      /^احكي أكثر[.!؟]*$/,
      /^احكي اكتر+[.!؟]*$/,
      /^كمل+[.!؟]*$/,
      /^كمّل+[.!؟]*$/,
      /^زيد[.!؟]*$/,
      /^فصل أكثر[.!؟]*$/,
      /^فصّل أكثر[.!؟]*$/,
      /^تفصيل أكثر[.!؟]*$/,
      /^ليش+[.!؟]*$/,
    ];

    const databaseTerms = [
      'database',
      'database design',
      'schema',
      'table',
      'tables',
      'column',
      'columns',
      'field',
      'fields',
      'entity',
      'entities',
      'relationship',
      'relationships',
      'erd',
      'postgresql',
      'قاعدة البيانات',
      'داتا بيس',
      'الداتا بيس',
      'جدول',
      'جداول',
      'حقول',
      'اعمدة',
      'أعمدة',
      'علاقات',
      'العلاقات',
      'كيانات',
      'الكيانات',
    ];

    const databaseDetailTerms = [
      'what is in each table',
      'what are the fields',
      'fields in each table',
      'columns in each table',
      'main entities and relationships',
      'table and the',
      'data type',
      'primary key',
      'foreign key',
      'index',
      'indexes',
      'constraint',
      'constraints',
      'شو بكل جدول',
      'شو داخل كل جدول',
      'الحقول بكل جدول',
      'اعمدة كل جدول',
      'أعمدة كل جدول',
      'نوع البيانات',
      'برايمري كي',
      'فورين كي',
      'العلاقات بين الجداول',
    ];

    const isDatabaseRequest = databaseTerms.some(
      (term) => normalized.includes(term),
    );

    const isDatabaseDetailRequest =
      isDatabaseRequest &&
      (
        databaseDetailTerms.some(
          (term) => normalized.includes(term),
        ) ||
        normalized.includes('including the main entities') ||
        normalized.includes('practical database design')
      );

    const isExplicitFollowUp =
      hasAssistantHistory &&
      (
        followUpPatterns.some(
          (pattern) => pattern.test(normalized),
        ) ||
        (
          normalized.length <= 120 &&
          [
            'explain that',
            'explain this',
            'tell me more',
            'what about',
            'and then',
            'اشرح هاد',
            'اشرح هاي',
            'وضح هاد',
            'وضح هاي',
          ].some(
            (phrase) => normalized.includes(phrase),
          )
        )
      );

    if (isDatabaseDetailRequest) {
      return [
        'The user is asking for an implementation-level database schema, not only a conceptual entity list.',
        'Propose a practical PostgreSQL design grounded in the confirmed project facts.',
        'For every core table, include purpose, important columns, PostgreSQL types, PK/FK placement, nullability or defaults where useful, constraints, and the most relevant indexes.',
        'Then explain relationship cardinalities and why the split between tables is useful.',
        'Use JSONB only for variable metadata, not as a substitute for normal relational design.',
        'Clearly label any new table or implementation choice as proposed when it is not already confirmed.',
        'Do not assume TypeORM or any other ORM unless the confirmed project facts name it.',
        'Keep the answer detailed but focused enough to fit in one streamed response.',
      ].join(' ');
    }

    if (isDatabaseRequest) {
      return [
        'The user is asking about database architecture.',
        'Give a practical relational design with enough implementation detail to be useful, including core entities, key fields, relationships, and important storage/privacy decisions.',
        'Do not reduce the answer to only a few generic example tables.',
        'Clearly distinguish confirmed requirements from proposed schema choices.',
      ].join(' ');
    }

    if (isExplicitFollowUp) {
      return [
        'This turn is a continuation of the most recent assistant answer.',
        'Continue from the useful point the previous answer reached and add substantially deeper, new technical value.',
        'Do not repeat the introduction, project description, component list, or already-explained points unless a short reference is necessary for the new explanation.',
        'Before carrying forward a project-specific claim from the previous assistant answer, verify that it is supported by <confirmed_project_facts>. If it is not supported, reframe it as a proposal instead of repeating it as fact.',
      ].join(' ');
    }

    return [
      'Interpret the latest user message in the context of the recent conversation.',
      'Answer only what the user is asking now, while preserving relevant confirmed decisions from earlier turns.',
    ].join(' ');
  }

  /**
   * Preserves the newest whole conversation turns within the history budget.
   *
   * The old implementation joined messages chronologically and then sliced
   * from the beginning, which could discard the most recent assistant answer.
   * That made follow-ups appear context-free and repetitive.
   */
  private renderRecentConversation(
    history: readonly ChatHistoryItem[],
  ): string {
    if (history.length === 0) {
      return '';
    }

    const chronological = [...history].reverse();

    const rendered = chronological.map((message) => {
      const role =
        message.sender === ChatSender.USER ? 'USER' : 'ASSISTANT';

      return `${role}: ${message.message.trim()}`;
    });

    const selected: string[] = [];
    let usedCharacters = 0;

    for (let index = rendered.length - 1; index >= 0; index -= 1) {
      const item = rendered[index]?.trim();

      if (!item) continue;

      const separatorCost = selected.length > 0 ? 2 : 0;
      const projected =
        usedCharacters +
        separatorCost +
        item.length;

      if (
        projected <= AI_CHAT_MAX_HISTORY_CONTEXT_CHARACTERS
      ) {
        selected.unshift(item);
        usedCharacters = projected;
        continue;
      }

      if (selected.length === 0) {
        /*
         * A single previous assistant answer may itself exceed the complete
         * history budget. Preserve both its opening (structure/topic) and its
         * ending (the exact point the conversation reached) instead of keeping
         * only one side.
         */
        const marker =
          '\n...[middle of the previous turn omitted]...\n';

        const available = Math.max(
          0,
          AI_CHAT_MAX_HISTORY_CONTEXT_CHARACTERS -
            marker.length,
        );

        const headLength =
          Math.floor(available * 0.38);

        const tailLength =
          Math.max(
            0,
            available - headLength,
          );

        selected.unshift(
          [
            item.slice(0, headLength),
            marker,
            item.slice(-tailLength),
          ].join(''),
        );
      }

      break;
    }

    return selected.join('\n\n');
  }

  /**
   * Renders idea and selected generated-output fields into readable context.
   */
  private renderIdeaContext(idea: {
    title: string;
    selectedRegion: string | null;
    limitedAbstract: string | null;
    partialAbstract: string | null;
    fullAbstract: string | null;
    problemStatement: string | null;
    objectives: Prisma.JsonValue | null;
    targetUsers: Prisma.JsonValue | null;
    domain: {
      name: string;
    };
    businessModels: Array<{
      content: Prisma.JsonValue;
      version: number;
      businessModelTemplate: {
        name: string;
        key: string;
      };
    }>;
    generatedOutputs: Array<{
      outputKey: string;
      title: string;
      content: string | null;
    }>;
  }): string {
    const confirmedFacts: string[] = [
      `Title: ${idea.title}`,
      `Domain: ${idea.domain.name}`,
    ];

    this.pushTextSection(
      confirmedFacts,
      'Region',
      idea.selectedRegion,
    );

    this.pushTextSection(
      confirmedFacts,
      'Abstract',
      idea.fullAbstract ??
        idea.partialAbstract ??
        idea.limitedAbstract,
    );

    this.pushTextSection(
      confirmedFacts,
      'Problem statement',
      idea.problemStatement,
    );

    this.pushJsonSection(
      confirmedFacts,
      'Objectives',
      idea.objectives,
    );

    this.pushJsonSection(
      confirmedFacts,
      'Target users',
      idea.targetUsers,
    );

    const generatedMaterial: string[] = [];

    if (idea.businessModels.length > 0) {
      const currentBusinessModel = idea.businessModels[0];

      generatedMaterial.push(
        `Business model (${currentBusinessModel.businessModelTemplate.name}, version ${currentBusinessModel.version}):`,
      );

      this.pushJsonSection(
        generatedMaterial,
        'Business model content',
        currentBusinessModel.content,
      );
    }

    if (idea.generatedOutputs.length > 0) {
      generatedMaterial.push(
        'Generated project outputs (supporting material, not automatically confirmed implementation facts):',
      );

      for (const output of idea.generatedOutputs) {
        const rendered = output.content?.trim();

        if (rendered) {
          generatedMaterial.push(
            `[${output.outputKey}] ${output.title}:\n${rendered}`,
          );
        }
      }
    }

    return [
      '<confirmed_project_facts>',
      confirmedFacts.join('\n\n'),
      '</confirmed_project_facts>',
      '',
      '<generated_project_material>',
      generatedMaterial.length > 0
        ? generatedMaterial.join('\n\n')
        : 'No generated supporting material is available.',
      '</generated_project_material>',
    ].join('\n');
  }

  /**
   * Appends one optional text section.
   */
  private pushTextSection(
    sections: string[],
    label: string,
    value: string | null,
  ): void {
    const normalizedValue = value?.trim();

    if (normalizedValue) {
      sections.push(`${label}: ${normalizedValue}`);
    }
  }

  /**
   * Appends one optional JSON section.
   */
  private pushJsonSection(
    sections: string[],
    label: string,
    value: Prisma.JsonValue | null,
  ): void {
    const rendered = this.stringifyJson(value);

    if (rendered) {
      sections.push(`${label}: ${rendered}`);
    }
  }

  /**
   * Serializes Prisma JSON safely for prompt inclusion.
   */
  private stringifyJson(
    value: Prisma.JsonValue | null,
  ): string {
    if (value === null) {
      return '';
    }

    if (typeof value === 'string') {
      return value.trim();
    }

    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return '';
    }
  }

  /**
   * Truncates oversized idea context from the end.
   *
   * Core title/problem/objectives fields appear first, so keeping the head is
   * appropriate for idea context. Conversation history uses a different
   * newest-first preservation strategy.
   */
  private truncateHead(
    value: string,
    maxCharacters: number,
  ): string {
    if (value.length <= maxCharacters) {
      return value;
    }

    const marker = '\n...[idea context truncated]';

    return `${value.slice(
      0,
      maxCharacters - marker.length,
    )}${marker}`;
  }
}