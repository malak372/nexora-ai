import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';

import { SocialCollector } from './base/collector.interface';

import { AppStoreCollector } from './app-store/app-store.collector';
import { BlogCollector } from './blog/blog.collector';
import { DevToCollector } from './dev-to/dev-to.collector';
import { ForumCollector } from './forum/forum.collector';
import { GitHubCollector } from './github/github.collector';
import { GooglePlayCollector } from './google-play/google-play.collector';
import { HackerNewsCollector } from './hacker-news/hacker-news.collector';
import { NewsCollector } from './news/news.collector';
import { ProductHuntCollector } from './product-hunt/product-hunt.collector';
import { RedditCollector } from './reddit/reddit.collector';
import { StackOverflowCollector } from './stackoverflow/stackoverflow.collector';
import { YouTubeCollector } from './youtube/youtube.collector';

/**
 * Runtime registry for collector implementations.
 *
 * Collector implementations are indexed using sourceKey.
 * Each sourceKey must match DataSource.key in the database.
 *
 * This registry is independent from Prisma enums, allowing new
 * collectors to be added without modifying the database schema.
 *
 * @author Malak
 */
@Injectable()
export class CollectorsFactory {
  /**
   * Runtime collector registry.
   *
   * DataSource.key -> SocialCollector implementation
   */
  private readonly collectors =
    new Map<string, SocialCollector>();

  constructor(
    redditCollector: RedditCollector,
    youtubeCollector: YouTubeCollector,
    gitHubCollector: GitHubCollector,
    stackOverflowCollector: StackOverflowCollector,
    forumCollector: ForumCollector,
    blogCollector: BlogCollector,
    newsCollector: NewsCollector,
    appStoreCollector: AppStoreCollector,
    googlePlayCollector: GooglePlayCollector,
    hackerNewsCollector: HackerNewsCollector,
    productHuntCollector: ProductHuntCollector,
    devToCollector: DevToCollector,
  ) {
    const collectors: SocialCollector[] = [
      redditCollector,
      youtubeCollector,
      gitHubCollector,
      stackOverflowCollector,
      forumCollector,
      blogCollector,
      newsCollector,
      appStoreCollector,
      googlePlayCollector,
      hackerNewsCollector,
      productHuntCollector,
      devToCollector,
    ];

    for (const collector of collectors) {
      this.register(collector);
    }
  }

  /**
   * Returns the collector registered for a DataSource.key.
   *
   * @param sourceKey Data-source registry key.
   * @returns Matching collector implementation.
   * @throws BadRequestException When no implementation exists.
   */
  getCollector(
    sourceKey: string,
  ): SocialCollector {
    const normalizedKey =
      this.normalizeSourceKey(sourceKey);

    const collector =
      this.collectors.get(normalizedKey);

    if (!collector) {
      throw new BadRequestException(
        `Collector implementation for data source "${normalizedKey}" was not found.`,
      );
    }

    return collector;
  }

  /**
   * Returns all data-source keys implemented
   * by the deployed backend.
   *
   * The returned values can be used to synchronize
   * DataSource.isImplemented in the database.
   */
  getImplementedSourceKeys(): string[] {
    return [...this.collectors.keys()]
      .sort();
  }


  /**
 * Returns all collector keys registered in the runtime registry.
 *
 * In the current architecture, the factory contains only
 * implemented collectors. Therefore, this list is equivalent
 * to getImplementedSourceKeys().
 *
 * The separate method keeps the factory API explicit and allows
 * placeholder collectors to be supported later without changing
 * DataSourcesService.
 *
 * @returns Sorted registered source keys.
 */
  getRegisteredSourceKeys(): string[] {
    return [...this.collectors.keys()].sort();
  }


  /**
   * Checks whether the deployed backend contains
   * an implementation for the supplied source key.
   *
   * @param sourceKey Data-source registry key.
   * @returns True when a collector is registered.
   */
  isImplemented(
    sourceKey: string,
  ): boolean {
    return this.collectors.has(
      this.normalizeSourceKey(
        sourceKey,
      ),
    );
  }

  /**
   * Registers one collector implementation.
   *
   * Duplicate or empty keys indicate a backend configuration
   * error and prevent the application from starting.
   *
   * @param collector Collector implementation.
   */
  private register(
    collector: SocialCollector,
  ): void {
    const sourceKey =
      this.normalizeSourceKey(
        collector.sourceKey,
      );

    if (!sourceKey) {
      throw new InternalServerErrorException(
        `${collector.constructor.name} exposes an invalid empty sourceKey.`,
      );
    }

    if (this.collectors.has(sourceKey)) {
      throw new InternalServerErrorException(
        `Duplicate collector sourceKey registration: "${sourceKey}".`,
      );
    }

    this.collectors.set(
      sourceKey,
      collector,
    );
  }

  /**
   * Normalizes a data-source registry key.
   *
   * Collector keys and DataSource.key values should use
   * lowercase kebab-case.
   *
   * @param sourceKey Raw source key.
   * @returns Normalized source key.
   */
  private normalizeSourceKey(
    sourceKey: string,
  ): string {
    return sourceKey
      .trim()
      .toLowerCase();
  }
}