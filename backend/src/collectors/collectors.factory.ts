import { BadRequestException, Injectable } from '@nestjs/common';
import { CollectionSourceType } from '@prisma/client';

import { SocialCollector } from './base/collector.interface';

import { MockCollector } from './mock/mock.collector';
import { AppStoreCollector } from './app-store/app-store.collector';
import { BlogCollector } from './blog/blog.collector';
import { DiscordCollector } from './discord/discord.collector';
import { FacebookCollector } from './facebook/facebook.collector';
import { ForumCollector } from './forum/forum.collector';
import { GitHubCollector } from './github/github.collector';
import { GooglePlayCollector } from './google-play/google-play.collector';
import { InstagramCollector } from './instagram/instagram.collector';
import { LinkedInCollector } from './linkedin/linkedin.collector';
import { NewsCollector } from './news/news.collector';
import { QuoraCollector } from './quora/quora.collector';
import { RedditCollector } from './reddit/reddit.collector';
import { StackOverflowCollector } from './stackoverflow/stackoverflow.collector';
import { TelegramCollector } from './telegram/telegram.collector';
import { TikTokCollector } from './tiktok/tiktok.collector';
import { XCollector } from './x/x.collector';
import { YouTubeCollector } from './youtube/youtube.collector';
import { HackerNewsCollector } from './hacker-news/hacker-news.collector';
import { ProductHuntCollector } from './product-hunt/product-hunt.collector';
import { DevToCollector } from './dev-to/dev-to.collector';

/**
 * Factory responsible for returning the correct collector
 * for each requested platform.
 *
 * @author Malak
 */
@Injectable()
export class CollectorsFactory {
  private readonly collectors: Map<CollectionSourceType, SocialCollector>;

  constructor(
    private readonly mockCollector: MockCollector,
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
    this.collectors = new Map<CollectionSourceType, SocialCollector>([
      [CollectionSourceType.MOCK, this.mockCollector],
      [CollectionSourceType.REDDIT, this.redditCollector],
      [CollectionSourceType.FACEBOOK, this.facebookCollector],
      [CollectionSourceType.YOUTUBE, this.youtubeCollector],
      [CollectionSourceType.LINKEDIN, this.linkedInCollector],
      [CollectionSourceType.X, this.xCollector],
      [CollectionSourceType.INSTAGRAM, this.instagramCollector],
      [CollectionSourceType.TELEGRAM, this.telegramCollector],
      [CollectionSourceType.TIKTOK, this.tiktokCollector],
      [CollectionSourceType.GITHUB, this.gitHubCollector],
      [CollectionSourceType.STACKOVERFLOW, this.stackOverflowCollector],
      [CollectionSourceType.DISCORD, this.discordCollector],
      [CollectionSourceType.QUORA, this.quoraCollector],
      [CollectionSourceType.FORUM, this.forumCollector],
      [CollectionSourceType.BLOG, this.blogCollector],
      [CollectionSourceType.NEWS, this.newsCollector],
      [CollectionSourceType.APP_STORE, this.appStoreCollector],
      [CollectionSourceType.GOOGLE_PLAY, this.googlePlayCollector],
      [CollectionSourceType.HACKER_NEWS, this.hackerNewsCollector],
      [CollectionSourceType.PRODUCT_HUNT, this.productHuntCollector],
      [CollectionSourceType.DEV_TO, this.devToCollector],
    ]);
  }

  /**
   * Returns the collector registered for the requested source type.
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
   */
  getSupportedPlatforms(): CollectionSourceType[] {
    return [...this.collectors.keys()];
  }
}