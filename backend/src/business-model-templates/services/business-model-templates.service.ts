import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

/**
 * Input used to render a completed business-model HTML document.
 */
type RenderCompletedBusinessModelInput = {
  /** Stable template key stored in the database. */
  readonly templateKey: string;

  /** Title of the generated software idea. */
  readonly ideaTitle: string;

  /** Generated business-model content keyed by template section. */
  readonly content: Prisma.JsonValue;
};

/**
 * Rendered HTML document returned by the template renderer.
 */
type RenderedBusinessModelHtml = {
  /** Safe downloadable filename. */
  readonly fileName: string;

  /** Fully rendered standalone HTML document. */
  readonly html: string;
};

/**
 * Provides read-only access to active business-model templates and renders
 * blank or completed standalone HTML documents.
 *
 * Responsibilities:
 * - Retrieve active business-model templates.
 * - Retrieve one active template by its stable key.
 * - Load template HTML and CSS assets from the local assets directory.
 * - Render blank template previews.
 * - Render completed business models using generated JSON content.
 * - Escape all dynamic text before inserting it into HTML.
 *
 * This service does not create, update, or delete database templates.
 *
 * @author Malak
 */
@Injectable()
export class BusinessModelTemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns all active business-model templates.
   *
   * Default templates are returned first, followed by the remaining
   * templates ordered alphabetically by name.
   */
  findActive() {
    return this.prisma.businessModelTemplate.findMany({
      where: {
        isActive: true,
      },
      orderBy: [
        {
          isDefault: 'desc',
        },
        {
          name: 'asc',
        },
      ],
      select: {
        id: true,
        key: true,
        name: true,
        description: true,
        sections: true,
        promptGuidance: true,
        supportedUserTypes: true,
        supportedDomains: true,
        isDefault: true,
      },
    });
  }

  /**
   * Returns one active business-model template by key.
   *
   * @param key Business-model template key.
   * @throws NotFoundException When no active template matches the key.
   */
  async findActiveByKey(key: string) {
    const normalizedKey = key.trim().toLowerCase();

    const template = await this.prisma.businessModelTemplate.findFirst({
      where: {
        key: normalizedKey,
        isActive: true,
      },
    });

    if (!template) {
      throw new NotFoundException('Business-model template not found.');
    }

    return template;
  }

  /**
   * Renders a blank standalone HTML document for one active template.
   *
   * The template sections are displayed as empty cards so the user can
   * preview or download the visual structure before generating content.
   *
   * @param key Business-model template key.
   */
  async renderBlankHtml(key: string): Promise<RenderedBusinessModelHtml> {
    const template = await this.findActiveByKey(key);
    const assets = await this.loadAssets(template.key);
    const sectionKeys = this.resolveSectionKeys(template.sections);

    const sectionsHtml = sectionKeys
      .map((sectionKey) => this.renderSectionHtml(sectionKey, ''))
      .join('');

    return {
      fileName: `${template.key}.html`,
      html: this.applyTemplate({
        html: assets.html,
        css: assets.css,
        templateName: template.name,
        ideaTitle: 'Untitled Nexora Idea',
        sectionsHtml,
      }),
    };
  }

  /**
   * Renders a completed standalone HTML document using generated
   * business-model content.
   *
   * Every content key is converted into one visual section. Values are
   * escaped before rendering, preventing generated or user-controlled
   * content from injecting HTML or JavaScript.
   *
   * @param input Completed business-model rendering input.
   */
  async renderCompletedHtml(
    input: RenderCompletedBusinessModelInput,
  ): Promise<RenderedBusinessModelHtml> {
    const template = await this.findActiveByKey(input.templateKey);
    const assets = await this.loadAssets(template.key);
    const content = this.readContentRecord(input.content);
    const configuredSectionKeys = this.resolveSectionKeys(template.sections);

    const sectionKeys = [
      ...configuredSectionKeys,
      ...Object.keys(content).filter(
        (key) => !configuredSectionKeys.includes(key),
      ),
    ];

    const sectionsHtml = sectionKeys
      .map((sectionKey) =>
        this.renderSectionHtml(
          sectionKey,
          this.formatContentValue(content[sectionKey]),
        ),
      )
      .join('');

    return {
      fileName: `${template.key}-${this.toSafeFileName(input.ideaTitle)}.html`,
      html: this.applyTemplate({
        html: assets.html,
        css: assets.css,
        templateName: template.name,
        ideaTitle: input.ideaTitle,
        sectionsHtml,
      }),
    };
  }

  /** Loads one template's HTML and CSS files from the assets directory. */
  private async loadAssets(templateKey: string): Promise<{
    html: string;
    css: string;
  }> {
    const candidateDirectories = [
      join(process.cwd(), 'assets', 'business-model-templates', templateKey),
      join(
        process.cwd(),
        'dist',
        'assets',
        'business-model-templates',
        templateKey,
      ),
    ];

    let lastError: unknown;

    for (const directory of candidateDirectories) {
      try {
        const [html, css] = await Promise.all([
          readFile(join(directory, 'template.html'), 'utf8'),
          readFile(join(directory, 'template.css'), 'utf8'),
        ]);

        return { html, css };
      } catch (error) {
        lastError = error;
      }
    }

    throw new InternalServerErrorException(
      'The business-model template assets could not be loaded.',
      {
        cause: lastError,
      },
    );
  }

  /** Applies safe values to the shared HTML placeholders. */
  private applyTemplate(input: {
    html: string;
    css: string;
    templateName: string;
    ideaTitle: string;
    sectionsHtml: string;
  }): string {
    return input.html
      .replaceAll('{{styles}}', input.css)
      .replaceAll('{{templateName}}', this.escapeHtml(input.templateName))
      .replaceAll('{{ideaTitle}}', this.escapeHtml(input.ideaTitle))
      .replaceAll('{{sections}}', input.sectionsHtml)
      .replace(/\{\{[a-zA-Z0-9_-]+\}\}/g, '');
  }

  /** Converts template JSON into a stable list of section keys. */
  private resolveSectionKeys(sections: Prisma.JsonValue): string[] {
    if (!Array.isArray(sections)) {
      return [];
    }

    const keys = sections
      .map((section): string | null => {
        if (typeof section === 'string') {
          return section.trim();
        }

        if (section && typeof section === 'object' && !Array.isArray(section)) {
          const key = section.key;
          return typeof key === 'string' ? key.trim() : null;
        }

        return null;
      })
      .filter((key): key is string => Boolean(key));

    return [...new Set(keys)];
  }

  /** Safely reads generated Prisma JSON as a string-keyed record. */
  private readContentRecord(
    content: Prisma.JsonValue,
  ): Record<string, Prisma.JsonValue> {
    if (!content || typeof content !== 'object' || Array.isArray(content)) {
      return {};
    }

    return content as Record<string, Prisma.JsonValue>;
  }

  /** Builds one escaped visual section. */
  private renderSectionHtml(sectionKey: string, value: string): string {
    const safeTitle = this.escapeHtml(this.humanizeSectionKey(sectionKey));
    const safeValue = this.escapeHtml(value || 'Not generated yet.');

    return [
      '<article class="business-model-section">',
      `  <h2>${safeTitle}</h2>`,
      `  <p>${safeValue}</p>`,
      '</article>',
    ].join('\n');
  }

  /** Converts camelCase, snake_case, or kebab-case into a readable title. */
  private humanizeSectionKey(key: string): string {
    const normalized = key
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[-_]+/g, ' ')
      .trim();

    return normalized.replace(/\b\w/g, (character) => character.toUpperCase());
  }

  /** Converts JSON values into readable section text. */
  private formatContentValue(value: Prisma.JsonValue | undefined): string {
    if (value === null || value === undefined) {
      return '';
    }

    if (typeof value === 'string') {
      return value.trim();
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }

    if (Array.isArray(value)) {
      return value
        .map((item) => this.formatContentValue(item))
        .filter(Boolean)
        .join(' • ');
    }

    return Object.entries(value)
      .map(
        ([key, item]) =>
          `${this.humanizeSectionKey(key)}: ${this.formatContentValue(item)}`,
      )
      .filter((item) => !item.endsWith(': '))
      .join(' | ');
  }

  /** Produces a safe cross-platform filename fragment. */
  private toSafeFileName(value: string): string {
    const normalized = value
      .normalize('NFKD')
      .replace(/[^a-zA-Z0-9\u0600-\u06FF]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase();

    return normalized || 'idea';
  }

  /** Escapes special HTML characters to prevent unsafe injection. */
  private escapeHtml(value: string): string {
    const htmlEntities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    };

    return value.replace(
      /[&<>"']/g,
      (character) => htmlEntities[character] ?? character,
    );
  }
}
