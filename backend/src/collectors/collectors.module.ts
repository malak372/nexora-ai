import { Module } from '@nestjs/common';

import { CollectorsFactory } from './collectors.factory';

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
import { CollectorQueueService } from './base/collector-queue.service';

/**
 * Module that groups all platform collectors.
 *
 * Currently:
 * - MOCK is implemented for testing and demo.
 * - Other collectors are placeholders until real API integrations are added.
 *
 * @author Malak
 */
@Module({
  providers: [
    CollectorsFactory,
    MockCollector,
    RedditCollector,
    FacebookCollector,
    YouTubeCollector,
    LinkedInCollector,
    XCollector,
    InstagramCollector,
    TelegramCollector,
    TikTokCollector,
    GitHubCollector,
    StackOverflowCollector,
    DiscordCollector,
    QuoraCollector,
    ForumCollector,
    BlogCollector,
    NewsCollector,
    AppStoreCollector,
    GooglePlayCollector,
    CollectorQueueService,
  ],
    exports: [
    CollectorsFactory,
    CollectorQueueService,
  ],
})
export class CollectorsModule {}