import { BadRequestException, Injectable } from '@nestjs/common';
import { CollectionSourceType } from '@prisma/client';

import { SocialCollector } from './base/collector.interface';

import { AppStoreCollector } from './app-store/app-store.collector';
import { BlogCollector } from './blog/blog.collector';
import { DevToCollector } from './dev-to/dev-to.collector';
import { DiscordCollector } from './discord/discord.collector';
import { FacebookCollector } from './facebook/facebook.collector';
import { ForumCollector } from './forum/forum.collector';
import { GitHubCollector } from './github/github.collector';
import { GooglePlayCollector } from './google-play/google-play.collector';
import { HackerNewsCollector } from './hacker-news/hacker-news.collector';
import { InstagramCollector } from './instagram/instagram.collector';
import { LinkedInCollector } from './linkedin/linkedin.collector';
import { NewsCollector } from './news/news.collector';
import { ProductHuntCollector } from './product-hunt/product-hunt.collector';
import { QuoraCollector } from './quora/quora.collector';
import { RedditCollector } from './reddit/reddit.collector';
import { StackOverflowCollector } from './stackoverflow/stackoverflow.collector';
import { TelegramCollector } from './telegram/telegram.collector';
import { TikTokCollector } from './tiktok/tiktok.collector';
import { XCollector } from './x/x.collector';
import { YouTubeCollector } from './youtube/youtube.collector';

/**
 * Factory responsible for returning the correct collector
 * for each requested platform.
 *
 * @author Malak
 */
@Injectable()
export class CollectorsFactory {
  /**
   * Maps each supported platform to its corresponding collector.
   */
  private readonly collectors = new Map<
    CollectionSourceType,
    SocialCollector
  >();

  constructor(
    private readonly redditCollector: RedditCollector,
    private readonly facebookCollector: FacebookCollector,
    private readonly youtubeCollector: YouTubeCollector,
    private readonly linkedInCollector: LinkedInCollector,
    private readonly xCollector: XCollector,
    private readonly instagramCollector: InstagramCollector,
    private readonly telegramCollector: TelegramCollector,
    private readonly tiktokCollector: TikTokCollector,
    private readonly gitHubCollector: GitHubCollector,
    private readonly stackOverflowCollector: StackOverflowCollector,
    private readonly discordCollector: DiscordCollector,
    private readonly quoraCollector: QuoraCollector,
    private readonly forumCollector: ForumCollector,
    private readonly blogCollector: BlogCollector,
    private readonly newsCollector: NewsCollector,
    private readonly appStoreCollector: AppStoreCollector,
    private readonly googlePlayCollector: GooglePlayCollector,
    private readonly hackerNewsCollector: HackerNewsCollector,
    private readonly productHuntCollector: ProductHuntCollector,
    private readonly devToCollector: DevToCollector,
  ) {
    const collectors: SocialCollector[] = [
      this.redditCollector,
      this.facebookCollector,
      this.youtubeCollector,
      this.linkedInCollector,
      this.xCollector,
      this.instagramCollector,
      this.telegramCollector,
      this.tiktokCollector,
      this.gitHubCollector,
      this.stackOverflowCollector,
      this.discordCollector,
      this.quoraCollector,
      this.forumCollector,
      this.blogCollector,
      this.newsCollector,
      this.appStoreCollector,
      this.googlePlayCollector,
      this.hackerNewsCollector,
      this.productHuntCollector,
      this.devToCollector,
    ];

    for (const collector of collectors) {
      this.collectors.set(collector.sourceType, collector);
    }
  }

  /**
   * Returns the collector registered for the requested source type.
   *
   * @param sourceType Platform type.
   * @returns Matching collector.
   * @throws BadRequestException If the platform is not supported.
   */
  getCollector(sourceType: CollectionSourceType): SocialCollector {
    const collector = this.collectors.get(sourceType);

    if (!collector) {
      throw new BadRequestException(
        `${sourceType} collector is not supported.`,
      );
    }

    return collector;
  }

  /**
   * Returns all platforms supported by the current backend.
   *
   * @returns List of supported platform types.
   */
  getSupportedPlatforms(): CollectionSourceType[] {
    return [...this.collectors.keys()];
  }
}
